import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptInactiveRecipient, encryptPendingRecipient, nonceWithinHighWater } from "@/server/kakao/recipient-crypto";
import { isEligibleAdmin, type RecipientUser } from "@/server/kakao/recipient-registration";
import {
  activateRealRecipient, realOwnershipEvidenceSchema, recipientAvailableReal,
  registerRealRecipient, revokeRealRecipient, verifyRealRecipient,
  type RealOwnershipEvidence, type RealRegistration,
} from "@/server/kakao/recipient-registration-real";
import { PrismaDispatchRepository, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { consumeRecipientNonce } from "@/server/kakao/runtime-settings";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((value) => !/(?:\d[-_]*){7,}/.test(value));
const keySchema = z.object({ keyVersion: id, key: z.instanceof(Buffer).refine((value) => value.length === 32) }).strict();
const base = z.object({ registrationId: id, actorId: id, at: z.date() }).strict();
type Key = z.infer<typeof keySchema>;
type Runtime = { ownerId: string | null; recipientVersion: string | null; blocked: boolean; keyVersion: string | null; nonceHighWater: bigint; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean; revision: number };
type Row = {
  id: string; version: string; userId: string; environment: string; service: string;
  purposeVersion: string; policyVersion: string; state: RealRegistration["state"];
  ciphertext: Uint8Array | null; nonce: Uint8Array | null; tag: Uint8Array | null; keyVersion: string | null;
  verificationMethod: string | null; verificationEvidenceId: string | null; verifiedBy: string | null; verifiedAt: Date | null;
};

export function registrationReal(row: Row): RealRegistration {
  return {
    environment: row.environment as "preview", service: row.service as "application.received",
    id: row.id, version: row.version, userId: row.userId, purposeVersion: row.purposeVersion, policyVersion: row.policyVersion, state: row.state,
    ciphertext: row.ciphertext && row.nonce && row.tag && row.keyVersion ? { ciphertext: Buffer.from(row.ciphertext), nonce: Buffer.from(row.nonce), tag: Buffer.from(row.tag), keyVersion: row.keyVersion } : null,
    evidence: row.verificationMethod === "operator_call" && row.verificationEvidenceId === "operator_call_verified" && row.verifiedBy && row.verifiedAt ? { id: "operator_call_verified", method: "operator_call", success: true, registrationId: row.id, version: row.version, verifierId: row.verifiedBy, verifiedAt: row.verifiedAt } : null,
  };
}
async function runtimeLock(tx: PrismaGuardTransaction): Promise<Runtime> {
  const [runtime] = await tx.$queryRaw<Runtime[]>`SELECT "ownerId", "recipientVersion", "blocked", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
  if (!runtime) throw new Error("Runtime unavailable.");
  return runtime;
}
async function usersLock(tx: PrismaGuardTransaction, runtime: Runtime, actorId: string, targetId: string): Promise<RecipientUser[]> {
  if (!runtime.ownerId) throw new Error("Recipient authority unavailable.");
  return tx.$queryRaw<RecipientUser[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${actorId}, ${targetId}) ORDER BY "id" FOR UPDATE`;
}
async function actor(tx: PrismaGuardTransaction, runtime: Runtime, users: RecipientUser[], actorId: string, assignment: "register" | "verify") {
  const user = users.find((entry) => entry.id === actorId);
  const owner = users.find((entry) => entry.id === runtime.ownerId);
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
async function append(tx: PrismaGuardTransaction, row: RealRegistration, actorId: string, at: Date, eventType: string, from: string, evidenceId: string | null = null, code: string | null = null) {
  const eventId = randomUUID();
  await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "actorId", "eventType", "fromState", "toState", "evidenceId", "code", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${row.id}, ${actorId}, ${eventType}, ${from}, ${row.state}, ${evidenceId}, ${code}, ${at})`;
}
async function ownershipExists(tx: PrismaGuardTransaction, proof: RealOwnershipEvidence): Promise<boolean> {
  const rows = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" = 'recipient_ownership_confirmed' AND "registrationId" = ${proof.registrationId} AND "toState" = ${proof.version} AND "actorId" = ${proof.verifierId} AND "evidenceId" = 'operator_call_verified' AND "occurredAt" = ${proof.verifiedAt} LIMIT 1`;
  return rows.length > 0;
}
async function lockedRecipient(tx: PrismaGuardTransaction, input: z.infer<typeof base>) {
  const runtime = await runtimeLock(tx);
  const [link] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${input.registrationId} AND "environment" = 'preview' AND "service" = 'application.received'`;
  if (!link) throw new Error("Registration unavailable.");
  const users = await usersLock(tx, runtime, input.actorId, link.userId);
  const rows = await rowsLock(tx);
  const row = rows.find((entry) => entry.id === input.registrationId && entry.userId === link.userId);
  if (!row || row.purposeVersion !== "application-received-v1" || row.policyVersion !== "g4-v1") throw new Error("Registration unavailable.");
  return { runtime, users, rows, row, target: users.find((entry) => entry.id === row.userId) };
}

/** Encrypt only the supplied number; commit a fresh nonce before making ciphertext. */
export async function registerPrismaRealRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = z.object({ registrationId: id, version: id, userId: id, actorId: id, purposeVersion: z.literal("application-received-v1"), policyVersion: z.literal("g4-v1"), phoneNumber: z.string().regex(/^\d{9,15}$/), key: keySchema, at: z.date() }).strict().parse(value);
  await repository.transaction(async (tx) => {
    const runtime = await runtimeLock(tx);
    const users = await usersLock(tx, runtime, input.actorId, input.userId);
    await actor(tx, runtime, users, input.actorId, "register");
    ready(runtime, input.key);
    if (!isEligibleAdmin(users.find((entry) => entry.id === input.userId))) throw new Error("Target unavailable.");
  });
  const sequence = await consumeRecipientNonce(repository, { keyVersion: input.key.keyVersion, at: input.at });
  const plaintext = Buffer.from(input.phoneNumber, "utf8");
  let encrypted: ReturnType<typeof encryptPendingRecipient>;
  try {
    encrypted = encryptPendingRecipient(plaintext, input.key.key, sequence, { environment: "preview", registrationId: input.registrationId, registrationVersion: input.version, keyVersion: input.key.keyVersion });
  } finally { plaintext.fill(0); }
  await repository.transaction(async (tx) => {
    const runtime = await runtimeLock(tx);
    const users = await usersLock(tx, runtime, input.actorId, input.userId);
    const operator = await actor(tx, runtime, users, input.actorId, "register");
    ready(runtime, input.key);
    const rows = await rowsLock(tx);
    if (rows.some((row) => row.id === input.registrationId || (row.userId === input.userId && row.version === input.version))) throw new Error("Registration conflict.");
    const candidate = { environment: "preview", service: "application.received", id: input.registrationId, version: input.version, userId: input.userId, purposeVersion: input.purposeVersion, policyVersion: input.policyVersion, state: "verification_pending", ciphertext: { ...encrypted, keyVersion: input.key.keyVersion }, evidence: null };
    const transition = registerRealRecipient({ registration: candidate, actor: operator, target: users.find((entry) => entry.id === input.userId), ownWorkNumberConfirmed: true, previousVersions: rows.map((row) => ({ id: row.id, version: row.version, state: row.state })), at: input.at });
    await tx.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "ciphertext", "nonce", "tag", "keyVersion") VALUES (${input.registrationId}, 'preview', 'application.received', ${input.userId}, ${input.version}, 'verification_pending', ${input.purposeVersion}, ${input.policyVersion}, ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${input.key.keyVersion})`;
    await append(tx, transition.registration, input.actorId, input.at, "recipient_registered", transition.audit.from);
  });
}

