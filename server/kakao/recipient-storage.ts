import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSyntheticRecipient, dispatchPermitSchema } from "@/lib/kakao/send-contract";
import { decryptInactiveRecipient, encryptPendingRecipient, nonceWithinHighWater } from "@/server/kakao/recipient-crypto";
import { activateRecipient, isEligibleAdmin, purgeRecipient, recipientAvailable, registerRecipient, revokeRecipient, verifyRecipient, type Registration } from "@/server/kakao/recipient-registration";
import type { CoreState, DispatchRepository } from "@/server/kakao/dispatch-repository";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine((value) => !/(?:\d[-_]*){7,}/.test(value));
const command = z.object({ registrationId: id, actorId: id, at: z.date() }).strict();
const keySchema = z.object({ keyVersion: id, key: z.instanceof(Buffer).refine((b) => b.length === 32), synthetic: z.literal(true) }).strict();
const evidenceSchema = z.object({ id: z.literal("mock_ownership_v1"), method: z.literal("synthetic_call"), synthetic: z.literal(true), success: z.literal(true), registrationId: id, version: id, verifierId: id, verifiedAt: z.date() }).strict();
const safety = { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true } as const;
type Key = z.infer<typeof keySchema>;

function authority(state: CoreState, actorId: string, assignment: "register" | "verify") {
  const runtime = state.runtime;
  const user = state.users?.find((u) => u.id === actorId);
  const owner = state.users?.find((u) => u.id === runtime?.ownerId);
  if (!runtime?.ownerId || !isEligibleAdmin(owner) || !isEligibleAdmin(user) || (runtime.ownerId !== actorId && !state.recipientAssignments?.some((a) => a.ownerId === runtime.ownerId && a.userId === actorId && a.assignment === assignment && a.active))) throw new Error("Recipient authority unavailable.");
  return { user, assignments: [assignment] };
}
function cryptoReady(state: CoreState, key: Key): void {
  const runtime = state.runtime;
  if (!runtime || runtime.keyVersion !== key.keyVersion || !runtime.nonceCurrent || !runtime.recoveryVerified || !runtime.rotationComplete) throw new Error("Recipient key unavailable.");
  const prior = state.nonceHighWaters?.[key.keyVersion];
  if (runtime.nonceHighWater === undefined || (prior === undefined ? runtime.nonceHighWater !== 0n : prior !== runtime.nonceHighWater)) throw new Error("Nonce history unavailable.");
}
function decrypt(registration: Registration, key: Key): void {
  if (!registration.ciphertext || registration.ciphertext.keyVersion !== key.keyVersion) throw new Error("Recipient ciphertext unavailable.");
  const plaintext = decryptInactiveRecipient(registration.ciphertext, key.key, { environment: "preview", registrationId: registration.id, registrationVersion: registration.version, keyVersion: key.keyVersion });
  try { if (!plaintext.length) throw new Error("Recipient ciphertext unavailable."); } finally { plaintext.fill(0); }
}
function stored(state: CoreState, registrationId: string) {
  const row = state.recipients.find((r) => r.id === registrationId);
  if (!row) throw new Error("Registration unavailable.");
  return row;
}
function audit(state: CoreState, transition: { registration: Registration; audit: { from: string; to: string; actorId: string; at: Date; reason: string } }, eventType: "recipient_registered" | "recipient_verified" | "recipient_activated" | "recipient_revoked" | "recipient_purged") {
  state.audits.push({ eventId: randomUUID(), registrationId: transition.registration.id, fromState: transition.audit.from, toState: transition.audit.to, actorId: transition.audit.actorId, occurredAt: transition.audit.at, eventType, ...(eventType === "recipient_verified" ? { evidenceId: "mock_ownership_v1" } : {}), ...(eventType === "recipient_revoked" ? { code: transition.audit.reason } : {}) });
}

/** The current owner grants or withdraws a synthetic registration duty with an atomic audit. */
export async function setStoredSyntheticRecipientAssignment(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = z.object({ commandId: id, actorId: id, executorId: id, assignment: z.enum(["register", "verify"]), active: z.boolean(), at: z.date() }).strict().parse(value);
  await repository.transaction(async (state) => {
    const owner = authority(state, input.actorId, "register");
    if (state.runtime?.ownerId !== owner.user.id || !isEligibleAdmin(state.users?.find((u) => u.id === input.executorId))) throw new Error("Assignment unavailable.");
    const eventType = input.active ? "recipient_assignment_granted" : "recipient_assignment_revoked";
    const prior = state.audits.find((a) => a.commandId === input.commandId);
    if (prior) { if (prior.eventType !== eventType || prior.actorId !== input.actorId || prior.payloadBinding !== input.executorId || prior.code !== input.assignment) throw new Error("Command conflict."); return; }
    const list = state.recipientAssignments ??= [];
    const existing = list.find((a) => a.ownerId === input.actorId && a.userId === input.executorId && a.assignment === input.assignment);
    if (existing) existing.active = input.active; else list.push({ ownerId: input.actorId, userId: input.executorId, assignment: input.assignment, active: input.active });
    state.runtime.revision++;
    state.audits.push({ eventId: randomUUID(), commandId: input.commandId, eventType, actorId: input.actorId, payloadBinding: input.executorId, code: input.assignment, toState: input.active ? "assigned" : "unassigned", occurredAt: input.at });
  });
}

