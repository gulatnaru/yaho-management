import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSyntheticRecipient, dispatchPermitSchema } from "@/lib/kakao/send-contract";
import { decryptInactiveRecipient, encryptPendingRecipient, nonceWithinHighWater } from "@/server/kakao/recipient-crypto";
import { activateRecipient, isEligibleAdmin, purgeRecipient, recipientAvailable, registerRecipient, revokeRecipient, verifyRecipient, type RecipientUser, type Registration } from "@/server/kakao/recipient-registration";
import { PrismaDispatchRepository, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { consumeSyntheticNonce } from "@/server/kakao/runtime-settings";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((value) => !/(?:\d[-_]*){7,}/.test(value));
const keySchema = z.object({ keyVersion: id, key: z.instanceof(Buffer).refine((b) => b.length === 32), synthetic: z.literal(true) }).strict();
const base = z.object({ registrationId: id, actorId: id, at: z.date() }).strict();
const evidenceSchema = z.object({ id: z.literal("mock_ownership_v1"), method: z.literal("synthetic_call"), synthetic: z.literal(true), success: z.literal(true), registrationId: id, version: id, verifierId: id, verifiedAt: z.date() }).strict();
const safety = { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true } as const;
/** G2-only simulated call results are explicitly seeded by the server's mock harness. */
export class SyntheticOwnershipMock {
  private readonly observations: z.infer<typeof evidenceSchema>[];
  constructor(observations: unknown) { this.observations = z.array(evidenceSchema).parse(observations).map((entry) => ({ ...entry, verifiedAt: new Date(entry.verifiedAt) })); }
  confirms(expected: z.infer<typeof evidenceSchema>): boolean {
    return this.observations.some((entry) => entry.registrationId === expected.registrationId && entry.version === expected.version && entry.verifierId === expected.verifierId && entry.verifiedAt.getTime() === expected.verifiedAt.getTime());
  }
}
type Key = z.infer<typeof keySchema>;
type Runtime = { ownerId: string | null; purgeExecutorId: string | null; recipientVersion: string | null; blocked: boolean; keyVersion: string | null; nonceHighWater: bigint; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean; revision: number };
type Row = { id: string; version: string; userId: string; environment: string; service: string; purposeVersion: string; policyVersion: string; state: Registration["state"]; ciphertext: Uint8Array | null; nonce: Uint8Array | null; tag: Uint8Array | null; keyVersion: string | null; verificationMethod: string | null; verificationEvidenceId: string | null; verifiedBy: string | null; verifiedAt: Date | null };

function registration(row: Row): Registration {
  return { environment: row.environment as "preview", service: row.service as "application.received", id: row.id, version: row.version, userId: row.userId, purposeVersion: row.purposeVersion, policyVersion: row.policyVersion, state: row.state,
    ciphertext: row.ciphertext && row.nonce && row.tag && row.keyVersion ? { ciphertext: Buffer.from(row.ciphertext), nonce: Buffer.from(row.nonce), tag: Buffer.from(row.tag), keyVersion: row.keyVersion, synthetic: true } : null,
    evidence: row.verificationMethod === "synthetic_call" && row.verificationEvidenceId === "mock_ownership_v1" && row.verifiedBy && row.verifiedAt ? { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: row.id, version: row.version, verifierId: row.verifiedBy, verifiedAt: row.verifiedAt } : null };
}
async function runtimeLock(tx: PrismaGuardTransaction): Promise<Runtime> {
  const [runtime] = await tx.$queryRaw<Runtime[]>`SELECT "ownerId", "purgeExecutorId", "recipientVersion", "blocked", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
  if (!runtime) throw new Error("Runtime unavailable.");
  return runtime;
}
async function usersLock(tx: PrismaGuardTransaction, runtime: Runtime, actorId: string, targetId: string): Promise<RecipientUser[]> {
  if (!runtime.ownerId) throw new Error("Recipient authority unavailable.");
  return tx.$queryRaw<RecipientUser[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${actorId}, ${targetId}) ORDER BY "id" FOR UPDATE`;
}
async function actor(tx: PrismaGuardTransaction, runtime: Runtime, users: RecipientUser[], actorId: string, assignment: "register" | "verify") {
  const user = users.find((u) => u.id === actorId);
  const owner = users.find((u) => u.id === runtime.ownerId);
  if (!runtime.ownerId || !isEligibleAdmin(owner) || !isEligibleAdmin(user)) throw new Error("Recipient authority unavailable.");
  if (runtime.ownerId !== actorId) {
    const [duty] = await tx.$queryRaw<{ eventType: string }[]>`SELECT "eventType" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" IN ('recipient_assignment_granted', 'recipient_assignment_revoked') AND "actorId" = ${runtime.ownerId} AND "payloadBinding" = ${actorId} AND "code" = ${assignment} AND "revisionAfter" IS NOT NULL AND "revisionAfter" <= ${runtime.revision} ORDER BY "revisionAfter" DESC LIMIT 1`;
    if (duty?.eventType !== "recipient_assignment_granted") throw new Error("Recipient authority unavailable.");
  }
  return { user, assignments: [assignment] };
}
function ready(runtime: Runtime, key: Key) {
  if (runtime.keyVersion !== key.keyVersion || !runtime.nonceCurrent || !runtime.recoveryVerified || !runtime.rotationComplete) throw new Error("Recipient key unavailable.");
}
async function rowsLock(tx: PrismaGuardTransaction): Promise<Row[]> {
  return tx.$queryRaw<Row[]>`SELECT "id", "version", "userId", "environment", "service", "purposeVersion", "policyVersion", "state", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt" FROM "NotificationRecipientRegistration" WHERE "environment" = 'preview' AND "service" = 'application.received' ORDER BY "id" FOR UPDATE`;
}
async function append(tx: PrismaGuardTransaction, row: Registration, actorId: string, at: Date, eventType: string, from: string, evidenceId: string | null = null, code: string | null = null) {
  const eventId = randomUUID();
  await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "actorId", "eventType", "fromState", "toState", "evidenceId", "code", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${row.id}, ${actorId}, ${eventType}, ${from}, ${row.state}, ${evidenceId}, ${code}, ${at})`;
}

/** Owner-authorized synthetic duty is stored as a revision-ordered audit event. */
export async function setPrismaSyntheticRecipientAssignment(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = z.object({ commandId: id, actorId: id, executorId: id, assignment: z.enum(["register", "verify"]), active: z.boolean(), at: z.date() }).strict().parse(value);
  await repository.transaction(async (tx) => {
    const runtime = await runtimeLock(tx); const users = await usersLock(tx, runtime, input.actorId, input.executorId);
    if (runtime.ownerId !== input.actorId || !isEligibleAdmin(users.find((u) => u.id === input.actorId)) || !isEligibleAdmin(users.find((u) => u.id === input.executorId))) throw new Error("Assignment unavailable.");
    const eventType = input.active ? "recipient_assignment_granted" : "recipient_assignment_revoked";
    const [prior] = await tx.$queryRaw<{ eventType: string; actorId: string | null; payloadBinding: string | null; code: string | null }[]>`SELECT "eventType", "actorId", "payloadBinding", "code" FROM "NotificationAudit" WHERE "commandId" = ${input.commandId} AND "environment" = 'preview' LIMIT 1`;
    if (prior) { if (prior.eventType !== eventType || prior.actorId !== input.actorId || prior.payloadBinding !== input.executorId || prior.code !== input.assignment) throw new Error("Command conflict."); return; }
    const updated = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = 'preview' AND "revision" = ${runtime.revision}`;
    if (updated !== 1) throw new Error("Runtime changed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "actorId", "commandId", "payloadBinding", "code", "toState", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${input.commandId}, ${input.commandId}, 'preview', ${eventType}, ${input.actorId}, ${input.commandId}, ${input.executorId}, ${input.assignment}, ${input.active ? "assigned" : "unassigned"}, ${runtime.revision}, ${runtime.revision + 1}, ${input.at})`;
  });
}