/** Record the verifier's attestation; this function never places a phone call. */
export async function recordPrismaRealOwnership(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ evidence: realOwnershipEvidenceSchema }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input);
    const operator = await actor(tx, locked.runtime, locked.users, input.actorId, "verify");
    verifyRealRecipient({ registration: registrationReal(locked.row), actor: operator, target: locked.target, evidence: input.evidence, at: input.at });
    const eventId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "actorId", "eventType", "fromState", "toState", "evidenceId", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${input.registrationId}, ${input.evidence.verifierId}, 'recipient_ownership_confirmed', 'verification_pending', ${input.evidence.version}, 'operator_call_verified', ${input.at})`;
  });
}

export async function verifyPrismaRealRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ evidence: realOwnershipEvidenceSchema }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input);
    const operator = await actor(tx, locked.runtime, locked.users, input.actorId, "verify");
    if (!await ownershipExists(tx, input.evidence)) throw new Error("Ownership evidence unavailable.");
    const transition = verifyRealRecipient({ registration: registrationReal(locked.row), actor: operator, target: locked.target, evidence: input.evidence, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'verified_inactive', "verificationMethod" = 'operator_call', "verificationEvidenceId" = 'operator_call_verified', "verifiedBy" = ${input.actorId}, "verifiedAt" = ${input.at} WHERE "id" = ${locked.row.id} AND "state" = 'verification_pending'`;
    if (changed !== 1) throw new Error("Registration changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_verified", transition.audit.from, "operator_call_verified");
  });
}