/** Synthetic-only in-memory adapter. Its nonce transaction commits before encryption. */
export async function registerStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = z.object({ registrationId: id, version: id, userId: id, actorId: id, purposeVersion: id, policyVersion: id, key: keySchema, at: z.date() }).strict().parse(value);
  const sequence = await repository.transaction(async (state) => {
    authority(state, input.actorId, "register"); cryptoReady(state, input.key);
    const runtime = state.runtime!;
    if (runtime.nonceHighWater === undefined || runtime.nonceHighWater < 0n || runtime.nonceHighWater >= (1n << 63n) - 1n) throw new Error("Nonce unavailable.");
    const prior = state.nonceHighWaters?.[input.key.keyVersion];
    if ((prior === undefined && runtime.nonceHighWater !== 0n) || (prior !== undefined && prior !== runtime.nonceHighWater)) throw new Error("Nonce history unavailable.");
    runtime.nonceHighWater++;
    state.nonceHighWaters ??= {}; state.nonceHighWaters[input.key.keyVersion] = runtime.nonceHighWater;
    state.audits.push({ eventId: randomUUID(), eventType: "nonce_consumed", actorId: input.actorId, keyVersion: input.key.keyVersion, occurredAt: input.at });
    return runtime.nonceHighWater;
  });
  // Deterministic synthetic fixture, generated in memory only and never derived from a person.
  const seed = createHash("sha256").update(`g2-synthetic-${input.registrationId}-${input.version}`).digest();
  const plaintext = Buffer.from(`000${Array.from(seed.subarray(0, 8), (x) => x % 10).join("")}`);
  let ciphertext: ReturnType<typeof encryptPendingRecipient>;
  try { ciphertext = encryptPendingRecipient(plaintext, input.key.key, sequence, { environment: "preview", registrationId: input.registrationId, registrationVersion: input.version, keyVersion: input.key.keyVersion }); } finally { plaintext.fill(0); seed.fill(0); }
  await repository.transaction(async (state) => {
    const actor = authority(state, input.actorId, "register"); cryptoReady(state, input.key);
    const target = state.users?.find((u) => u.id === input.userId);
    const registration = { environment: "preview", service: "application.received", id: input.registrationId, version: input.version, userId: input.userId, purposeVersion: input.purposeVersion, policyVersion: input.policyVersion, state: "verification_pending", ciphertext: { ...ciphertext, keyVersion: input.key.keyVersion, synthetic: true }, evidence: null };
    if (state.recipients.some((r) => r.id === input.registrationId || (r.userId === input.userId && r.version === input.version))) throw new Error("Registration conflict.");
    const previousVersions = state.recipients.map((r) => { const current = r.registration as Registration; return { id: r.id, version: r.version, state: current.state }; });
    const transition = registerRecipient({ registration, actor, target, ownWorkNumberConfirmed: true, previousVersions, at: input.at });
    state.recipients.push({ id: input.registrationId, version: input.version, userId: input.userId, registration: transition.registration, target: null });
    audit(state, transition, "recipient_registered");
  });
}

export async function verifyStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = command.extend({ evidence: z.unknown() }).parse(value);
  await repository.transaction(async (state) => {
    const actor = authority(state, input.actorId, "verify"); const row = stored(state, input.registrationId);
    const target = state.users?.find((u) => u.id === row.userId);
    const evidence = evidenceSchema.parse(input.evidence);
    const found = state.ownershipEvidence?.some((entry) => {
      const saved = evidenceSchema.safeParse(entry);
      return saved.success && saved.data.registrationId === evidence.registrationId && saved.data.version === evidence.version && saved.data.verifierId === evidence.verifierId && saved.data.verifiedAt.getTime() === evidence.verifiedAt.getTime();
    });
    if (!found) throw new Error("Ownership evidence unavailable.");
    const transition = verifyRecipient({ registration: row.registration, actor, target, evidence, at: input.at });
    row.registration = transition.registration; audit(state, transition, "recipient_verified");
  });
}

