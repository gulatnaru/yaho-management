import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSyntheticRecipient, dispatchContextSchema, dispatchPermitSchema, realDispatchContextSchema } from "@/lib/kakao/send-contract";
import { evaluateSendGate } from "@/lib/kakao/send-config";
import { evaluateSyntheticSendCost, type SyntheticQuote } from "@/server/kakao/budget";
import { recipientAvailable } from "@/server/kakao/recipient-registration";
import { decryptInactiveRecipient, nonceWithinHighWater } from "@/server/kakao/recipient-crypto";
import { PrismaDispatchRepository, type DispatchRepository } from "@/server/kakao/dispatch-repository";

function period(now: Date): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (kind: string) => parts.find((x) => x.type === kind)?.value;
  const month = `${get("year")}-${get("month")}`;
  return { month, day: `${month}-${get("day")}` };
}
class BudgetDenied extends Error {}
type GuardInput = { dispatchId: string; claimToken: string; context: unknown; config: unknown; policy: unknown; quote: SyntheticQuote; now: Date; recipientKey?: { keyVersion: string; key: Buffer; synthetic?: true }; canIssue?: () => boolean };
type GuardExpectations = { kind: "mock" | "real"; policyVersion: "g2-v1" | "g4-v1"; verificationMethod: "synthetic_call" | "operator_call"; verificationEvidenceId: "mock_ownership_v1" | "operator_call_verified"; ownershipEventType: "synthetic_ownership_confirmed" | "recipient_ownership_confirmed"; requireSyntheticKey: boolean };
const MOCK_EXPECTATIONS: GuardExpectations = { kind: "mock", policyVersion: "g2-v1", verificationMethod: "synthetic_call", verificationEvidenceId: "mock_ownership_v1", ownershipEventType: "synthetic_ownership_confirmed", requireSyntheticKey: true };
const REAL_EXPECTATIONS: GuardExpectations = { kind: "real", policyVersion: "g4-v1", verificationMethod: "operator_call", verificationEvidenceId: "operator_call_verified", ownershipEventType: "recipient_ownership_confirmed", requireSyntheticKey: false };
function authenticatedCiphertext(value: { ciphertext: Uint8Array; nonce: Uint8Array; tag: Uint8Array; keyVersion: string }, id: string, version: string, key: GuardInput["recipientKey"], requireSynthetic: boolean): boolean {
  if (!key || (requireSynthetic ? key.synthetic !== true : key.synthetic === true) || key.keyVersion !== value.keyVersion || !Buffer.isBuffer(key.key) || key.key.length !== 32) return false;
  try {
    const binding = { environment: "preview", registrationId: id, registrationVersion: version, keyVersion: value.keyVersion } as const;
    const ciphertext = { ciphertext: Buffer.from(value.ciphertext), nonce: Buffer.from(value.nonce), tag: Buffer.from(value.tag) };
    // Real branch uses the real (non-synthetic) AES-256-GCM primitive from
    // recipient-crypto.ts; the mock branch keeps decryptSyntheticRecipient.
    // AAD "yaho-kakao-recipient-v1" is identical on both sides.
    const plaintext = requireSynthetic
      ? decryptSyntheticRecipient(ciphertext, key.key, binding, { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true })
      : decryptInactiveRecipient(ciphertext, key.key, binding);
    try { return plaintext.length > 0; } finally { plaintext.fill(0); }
  } catch { return false; }
}
/** WIP synthetic reference only; not wired to the worker or a persistent repository. */
export async function acquireDispatchPermit(repository: DispatchRepository | PrismaDispatchRepository, input: GuardInput) {
  if (repository instanceof PrismaDispatchRepository) return acquirePrismaDispatchPermit(repository, input);
  const parsed = dispatchContextSchema.safeParse(input.context);
  if (!parsed.success || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return null;
  return repository.transaction(async (state) => {
    const dispatch = state.dispatches.find((d) => d.id === input.dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    if (!dispatch || !outbox || !state.runtime || !evaluateSendGate({ config: input.config, runtime: { environment: state.runtime.environment, provider: state.runtime.provider, blocked: state.runtime.blocked, activationEpoch: state.runtime.activationEpoch }, policy: input.policy, occurredAt: outbox.occurredAt }).allowed) return null;
    if (dispatch.clientKey !== `${state.runtime.namespace}:${outbox.dedupeKey}`) return null;
    if (outbox.status !== "processing" || outbox.claimToken !== input.claimToken || !outbox.leaseExpiresAt || outbox.leaseExpiresAt <= input.now || outbox.occurredAt > input.now || input.now.getTime() >= outbox.occurredAt.getTime() + 86_400_000) return null;
    const recipient = state.recipients.find((r) => r.id === parsed.data.recipientId && r.version === parsed.data.recipientVersion);
    const target = recipient && state.users?.find((u) => u.id === recipient.userId);
    if (!recipient || !recipientAvailable(recipient.registration, target, { id: recipient.id, version: recipient.version, userId: recipient.userId })) return null;
    const key = z.object({ ciphertext: z.object({ ciphertext: z.instanceof(Uint8Array), nonce: z.instanceof(Uint8Array), tag: z.instanceof(Uint8Array), keyVersion: z.string() }) }).passthrough().safeParse(recipient.registration);
    if (!key.success || key.data.ciphertext.keyVersion !== state.runtime.keyVersion || !state.runtime.nonceCurrent || !state.runtime.recoveryVerified || !state.runtime.rotationComplete) return null;
    if (state.runtime.nonceHighWater === undefined || state.nonceHighWaters?.[state.runtime.keyVersion] !== state.runtime.nonceHighWater || !nonceWithinHighWater(key.data.ciphertext.nonce, state.runtime.nonceHighWater)) return null;
    const verification = z.object({ evidence: z.object({ id: z.literal("mock_ownership_v1"), method: z.literal("synthetic_call"), synthetic: z.literal(true), success: z.literal(true), registrationId: z.string(), version: z.string(), verifierId: z.string(), verifiedAt: z.date() }) }).passthrough().safeParse(recipient.registration);
    if (!verification.success || !state.ownershipEvidence?.some((entry) => { const candidate = verification.data.evidence; const saved = z.object({ id: z.literal("mock_ownership_v1"), method: z.literal("synthetic_call"), synthetic: z.literal(true), success: z.literal(true), registrationId: z.string(), version: z.string(), verifierId: z.string(), verifiedAt: z.date() }).strict().safeParse(entry); return saved.success && saved.data.registrationId === candidate.registrationId && saved.data.version === candidate.version && saved.data.verifierId === candidate.verifierId && saved.data.verifiedAt.getTime() === candidate.verifiedAt.getTime(); })) return null;
    if (!authenticatedCiphertext(key.data.ciphertext, recipient.id, recipient.version, input.recipientKey, true)) return null;
    const fixed = dispatchContextSchema.safeParse(dispatch.context);
    if (!fixed.success || outbox.dedupeKey !== parsed.data.dedupeKey || JSON.stringify(fixed.data) !== JSON.stringify(parsed.data)) return null;
    const own = state.slots.filter((s) => s.dispatchId === dispatch.id);
    if (own.length !== dispatch.slotCount || own.length >= 5 || own.some((s) => s.status !== "rejected") || !["ready", "rejected"].includes(dispatch.state)) return null;
    const { day, month } = period(input.now);
    const current = state.slots.filter((s) => s.month === month);
    if (state.slots.some((s) => s.reserved === null || s.confirmed === null || s.costSummaryPurgedAt) || state.lookups.some((l) => l.reserved === null || l.confirmed === null)) return null;
    const carry = state.slots.filter((s) => s.month < month && s.reserved! > 0).reduce((n, s) => n + s.reserved!, 0);
    const message = current.reduce((n, s) => n + s.reserved! + s.confirmed!, carry);
    const lookupExposure = state.lookups.filter((l) => l.month <= month).reduce((n, l) => n + l.reserved! + (l.month === month ? l.confirmed! : 0), 0);
    const additional = state.monthlyAdditionalCosts[month];
    const plan = additional === undefined ? input.quote?.monthlyPlan : additional;
    const exposure = { dayRequests: state.slots.filter((s) => s.day === day).length, monthRequests: current.length, message, total: message + plan + lookupExposure };
    const reservation = evaluateSyntheticSendCost({ quote: input.quote, exposure });
    if (!reservation.ok) return null;
    const slotId = randomUUID();
    const permit = dispatchPermitSchema.safeParse({ dispatchId: dispatch.id, slotId, claimToken: input.claimToken, providerId: "solapi", context: parsed.data });
    if (!permit.success) return null;
    if (input.canIssue && !input.canIssue()) return null;
    if (additional === undefined) state.monthlyAdditionalCosts[month] = input.quote.monthlyPlan;
    state.slots.push({ id: slotId, dispatchId: dispatch.id, sequence: own.length + 1, month, day, status: "in_flight", reserved: reservation.amount, confirmed: 0, issuedAt: input.now });
    dispatch.slotCount++; dispatch.state = "in_flight"; dispatch.auditSequence++;
    state.audits.push({ eventId: randomUUID(), dispatchId: dispatch.id, slotId, sequence: dispatch.auditSequence, eventType: "permit_issued", occurredAt: input.now });
    return permit.data;
  });
}

/** Retain the original exposure and first observation; no timeout can issue a new slot. */
export async function markDispatchUnknown(repository: DispatchRepository, input: { dispatchId: string; slotId: string; at: Date }): Promise<void> {
  if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) throw new Error("Invalid observation time.");
  await repository.transaction(async (state) => {
    const dispatch = state.dispatches.find((d) => d.id === input.dispatchId);
    const slot = state.slots.find((s) => s.id === input.slotId && s.dispatchId === input.dispatchId);
    if (!dispatch || !slot || !["in_flight", "unknown"].includes(slot.status)) throw new Error("Unknown slot unavailable.");
    if (slot.status === "unknown") return;
    slot.status = "unknown"; dispatch.state = "unknown"; dispatch.auditSequence++;
    if (dispatch.unknownSince === null) dispatch.unknownSince = new Date(input.at);
    state.audits.push({ eventId: randomUUID(), dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "result_unknown", occurredAt: input.at });
  });
}

/** WIP Prisma path; requires a separately validated database before wiring. */
export async function acquirePrismaDispatchPermit(repository: import("@/server/kakao/dispatch-repository").PrismaDispatchRepository, input: GuardInput) {
  // Mock-first branch selection (same rule as the worker): a mock context also
  // parses as a real context, so mock success wins; both failing is null.
  const mockParsed = dispatchContextSchema.safeParse(input.context);
  const realParsed = mockParsed.success ? null : realDispatchContextSchema.safeParse(input.context);
  const parsed = mockParsed.success ? mockParsed : realParsed;
  const expectations: GuardExpectations = mockParsed.success ? MOCK_EXPECTATIONS : REAL_EXPECTATIONS;
  if (!parsed || !parsed.success || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return null;
  try { return await repository.transaction(async (tx) => {
    type Runtime = { environment: "preview"; blocked: boolean; activationEpoch: Date | null; providerId: string | null; namespace: string; recipientVersion: string | null; templateVersion: string | null; costPolicyVersion: string | null; policyVersion: string | null; keyVersion: string | null; nonceHighWater: bigint; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean };
    const [runtime] = await tx.$queryRaw<Runtime[]>`SELECT "environment", "blocked", "activationEpoch", "providerId", "namespace", "recipientVersion", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    const [link] = await tx.$queryRaw<{ outboxId: string; recipientId: string }[]>`SELECT "outboxId", "recipientId" FROM "NotificationDispatch" WHERE "id" = ${input.dispatchId}`;
    if (!runtime || !link) return null;
    type Outbox = { id: string; eventKind: string; audience: string; entityId: string; dedupeKey: string; occurredAt: Date; status: string; claimToken: string | null; leaseExpiresAt: Date | null };
    const [outbox] = await tx.$queryRaw<Outbox[]>`SELECT "id", "eventKind", "audience", "entityId", "dedupeKey", "occurredAt", "status", "claimToken", "leaseExpiresAt" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    if (!outbox || outbox.eventKind !== "application.received" || outbox.audience !== "admin") return null;
    const [submission] = await tx.$queryRaw<{ submittedAt: Date; personalDataPurgedAt: Date | null }[]>`SELECT "submittedAt", "personalDataPurgedAt" FROM "ReservationApplicationSubmission" WHERE "id" = ${outbox.entityId} FOR SHARE`;
    if (!submission || submission.personalDataPurgedAt !== null || submission.submittedAt.getTime() !== parsed.data.submittedAt.getTime()) return null;
    const [owner] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (!outbox || !owner) return null;
    const [user] = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${owner.userId} FOR UPDATE`;
    type Registration = { id: string; version: string; userId: string; environment: string; service: string; state: string; ciphertext: Uint8Array | null; nonce: Uint8Array | null; tag: Uint8Array | null; keyVersion: string | null; verificationMethod: string | null; verificationEvidenceId: string | null; verifiedBy: string | null; verifiedAt: Date | null };
    const [recipient] = await tx.$queryRaw<Registration[]>`SELECT "id", "version", "userId", "environment", "service", "state", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    type Dispatch = { id: string; outboxId: string; recipientId: string; recipientVersion: string; templateId: string; templateVersion: string; submittedAt: Date; environment: string; providerId: string; clientKey: string; slotCount: number; auditSequence: number; reconciliationState: string };
    const [dispatch] = await tx.$queryRaw<Dispatch[]>`SELECT "id", "outboxId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "environment", "providerId", "clientKey", "slotCount", "auditSequence", "reconciliationState" FROM "NotificationDispatch" WHERE "id" = ${input.dispatchId} FOR UPDATE`;
    if (!user || !recipient || !dispatch || dispatch.outboxId !== outbox.id || dispatch.recipientId !== recipient.id || recipient.userId !== user.id || user.role !== "ADMIN" || !user.isActive || user.mustChangePassword) return null;
    if (recipient.environment !== "preview" || recipient.service !== "application.received" || recipient.state !== "active" || recipient.id !== parsed.data.recipientId || recipient.version !== parsed.data.recipientVersion || dispatch.recipientVersion !== recipient.version || !recipient.ciphertext?.length || recipient.nonce?.length !== 12 || recipient.tag?.length !== 16 || !recipient.keyVersion || recipient.verificationMethod !== expectations.verificationMethod || recipient.verificationEvidenceId !== expectations.verificationEvidenceId || !recipient.verifiedBy || !recipient.verifiedAt) return null;
    if (!runtime.nonceCurrent || !runtime.recoveryVerified || !runtime.rotationComplete || !runtime.keyVersion || runtime.keyVersion !== recipient.keyVersion || runtime.recipientVersion !== recipient.version || runtime.templateVersion !== parsed.data.templateVersion || runtime.costPolicyVersion !== expectations.policyVersion || runtime.policyVersion !== expectations.policyVersion || !runtime.namespace || dispatch.clientKey !== `${runtime.namespace}:${outbox.dedupeKey}`) return null;
    if (!nonceWithinHighWater(recipient.nonce, runtime.nonceHighWater)) return null;
    const evidence = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "eventType" = ${expectations.ownershipEventType} AND "registrationId" = ${recipient.id} AND "toState" = ${recipient.version} AND "actorId" = ${recipient.verifiedBy} AND "evidenceId" = ${expectations.verificationEvidenceId} AND "occurredAt" = ${recipient.verifiedAt} LIMIT 1`;
    if (!evidence.length) return null;
    if (!authenticatedCiphertext({ ciphertext: recipient.ciphertext, nonce: recipient.nonce, tag: recipient.tag, keyVersion: recipient.keyVersion }, recipient.id, recipient.version, input.recipientKey, expectations.requireSyntheticKey)) return null;
    if (!runtime.activationEpoch || !evaluateSendGate({ config: input.config, runtime: { environment: runtime.environment, provider: runtime.providerId, blocked: runtime.blocked, activationEpoch: runtime.activationEpoch }, policy: input.policy, occurredAt: outbox.occurredAt }).allowed) return null;
    if (dispatch.environment !== "preview" || dispatch.providerId !== "solapi" || dispatch.templateId !== parsed.data.templateId || dispatch.templateVersion !== parsed.data.templateVersion || dispatch.submittedAt.getTime() !== parsed.data.submittedAt.getTime() || outbox.dedupeKey !== parsed.data.dedupeKey) return null;
    if (outbox.status !== "processing" || outbox.claimToken !== input.claimToken || !outbox.leaseExpiresAt || outbox.leaseExpiresAt <= input.now || outbox.occurredAt > input.now || input.now.getTime() >= outbox.occurredAt.getTime() + 86_400_000) return null;
    if (!["ready", "rejected"].includes(dispatch.reconciliationState)) return null;
    const rows = await tx.$queryRaw<{ sequence: number; status: string }[]>`SELECT "sequence", "status" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' ORDER BY "sequence" FOR UPDATE`;
    if (rows.length !== dispatch.slotCount || rows.length >= 5 || rows.some((s, i) => s.sequence !== i + 1 || s.status !== "rejected")) return null;
    const { day, month } = period(input.now);
    const dayId = randomUUID(); const monthId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion") VALUES (${dayId}, 'preview', 'application.received', 'day', ${day}, ${expectations.policyVersion}) ON CONFLICT ("environment", "service", "periodType", "periodKey") DO NOTHING`;
    await tx.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion") VALUES (${monthId}, 'preview', 'application.received', 'month', ${month}, ${expectations.policyVersion}) ON CONFLICT ("environment", "service", "periodType", "periodKey") DO NOTHING`;
    type Period = { id: string; requestCount: number; revision: number; planApplied: boolean; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; otherMilliKrw: bigint; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint };
    const [daily] = await tx.$queryRaw<Period[]>`SELECT "id", "requestCount", "revision", "planApplied", "reservedMilliKrw", "confirmedMilliKrw", "otherMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'day' AND "periodKey" = ${day} FOR UPDATE`;
    const [monthly] = await tx.$queryRaw<Period[]>`SELECT "id", "requestCount", "revision", "planApplied", "reservedMilliKrw", "confirmedMilliKrw", "otherMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'month' AND "periodKey" = ${month} FOR UPDATE`;
    const [carried] = await tx.$queryRaw<{ message: bigint; lookup: bigint }[]>`SELECT COALESCE(SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'SEND_SLOT'), 0)::bigint AS "message", COALESCE(SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'LOOKUP_COST'), 0)::bigint AS "lookup" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE d."environment" = 'preview' AND c."monthKey" < ${month} AND c."reservedMilliKrw" > 0`;
    if (!daily || !monthly || !carried) throw new Error("Budget unavailable.");
    const values = [monthly.reservedMilliKrw, monthly.confirmedMilliKrw, monthly.otherMilliKrw, monthly.lookupReservedMilliKrw, monthly.lookupConfirmedMilliKrw, carried.message, carried.lookup];
    if (values.some((x) => x < 0n || x > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error("Budget invalid.");
    const other = Number(monthly.otherMilliKrw);
    if (monthly.planApplied && other < input.quote.monthlyPlan) throw new Error("Monthly plan state invalid.");
    const planAndExtras = other + (monthly.planApplied ? 0 : input.quote?.monthlyPlan);
    const message = Number(monthly.reservedMilliKrw) + Number(monthly.confirmedMilliKrw) + Number(carried.message);
    const exposure = { dayRequests: daily.requestCount, monthRequests: monthly.requestCount, message, total: message + planAndExtras + Number(monthly.lookupReservedMilliKrw) + Number(monthly.lookupConfirmedMilliKrw) + Number(carried.lookup) };
    const reservation = evaluateSyntheticSendCost({ quote: input.quote, exposure });
    if (!reservation.ok) throw new BudgetDenied();
    const slotId = randomUUID(); const auditId = randomUUID();
    const permit = dispatchPermitSchema.safeParse({ dispatchId: dispatch.id, slotId, claimToken: input.claimToken, providerId: "solapi", context: parsed.data });
    if (!permit.success) throw new BudgetDenied();
    if (input.canIssue && !input.canIssue()) throw new BudgetDenied();
    await tx.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${slotId}, ${dispatch.id}, ${rows.length + 1}, 'in_flight', ${input.now}, ${day}, ${month}, ${BigInt(reservation.amount)}, 'reserved')`;
    const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount" = "slotCount" + 1, "auditSequence" = "auditSequence" + 1, "reconciliationState" = 'in_flight' WHERE "id" = ${dispatch.id} AND "slotCount" = ${rows.length}`;
    if (changed !== 1) throw new Error("Dispatch changed.");
    const dayChanged = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "requestCount" = "requestCount" + 1, "reservedMilliKrw" = "reservedMilliKrw" + ${BigInt(reservation.amount)}, "revision" = "revision" + 1 WHERE "id" = ${daily.id} AND "revision" = ${daily.revision}`;
    const monthChanged = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "requestCount" = "requestCount" + 1, "reservedMilliKrw" = "reservedMilliKrw" + ${BigInt(reservation.amount)}, "carryMilliKrw" = ${carried.message}, "lookupCarryMilliKrw" = ${carried.lookup}, "otherMilliKrw" = ${BigInt(planAndExtras)}, "planApplied" = true, "revision" = "revision" + 1 WHERE "id" = ${monthly.id} AND "revision" = ${monthly.revision}`;
    if (dayChanged !== 1 || monthChanged !== 1) throw new Error("Budget changed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "outboxId", "dispatchId", "slotId", "eventType", "sequence", "toState", "policyVersion", "occurredAt") VALUES (${auditId}, ${auditId}, 'preview', ${outbox.id}, ${dispatch.id}, ${slotId}, 'permit_issued', ${dispatch.auditSequence + 1}, 'in_flight', ${expectations.policyVersion}, ${input.now})`;
    return permit.data;
  }); } catch (error) { if (error instanceof BudgetDenied) return null; throw error; }
}