export async function activatePrismaRealRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ key: keySchema }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input);
    const operator = await actor(tx, locked.runtime, locked.users, input.actorId, "register");
    ready(locked.runtime, input.key);
    const current = registrationReal(locked.row);
    if (!current.ciphertext || current.ciphertext.keyVersion !== input.key.keyVersion || !nonceWithinHighWater(current.ciphertext.nonce, locked.runtime.nonceHighWater)) throw new Error("Ciphertext unavailable.");
    if (!current.evidence || !await ownershipExists(tx, current.evidence)) throw new Error("Ownership evidence unavailable.");
    const plaintext = decryptInactiveRecipient(current.ciphertext, input.key.key, { environment: "preview", registrationId: current.id, registrationVersion: current.version, keyVersion: input.key.keyVersion });
    try { if (!plaintext.length) throw new Error("Ciphertext unavailable."); } finally { plaintext.fill(0); }
    const transition = activateRealRecipient({ registration: current, actor: operator, target: locked.target, activeRegistration: locked.rows.find((row) => row.state === "active") ?? null, ciphertextValid: true, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'active', "activatedAt" = ${input.at} WHERE "id" = ${current.id} AND "state" = 'verified_inactive'`;
    if (changed !== 1) throw new Error("Registration changed.");
    const updated = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "recipientVersion" = ${current.version}, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = 'preview' AND "revision" = ${locked.runtime.revision}`;
    if (updated !== 1) throw new Error("Runtime changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_activated", transition.audit.from, "operator_call_verified");
  });
}

export async function revokePrismaRealRecipient(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = base.extend({ reason: z.enum(["withdrawn", "replaced", "verification_stopped"]) }).parse(value);
  await repository.transaction(async (tx) => {
    const locked = await lockedRecipient(tx, input);
    const current = registrationReal(locked.row);
    const user = locked.users.find((entry) => entry.id === input.actorId);
    const operator = input.reason === "withdrawn" && input.actorId === current.userId && isEligibleAdmin(user) ? { user, assignments: [] } : await actor(tx, locked.runtime, locked.users, input.actorId, "register");
    const transition = revokeRealRecipient({ registration: current, actor: operator, reason: input.reason, at: input.at });
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = ${transition.registration.state}, "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "keyVersion" = NULL, "revokedAt" = ${input.at} WHERE "id" = ${current.id} AND "state" = ${current.state}`;
    if (changed !== 1) throw new Error("Registration changed.");
    await append(tx, transition.registration, input.actorId, input.at, "recipient_revoked", transition.audit.from, null, transition.audit.reason);
  });
}

/** Only the wiring caller may hold the returned number, for the duration of its call. */
export async function decryptActiveRecipientPhone(repository: PrismaDispatchRepository, value: { key: { keyVersion: string; key: Buffer }; now: Date }): Promise<{ to: string; registrationId: string; version: string } | null> {
  try {
    const input = z.object({ key: keySchema, now: z.date() }).strict().parse(value);
    return await repository.transaction(async (tx) => {
      const runtime = await runtimeLock(tx);
      ready(runtime, input.key);
      if (runtime.blocked) return null;
      const links = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "state" = 'active'`;
      if (links.length !== 1) return null;
      const [target] = await tx.$queryRaw<RecipientUser[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${links[0].userId} FOR UPDATE`;
      const rows = await rowsLock(tx);
      const active = rows.filter((row) => row.state === "active");
      if (active.length !== 1) return null;
      const row = active[0];
      const current = registrationReal(row);
      if (row.userId !== links[0].userId || current.purposeVersion !== "application-received-v1" || current.policyVersion !== "g4-v1" || runtime.recipientVersion !== current.version || !recipientAvailableReal(current, target, { id: row.id, version: row.version, userId: row.userId }) || !current.ciphertext || current.ciphertext.keyVersion !== input.key.keyVersion || !nonceWithinHighWater(current.ciphertext.nonce, runtime.nonceHighWater) || !current.evidence || current.evidence.verifiedAt > input.now || !await ownershipExists(tx, current.evidence)) return null;
      const plaintext = decryptInactiveRecipient(current.ciphertext, input.key.key, { environment: "preview", registrationId: current.id, registrationVersion: current.version, keyVersion: input.key.keyVersion });
      try {
        // Validate bytes before creating the unavoidable, short-lived JS string.
        if (plaintext.length < 9 || plaintext.length > 15 || plaintext.some((byte) => byte < 48 || byte > 57)) return null;
        return { to: plaintext.toString("utf8"), registrationId: current.id, version: current.version };
      } finally { plaintext.fill(0); }
    });
  } catch { return null; }
}