export async function activateStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = command.extend({ key: keySchema }).parse(value);
  await repository.transaction(async (state) => {
    const actor = authority(state, input.actorId, "register"); cryptoReady(state, input.key); const row = stored(state, input.registrationId);
    const registration = row.registration as Registration;
    if (!registration.ciphertext || !nonceWithinHighWater(registration.ciphertext.nonce, state.runtime!.nonceHighWater!)) throw new Error("Nonce unavailable.");
    decrypt(registration, input.key);
    const proof = registration.evidence;
    if (!proof || !state.ownershipEvidence?.some((entry) => { const saved = evidenceSchema.safeParse(entry); return saved.success && saved.data.registrationId === proof.registrationId && saved.data.version === proof.version && saved.data.verifierId === proof.verifierId && saved.data.verifiedAt.getTime() === proof.verifiedAt.getTime(); })) throw new Error("Ownership evidence unavailable.");
    const active = state.recipients.find((r) => (r.registration as Registration).state === "active");
    const target = state.users?.find((u) => u.id === row.userId);
    const transition = activateRecipient({ registration, actor, target, activeRegistration: active ?? null, ciphertextValid: true, at: input.at });
    row.registration = transition.registration; audit(state, transition, "recipient_activated");
  });
}

export async function revokeStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = command.extend({ reason: z.enum(["withdrawn", "replaced", "verification_stopped"]) }).parse(value);
  await repository.transaction(async (state) => {
    const row = stored(state, input.registrationId); const user = state.users?.find((u) => u.id === input.actorId);
    const actor = input.reason === "withdrawn" && input.actorId === row.userId && isEligibleAdmin(user) ? { user, assignments: [] } : authority(state, input.actorId, "register");
    const transition = revokeRecipient({ registration: row.registration, actor, reason: input.reason, at: input.at });
    row.registration = transition.registration; audit(state, transition, "recipient_revoked");
  });
}

export async function purgeStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = command.extend({ commandId: id, approvalId: id, evidenceId: id }).parse(value);
  await repository.transaction(async (state) => {
    const runtime = state.runtime; const owner = state.users?.find((u) => u.id === runtime?.ownerId); const user = state.users?.find((u) => u.id === input.actorId);
    if (!runtime?.ownerId || runtime.purgeExecutorId !== input.actorId || !isEligibleAdmin(owner) || !isEligibleAdmin(user) || !state.recipientPurgeApprovals?.some((a) => a.registrationId === input.registrationId && a.actorId === owner.id && a.commandId === input.commandId && a.approvalId === input.approvalId && a.evidenceId === input.evidenceId)) throw new Error("Purge authority unavailable.");
    const actor = { user, assignments: ["purge"] }; const row = stored(state, input.registrationId);
    const transition = purgeRecipient({ registration: row.registration, actor, at: input.at });
    row.registration = transition.registration; audit(state, transition, "recipient_purged");
    Object.assign(state.audits[state.audits.length - 1], { commandId: input.commandId, approvalId: input.approvalId, evidenceId: input.evidenceId });
  });
}

/** Server-only use of an already issued permit. The caller must erase the returned buffer. */
export async function decryptStoredSyntheticRecipient(repository: DispatchRepository, value: unknown): Promise<Buffer> {
  const input = z.object({ permit: dispatchPermitSchema, key: keySchema, now: z.date() }).strict().parse(value);
  return repository.transaction(async (state) => {
    cryptoReady(state, input.key);
    if (state.runtime?.blocked !== false) throw new Error("Runtime blocked.");
    const dispatch = state.dispatches.find((d) => d.id === input.permit.dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    const slot = state.slots.find((s) => s.id === input.permit.slotId && s.dispatchId === dispatch?.id && s.status === "in_flight");
    if (!dispatch || !outbox || !slot || dispatch.state !== "in_flight" || outbox.status !== "processing" || outbox.claimToken !== input.permit.claimToken || !outbox.leaseExpiresAt || outbox.leaseExpiresAt <= input.now || JSON.stringify(dispatch.context) !== JSON.stringify(input.permit.context)) throw new Error("Permit unavailable.");
    const row = state.recipients.find((r) => r.id === dispatch.context.recipientId && r.version === dispatch.context.recipientVersion);
    const user = row && state.users?.find((u) => u.id === row.userId);
    if (!row || !recipientAvailable(row.registration, user, { id: row.id, version: row.version, userId: row.userId })) throw new Error("Recipient unavailable.");
    const registration = row.registration as Registration; const proof = registration.evidence;
    if (!proof || !state.ownershipEvidence?.some((entry) => { const saved = evidenceSchema.safeParse(entry); return saved.success && saved.data.registrationId === proof.registrationId && saved.data.version === proof.version && saved.data.verifierId === proof.verifierId && saved.data.verifiedAt.getTime() === proof.verifiedAt.getTime(); }) || !registration.ciphertext || registration.ciphertext.keyVersion !== input.key.keyVersion || !nonceWithinHighWater(registration.ciphertext.nonce, state.runtime!.nonceHighWater!)) throw new Error("Recipient unavailable.");
    return decryptSyntheticRecipient(registration.ciphertext, input.key.key, { environment: "preview", registrationId: row.id, registrationVersion: row.version, keyVersion: input.key.keyVersion }, safety);
  });
}