/** Synthetic registration: a nonce is durably consumed before ciphertext is created. */
export async function registerPrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = z.object({ registrationId: id, version: id, userId: id, actorId: id, purposeVersion: id, policyVersion: id, key: keySchema, at: z.date() }).strict().parse(value);
  await repository.transaction(async (tx) => { const runtime = await runtimeLock(tx); const users = await usersLock(tx, runtime, input.actorId, input.userId); await actor(tx, runtime, users, input.actorId, "register"); ready(runtime, input.key); if (!isEligibleAdmin(users.find((u) => u.id === input.userId))) throw new Error("Target unavailable."); });
  const sequence = await consumeSyntheticNonce(repository, { keyVersion: input.key.keyVersion, at: input.at });
  const seed = createHash("sha256").update(`g2-synthetic-${input.registrationId}-${input.version}`).digest();
  const plaintext = Buffer.from(`000${Array.from(seed.subarray(0, 8), (x) => x % 10).join("")}`);
  let encrypted: ReturnType<typeof encryptPendingRecipient>;
  try { encrypted = encryptPendingRecipient(plaintext, input.key.key, sequence, { environment: "preview", registrationId: input.registrationId, registrationVersion: input.version, keyVersion: input.key.keyVersion }); } finally { plaintext.fill(0); seed.fill(0); }
  await repository.transaction(async (tx) => {
    const runtime = await runtimeLock(tx); const users = await usersLock(tx, runtime, input.actorId, input.userId); const operator = await actor(tx, runtime, users, input.actorId, "register"); ready(runtime, input.key);
    const rows = await rowsLock(tx); const target = users.find((u) => u.id === input.userId);
    if (rows.some((r) => r.id === input.registrationId || (r.userId === input.userId && r.version === input.version))) throw new Error("Registration conflict.");
    const candidate = { environment: "preview", service: "application.received", id: input.registrationId, version: input.version, userId: input.userId, purposeVersion: input.purposeVersion, policyVersion: input.policyVersion, state: "verification_pending", ciphertext: { ...encrypted, keyVersion: input.key.keyVersion, synthetic: true }, evidence: null };
    const transition = registerRecipient({ registration: candidate, actor: operator, target, ownWorkNumberConfirmed: true, previousVersions: rows.map((r) => ({ id: r.id, version: r.version, state: r.state })), at: input.at });
    await tx.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "ciphertext", "nonce", "tag", "keyVersion") VALUES (${input.registrationId}, 'preview', 'application.received', ${input.userId}, ${input.version}, 'verification_pending', ${input.purposeVersion}, ${input.policyVersion}, ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${input.key.keyVersion})`;
    await append(tx, transition.registration, input.actorId, input.at, "recipient_registered", transition.audit.from);
  });
}

async function lockedRecipient(tx: PrismaGuardTransaction, input: z.infer<typeof base>) {
  const runtime = await runtimeLock(tx);
  const [link] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${input.registrationId} AND "environment" = 'preview' AND "service" = 'application.received'`;
  if (!link) throw new Error("Registration unavailable.");
  const users = await usersLock(tx, runtime, input.actorId, link.userId);
  const rows = await rowsLock(tx); const row = rows.find((r) => r.id === input.registrationId && r.userId === link.userId);
  if (!row) throw new Error("Registration unavailable.");
  return { runtime, users, rows, row, target: users.find((u) => u.id === row.userId) };
}

/** The mock observation is separate from number-format and registration validation. */
export async function recordPrismaSyntheticOwnership(repository: PrismaDispatchRepository, mock: SyntheticOwnershipMock, value: unknown): Promise<void> {
  const input = base.extend({ evidence: evidenceSchema }).parse(value);
  if (!(mock instanceof SyntheticOwnershipMock) || !mock.confirms(input.evidence) || input.evidence.registrationId !== input.registrationId || input.evidence.verifierId !== input.actorId || input.evidence.verifiedAt.getTime() !== input.at.getTime()) throw new Error("Mock ownership unavailable.");
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input); await actor(tx, locked.runtime, locked.users, input.actorId, "verify");
    if (locked.row.state !== "verification_pending" || locked.row.version !== input.evidence.version || !isEligibleAdmin(locked.target)) throw new Error("Mock ownership unavailable.");
    const eventId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "actorId", "eventType", "toState", "evidenceId", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${locked.row.id}, ${input.actorId}, 'synthetic_ownership_confirmed', ${locked.row.version}, 'mock_ownership_v1', ${input.at})`;
  });
}

export async function verifyPrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ evidence: evidenceSchema }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input); const operator = await actor(tx, locked.runtime, locked.users, input.actorId, "verify");
    const rows = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" = 'synthetic_ownership_confirmed' AND "registrationId" = ${input.evidence.registrationId} AND "toState" = ${input.evidence.version} AND "actorId" = ${input.evidence.verifierId} AND "evidenceId" = 'mock_ownership_v1' AND "occurredAt" = ${input.evidence.verifiedAt} LIMIT 1`;
    if (!rows.length) throw new Error("Ownership evidence unavailable.");
    const transition = verifyRecipient({ registration: registration(locked.row), actor: operator, target: locked.target, evidence: input.evidence, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'verified_inactive', "verificationMethod" = 'synthetic_call', "verificationEvidenceId" = 'mock_ownership_v1', "verifiedBy" = ${input.actorId}, "verifiedAt" = ${input.at} WHERE "id" = ${locked.row.id} AND "state" = 'verification_pending'`;
    if (changed !== 1) throw new Error("Registration changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_verified", transition.audit.from, "mock_ownership_v1");
  });
}

export async function activatePrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ key: keySchema }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input); const operator = await actor(tx, locked.runtime, locked.users, input.actorId, "register"); ready(locked.runtime, input.key);
    const current = registration(locked.row); if (!current.ciphertext || current.ciphertext.keyVersion !== input.key.keyVersion || !nonceWithinHighWater(current.ciphertext.nonce, locked.runtime.nonceHighWater)) throw new Error("Ciphertext unavailable.");
    const proof = current.evidence;
    if (!proof) throw new Error("Ownership evidence unavailable.");
    const evidence = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" = 'synthetic_ownership_confirmed' AND "registrationId" = ${proof.registrationId} AND "toState" = ${proof.version} AND "actorId" = ${proof.verifierId} AND "evidenceId" = 'mock_ownership_v1' AND "occurredAt" = ${proof.verifiedAt} LIMIT 1`;
    if (!evidence.length) throw new Error("Ownership evidence unavailable.");
    const plaintext = decryptInactiveRecipient(current.ciphertext, input.key.key, { environment: "preview", registrationId: current.id, registrationVersion: current.version, keyVersion: input.key.keyVersion });
    try { if (!plaintext.length) throw new Error("Ciphertext unavailable."); } finally { plaintext.fill(0); }
    const active = locked.rows.find((r) => r.state === "active");
    const transition = activateRecipient({ registration: current, actor: operator, target: locked.target, activeRegistration: active ?? null, ciphertextValid: true, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'active', "activatedAt" = ${input.at} WHERE "id" = ${current.id} AND "state" = 'verified_inactive'`;
    if (changed !== 1) throw new Error("Registration changed.");
    const updated = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "recipientVersion" = ${current.version}, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = 'preview' AND "revision" = ${locked.runtime.revision}`;
    if (updated !== 1) throw new Error("Runtime changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_activated", transition.audit.from, "mock_ownership_v1");
  });
}

export async function revokePrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ reason: z.enum(["withdrawn", "replaced", "verification_stopped"]) }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input); const current = registration(locked.row);
    const user = locked.users.find((u) => u.id === input.actorId);
    const operator = input.reason === "withdrawn" && input.actorId === current.userId && isEligibleAdmin(user) ? { user, assignments: [] } : await actor(tx, locked.runtime, locked.users, input.actorId, "register");
    const transition = revokeRecipient({ registration: current, actor: operator, reason: input.reason, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = ${transition.registration.state}, "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "keyVersion" = NULL, "revokedAt" = ${input.at} WHERE "id" = ${current.id} AND "state" = ${current.state}`;
    if (changed !== 1) throw new Error("Registration changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_revoked", transition.audit.from, null, transition.audit.reason);
  });
}

export async function purgePrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ commandId: id, approvalId: id, evidenceId: id }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input); const owner = locked.users.find((u) => u.id === locked.runtime.ownerId); const user = locked.users.find((u) => u.id === input.actorId);
    if (!locked.runtime.ownerId || locked.runtime.purgeExecutorId !== input.actorId || !isEligibleAdmin(owner) || !isEligibleAdmin(user)) throw new Error("Purge authority unavailable.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; registrationId: string | null; commandId: string | null; evidenceId: string | null }[]>`SELECT "actorId", "registrationId", "commandId", "evidenceId" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'recipient_purge_approved'`;
    if (!approval || approval.actorId !== owner.id || approval.registrationId !== input.registrationId || approval.commandId !== input.commandId || approval.evidenceId !== input.evidenceId) throw new Error("Purge approval unavailable.");
    const operator = { user, assignments: ["purge"] }; const current = registration(locked.row);
    const transition = purgeRecipient({ registration: current, actor: operator, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'purged', "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "keyVersion" = NULL, "purgedAt" = ${input.at} WHERE "id" = ${current.id} AND "state" = ${current.state}`;
    if (changed !== 1) throw new Error("Registration changed.");
    const eventId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "actorId", "eventType", "fromState", "toState", "commandId", "approvalId", "evidenceId", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${current.id}, ${input.actorId}, 'recipient_purged', ${transition.audit.from}, 'purged', ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${input.at})`;
  });
}

/** Server-only plaintext for a still-current issued slot; caller must erase the buffer. */
export async function decryptPrismaSyntheticRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<Buffer> {
  const input = z.object({ permit: dispatchPermitSchema, key: keySchema, now: z.date() }).strict().parse(value);
  return repository.transaction(async (tx) => {
    const runtime = await runtimeLock(tx); ready(runtime, input.key); if (runtime.blocked !== false) throw new Error("Runtime blocked.");
    const [link] = await tx.$queryRaw<{ outboxId: string; recipientId: string }[]>`SELECT "outboxId", "recipientId" FROM "NotificationDispatch" WHERE "id" = ${input.permit.dispatchId}`;
    if (!link) throw new Error("Permit unavailable.");
    const [outbox] = await tx.$queryRaw<{ id: string; dedupeKey: string; status: string; claimToken: string | null; leaseExpiresAt: Date | null }[]>`SELECT "id", "dedupeKey", "status", "claimToken", "leaseExpiresAt" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [owner] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} AND "environment" = 'preview'`;
    if (!outbox || !owner) throw new Error("Permit unavailable.");
    const [user] = await tx.$queryRaw<RecipientUser[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${owner.userId} FOR UPDATE`;
    const rows = await rowsLock(tx); const row = rows.find((r) => r.id === link.recipientId && r.userId === owner.userId);
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; recipientVersion: string; templateId: string; templateVersion: string; submittedAt: Date; reconciliationState: string }[]>`SELECT "id", "outboxId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState" FROM "NotificationDispatch" WHERE "id" = ${input.permit.dispatchId} FOR UPDATE`;
    const [slot] = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "NotificationCostReservation" WHERE "id" = ${input.permit.slotId} AND "dispatchId" = ${input.permit.dispatchId} AND "entryKind" = 'SEND_SLOT' FOR UPDATE`;
    if (!row || !dispatch || !slot || slot.status !== "in_flight" || dispatch.reconciliationState !== "in_flight" || dispatch.outboxId !== outbox.id || dispatch.recipientId !== row.id || dispatch.recipientVersion !== row.version || runtime.recipientVersion !== row.version || outbox.status !== "processing" || outbox.claimToken !== input.permit.claimToken || !outbox.leaseExpiresAt || outbox.leaseExpiresAt <= input.now || outbox.dedupeKey !== input.permit.context.dedupeKey || input.permit.context.recipientId !== row.id || input.permit.context.recipientVersion !== row.version || dispatch.templateId !== input.permit.context.templateId || dispatch.templateVersion !== input.permit.context.templateVersion || dispatch.submittedAt.getTime() !== input.permit.context.submittedAt.getTime()) throw new Error("Permit unavailable.");
    const current = registration(row);
    if (!recipientAvailable(current, user, { id: row.id, version: row.version, userId: row.userId }) || !current.ciphertext || current.ciphertext.keyVersion !== input.key.keyVersion || !nonceWithinHighWater(current.ciphertext.nonce, runtime.nonceHighWater) || !current.evidence) throw new Error("Recipient unavailable.");
    const proof = current.evidence;
    const evidence = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" = 'synthetic_ownership_confirmed' AND "registrationId" = ${proof.registrationId} AND "toState" = ${proof.version} AND "actorId" = ${proof.verifierId} AND "evidenceId" = 'mock_ownership_v1' AND "occurredAt" = ${proof.verifiedAt} LIMIT 1`;
    if (!evidence.length) throw new Error("Recipient unavailable.");
    return decryptSyntheticRecipient(current.ciphertext, input.key.key, { environment: "preview", registrationId: row.id, registrationVersion: row.version, keyVersion: input.key.keyVersion }, safety);
  });
}
