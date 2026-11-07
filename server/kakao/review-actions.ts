import "server-only";
import { z } from "zod";
import { closePrismaUnconfirmed, type PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import { REAL_QUOTE, syntheticLookupBinding } from "@/server/kakao/budget";
import { pollDeliveryResult } from "@/server/kakao/reconcile";
import { buildRealLookupClient, type RealSendEnv } from "@/server/kakao/real-send-wiring";

// G4 stage 3E — review / approval / closure / lookup service functions.
// No Next.js imports: directly callable from tests. Every function takes a
// PrismaDispatchRepository plus explicit input and returns { ok: true } or
// { ok: false; reason } with a UI-displayable reason. Audit writes use
// eventId = commandId/approvalId for idempotency: an existing row with the
// same content is a no-op, a different content throws ("Command conflict").
// Guard scopes (PLAN §2.13) are enforced here, not just in the page:
// 7d review ADMIN+SUPER_ADMIN; 30d review / closure approval / lookup
// approval owner-only; closure execution closureExecutorId + ADMIN + not
// owner; lookup execution costExecutorId + ADMIN.

const DAY_MS = 86400000;
const POLL_MIN_INTERVAL_MS = 5 * 60 * 1000;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const sevenDayReviewInputSchema = z.object({ dispatchId: identifier, commandId: identifier, actorId: identifier, at: z.date() }).strict();
export const responsibilityReviewInputSchema = z.object({ dispatchId: identifier, commandId: identifier, actorId: identifier, at: z.date() }).strict();
export const closureApprovalInputSchema = z.object({ dispatchId: identifier, commandId: identifier, approvalId: identifier, evidenceId: identifier, actorId: identifier, at: z.date() }).strict();
export const executeClosureInputSchema = z.object({ dispatchId: identifier, commandId: identifier, actorId: identifier, approvalId: identifier, evidenceId: identifier, at: z.date() }).strict();
export const lookupApprovalInputSchema = z.object({ slotId: identifier, commandId: identifier, approvalId: identifier, executorId: identifier, actorId: identifier, at: z.date() }).strict();
export const pollRowDeliveryInputSchema = z.object({ slotId: identifier, commandId: identifier, approvalId: identifier, actorId: identifier, at: z.date() }).strict();

type Ok = { ok: true };
type Fail<R extends string> = { ok: false; reason: R };

/** Closure follow-up review is exactly 30 days after the closure time. */
export function closureNextReviewAt(at: Date): Date {
  return new Date(at.getTime() + 30 * DAY_MS);
}

function seoulDayMonth(at: Date): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, month: `${get("year")}-${get("month")}` };
}

type RuntimeRow = { ownerId: string | null; closureExecutorId: string | null; costExecutorId: string | null; policyVersion: string | null; revision: number };
type UserRow = { id: string; role: string; isActive: boolean; mustChangePassword: boolean };
type DispatchRow = { id: string; outboxId: string; reconciliationState: string; unknownSince: Date | null; reviewed7dAt: Date | null; responsibilityReviewedAt: Date | null; nextReviewAt: Date | null; auditSequence: number };
type AuditRow = { eventType: string; dispatchId: string | null; slotId: string | null; actorId: string | null; commandId: string | null; approvalId: string | null; evidenceId: string | null; payloadBinding: string | null };
type GuardTx = Parameters<Parameters<PrismaDispatchRepository["transaction"]>[0]>[0];

async function readRuntime(tx: GuardTx): Promise<RuntimeRow | null> {
  const [row] = await tx.$queryRaw<RuntimeRow[]>`SELECT "ownerId", "closureExecutorId", "costExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
  return row ?? null;
}
async function readUser(tx: GuardTx, id: string): Promise<UserRow | null> {
  const [row] = await tx.$queryRaw<UserRow[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  return row ?? null;
}
const isActiveAdmin = (user: UserRow | null): boolean => !!user && user.role === "ADMIN" && user.isActive && !user.mustChangePassword;
const isActiveAdminOrSuper = (user: UserRow | null): boolean => !!user && (user.role === "ADMIN" || user.role === "SUPER_ADMIN") && user.isActive && !user.mustChangePassword;
async function readDispatch(tx: GuardTx, dispatchId: string): Promise<DispatchRow | null> {
  const [row] = await tx.$queryRaw<DispatchRow[]>`SELECT "id", "outboxId", "reconciliationState", "unknownSince", "reviewed7dAt", "responsibilityReviewedAt", "nextReviewAt", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${dispatchId} FOR UPDATE`;
  return row ?? null;
}
async function readAuditByEventId(tx: GuardTx, eventId: string): Promise<AuditRow | null> {
  const [row] = await tx.$queryRaw<AuditRow[]>`SELECT "eventType", "dispatchId", "slotId", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${eventId}`;
  return row ?? null;
}
async function insertAudit(tx: GuardTx, value: {
  eventId: string; eventType: string; outboxId?: string | null; dispatchId?: string | null; slotId?: string | null;
  sequence?: number | null; actorId?: string | null; commandId?: string | null; approvalId?: string | null;
  evidenceId?: string | null; payloadBinding?: string | null; policyVersion: string | null; revision: number; occurredAt: Date;
}): Promise<void> {
  await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${value.eventId}, ${value.eventId}, 'preview', ${value.eventType}, ${value.outboxId ?? null}, ${value.dispatchId ?? null}, ${value.slotId ?? null}, ${value.sequence ?? null}, ${value.actorId ?? null}, ${value.commandId ?? null}, ${value.approvalId ?? null}, ${value.evidenceId ?? null}, ${value.payloadBinding ?? null}, ${value.policyVersion}, ${value.revision}, ${value.revision}, ${value.occurredAt})`;
}

/** 7-day check record. One-shot: reviewed7dAt is written only while NULL. */
export async function record7dReview(repository: PrismaDispatchRepository, value: unknown): Promise<Ok | Fail<"not_unknown" | "too_early" | "already_recorded">> {
  const input = sevenDayReviewInputSchema.parse(value);
  return repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.policyVersion) throw new Error("Review authority unavailable.");
    if (!isActiveAdminOrSuper(await readUser(tx, input.actorId))) throw new Error("Review authority unavailable.");
    const existing = await readAuditByEventId(tx, input.commandId);
    if (existing) {
      if (existing.eventType === "review_7d_recorded" && existing.dispatchId === input.dispatchId && existing.actorId === input.actorId) return { ok: true };
      throw new Error("Command conflict.");
    }
    const dispatch = await readDispatch(tx, input.dispatchId);
    if (!dispatch) throw new Error("Dispatch unavailable.");
    if (dispatch.reconciliationState !== "unknown" || !dispatch.unknownSince) return { ok: false, reason: "not_unknown" };
    if (dispatch.reviewed7dAt) return { ok: false, reason: "already_recorded" };
    if (input.at.getTime() < dispatch.unknownSince.getTime() + 7 * DAY_MS) return { ok: false, reason: "too_early" };
    const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "reviewed7dAt" = ${input.at}, "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "reviewed7dAt" IS NULL AND "auditSequence" = ${dispatch.auditSequence}`;
    if (changed !== 1) throw new Error("Dispatch changed.");
    await insertAudit(tx, { eventId: input.commandId, eventType: "review_7d_recorded", outboxId: dispatch.outboxId, dispatchId: dispatch.id, sequence: dispatch.auditSequence + 1, actorId: input.actorId, commandId: input.commandId, policyVersion: runtime.policyVersion, revision: runtime.revision, occurredAt: input.at });
    return { ok: true };
  });
}

/**
 * 30-day responsibility review. Repeats on a 30-day cadence (reviewNeeds):
 * the first review needs at >= unknownSince + 30 days (or at >= nextReviewAt
 * when nextReviewAt exists and is earlier); a repeat review needs at >=
 * responsibilityReviewedAt + 30 days (or at >= nextReviewAt). A repeat
 * inside the current cycle reports "already_recorded".
 */
export async function recordResponsibilityReview(repository: PrismaDispatchRepository, value: unknown): Promise<Ok | Fail<"not_owner" | "not_unknown" | "too_early" | "already_recorded">> {
  const input = responsibilityReviewInputSchema.parse(value);
  return repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.ownerId || !runtime.policyVersion) throw new Error("Review authority unavailable.");
    if (input.actorId !== runtime.ownerId) return { ok: false, reason: "not_owner" };
    if (!isActiveAdmin(await readUser(tx, input.actorId))) throw new Error("Review authority unavailable.");
    const existing = await readAuditByEventId(tx, input.commandId);
    if (existing) {
      if (existing.eventType === "responsibility_reviewed" && existing.dispatchId === input.dispatchId && existing.actorId === input.actorId) return { ok: true };
      throw new Error("Command conflict.");
    }
    const dispatch = await readDispatch(tx, input.dispatchId);
    if (!dispatch) throw new Error("Dispatch unavailable.");
    if (dispatch.reconciliationState !== "unknown" || !dispatch.unknownSince) return { ok: false, reason: "not_unknown" };
    const since = dispatch.unknownSince.getTime();
    const earlyNext = !!dispatch.nextReviewAt && dispatch.nextReviewAt.getTime() < since + 30 * DAY_MS;
    if (!dispatch.responsibilityReviewedAt) {
      const due = input.at.getTime() >= since + 30 * DAY_MS || (earlyNext && input.at.getTime() >= dispatch.nextReviewAt!.getTime());
      if (!due) return { ok: false, reason: "too_early" };
    } else {
      const due = input.at.getTime() >= dispatch.responsibilityReviewedAt.getTime() + 30 * DAY_MS || (!!dispatch.nextReviewAt && input.at.getTime() >= dispatch.nextReviewAt.getTime());
      if (!due) return { ok: false, reason: "already_recorded" };
    }
    const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "responsibilityReviewedAt" = ${input.at}, "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (changed !== 1) throw new Error("Dispatch changed.");
    await insertAudit(tx, { eventId: input.commandId, eventType: "responsibility_reviewed", outboxId: dispatch.outboxId, dispatchId: dispatch.id, sequence: dispatch.auditSequence + 1, actorId: input.actorId, commandId: input.commandId, policyVersion: runtime.policyVersion, revision: runtime.revision, occurredAt: input.at });
    return { ok: true };
  });
}

/**
 * Closure approval. Writes only the closure_approved audit row (sequence
 * NULL, like other approval rows) and does NOT change the dispatch row;
 * approval and execution are separate.
 */
export async function recordClosureApproval(repository: PrismaDispatchRepository, value: unknown): Promise<Ok | Fail<"not_owner" | "not_unknown" | "preconditions_unmet" | "already_approved">> {
  const input = closureApprovalInputSchema.parse(value);
  return repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.ownerId || !runtime.policyVersion) throw new Error("Closure authority unavailable.");
    if (input.actorId !== runtime.ownerId) return { ok: false, reason: "not_owner" };
    if (!isActiveAdmin(await readUser(tx, input.actorId))) throw new Error("Closure authority unavailable.");
    const existing = await readAuditByEventId(tx, input.approvalId);
    if (existing) {
      if (existing.eventType === "closure_approved" && existing.dispatchId === input.dispatchId && existing.commandId === input.commandId && existing.actorId === input.actorId && existing.evidenceId === input.evidenceId) return { ok: true };
      throw new Error("Command conflict.");
    }
    const [prior] = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "dispatchId" = ${input.dispatchId} AND "environment" = 'preview' AND "eventType" = 'closure_approved'`;
    if (prior) return { ok: false, reason: "already_approved" };
    const dispatch = await readDispatch(tx, input.dispatchId);
    if (!dispatch) throw new Error("Dispatch unavailable.");
    if (dispatch.reconciliationState !== "unknown" || !dispatch.unknownSince) return { ok: false, reason: "not_unknown" };
    const [outbox] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "NotificationOutbox" WHERE "id" = ${dispatch.outboxId} FOR UPDATE`;
    if (!outbox) throw new Error("Dispatch unavailable.");
    const since = dispatch.unknownSince.getTime();
    const sevenOk = !!dispatch.reviewed7dAt && dispatch.reviewed7dAt.getTime() - since >= 7 * DAY_MS && dispatch.reviewed7dAt.getTime() <= input.at.getTime();
    const thirtyOk = !!dispatch.responsibilityReviewedAt && dispatch.responsibilityReviewedAt.getTime() - since >= 30 * DAY_MS && dispatch.responsibilityReviewedAt.getTime() <= input.at.getTime();
    if (!sevenOk || !thirtyOk || !["sent", "failed"].includes(outbox.status)) return { ok: false, reason: "preconditions_unmet" };
    await insertAudit(tx, { eventId: input.approvalId, eventType: "closure_approved", outboxId: dispatch.outboxId, dispatchId: dispatch.id, actorId: input.actorId, commandId: input.commandId, approvalId: input.approvalId, evidenceId: input.evidenceId, policyVersion: runtime.policyVersion, revision: runtime.revision, occurredAt: input.at });
    return { ok: true };
  });
}

/**
 * Closure execution. Verifies the executor/owner split and the approval row,
 * then calls closePrismaUnconfirmed (body untouched); the twin re-validates
 * every precondition. nextReviewAt is exactly at + 30 days.
 */
export async function executeClosure(repository: PrismaDispatchRepository, value: unknown): Promise<Ok | Fail<"not_closure_executor" | "is_owner" | "not_approved" | "preconditions_unmet">> {
  const input = executeClosureInputSchema.parse(value);
  const gate = await repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.ownerId || !runtime.policyVersion) throw new Error("Closure authority unavailable.");
    if (!runtime.closureExecutorId || runtime.closureExecutorId !== input.actorId) return { ok: false, reason: "not_closure_executor" } as const;
    if (input.actorId === runtime.ownerId) return { ok: false, reason: "is_owner" } as const;
    if (!isActiveAdmin(await readUser(tx, input.actorId))) return { ok: false, reason: "not_closure_executor" } as const;
    const approval = await readAuditByEventId(tx, input.approvalId);
    if (!approval || approval.eventType !== "closure_approved" || approval.dispatchId !== input.dispatchId || approval.commandId !== input.commandId || approval.actorId !== runtime.ownerId || approval.evidenceId !== input.evidenceId) return { ok: false, reason: "not_approved" } as const;
    return null;
  });
  if (gate) return gate;
  try {
    await closePrismaUnconfirmed(repository, { commandId: input.commandId, dispatchId: input.dispatchId, actorId: input.actorId, approvalId: input.approvalId, evidenceId: input.evidenceId, at: input.at, nextReviewAt: closureNextReviewAt(input.at) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Closure approval unavailable")) return { ok: false, reason: "not_approved" };
    if (message.includes("Closure conditions unavailable") || message.includes("Closure authority unavailable")) return { ok: false, reason: "preconditions_unmet" };
    throw error;
  }
  return { ok: true };
}

/**
 * Lookup approval. Valid only on the approval day (Asia/Seoul): the binding
 * embeds that day, so a next-day lookup fails reserve with "blocked".
 */
export async function recordLookupApproval(repository: PrismaDispatchRepository, value: unknown): Promise<Ok | Fail<"not_owner" | "already_approved">> {
  const input = lookupApprovalInputSchema.parse(value);
  return repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.ownerId || !runtime.policyVersion) throw new Error("Lookup authority unavailable.");
    if (input.actorId !== runtime.ownerId) return { ok: false, reason: "not_owner" };
    if (!isActiveAdmin(await readUser(tx, input.actorId))) throw new Error("Lookup authority unavailable.");
    const { day, month } = seoulDayMonth(input.at);
    const binding = syntheticLookupBinding({ commandId: input.commandId, slotId: input.slotId, actorId: input.executorId, approvalId: input.approvalId, day, month });
    const evidenceId = `lookup:${input.slotId}`;
    const existing = await readAuditByEventId(tx, input.approvalId);
    if (existing) {
      if (existing.eventType === "lookup_approved" && existing.slotId === input.slotId && existing.commandId === input.commandId && existing.actorId === input.actorId && existing.evidenceId === evidenceId && existing.payloadBinding === binding) return { ok: true };
      throw new Error("Command conflict.");
    }
    const [prior] = await tx.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "slotId" = ${input.slotId} AND "commandId" = ${input.commandId} AND "environment" = 'preview' AND "eventType" = 'lookup_approved'`;
    if (prior) return { ok: false, reason: "already_approved" };
    const [slot] = await tx.$queryRaw<{ dispatchId: string }[]>`SELECT "dispatchId" FROM "NotificationCostReservation" WHERE "id" = ${input.slotId} AND "entryKind" = 'SEND_SLOT'`;
    if (!slot) throw new Error("Lookup slot unavailable.");
    const dispatch = await readDispatch(tx, slot.dispatchId);
    if (!dispatch) throw new Error("Dispatch unavailable.");
    await insertAudit(tx, { eventId: input.approvalId, eventType: "lookup_approved", outboxId: dispatch.outboxId, dispatchId: dispatch.id, slotId: input.slotId, actorId: input.actorId, commandId: input.commandId, approvalId: input.approvalId, evidenceId, payloadBinding: binding, policyVersion: runtime.policyVersion, revision: runtime.revision, occurredAt: input.at });
    return { ok: true };
  });
}

/** Pure UI-level advisory guard: minimum 5-minute interval, no in-flight lookup. Atomic guarantees live in reserve. */
export function pollEligibility(lastLookupAt: Date | null, hasInFlight: boolean, now: Date): Ok | Fail<"too_soon" | "lookup_in_flight"> {
  if (hasInFlight) return { ok: false, reason: "lookup_in_flight" };
  if (lastLookupAt && now.getTime() - lastLookupAt.getTime() < POLL_MIN_INTERVAL_MS) return { ok: false, reason: "too_soon" };
  return { ok: true };
}

/** Lookup execution (cost executor). Approval and execution are separate clicks. */
export async function pollRowDelivery(repository: PrismaDispatchRepository, env: RealSendEnv, value: unknown): Promise<{ ok: true; result: "recorded" | "unknown" } | Fail<"not_cost_executor" | "too_soon" | "lookup_in_flight" | "provider_unconfigured" | "blocked">> {
  const input = pollRowDeliveryInputSchema.parse(value);
  const gate: { ok: false; reason: "not_cost_executor" | "blocked" } | { lastLookupAt: Date | null; hasInFlight: boolean } = await repository.transaction(async (tx) => {
    const runtime = await readRuntime(tx);
    if (!runtime?.costExecutorId || runtime.costExecutorId !== input.actorId) return { ok: false, reason: "not_cost_executor" } as const;
    if (!isActiveAdmin(await readUser(tx, input.actorId))) return { ok: false, reason: "not_cost_executor" } as const;
    const [slot] = await tx.$queryRaw<{ dispatchId: string }[]>`SELECT "dispatchId" FROM "NotificationCostReservation" WHERE "id" = ${input.slotId} AND "entryKind" = 'SEND_SLOT'`;
    if (!slot) return { ok: false, reason: "blocked" } as const;
    const [last] = await tx.$queryRaw<{ issuedAt: Date | null }[]>`SELECT MAX("issuedAt") AS "issuedAt" FROM "NotificationCostReservation" WHERE "dispatchId" = ${slot.dispatchId} AND "entryKind" = 'LOOKUP_COST'`;
    const [inFlight] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationCostReservation" WHERE "dispatchId" = ${slot.dispatchId} AND "entryKind" = 'LOOKUP_COST' AND "status" = 'in_flight' LIMIT 1`;
    return { lastLookupAt: last?.issuedAt ?? null, hasInFlight: !!inFlight };
  });
  if ("reason" in gate) return gate;
  const eligibility = pollEligibility(gate.lastLookupAt, gate.hasInFlight, input.at);
  if (!eligibility.ok) return eligibility;
  const client = buildRealLookupClient(env);
  const result = await pollDeliveryResult(repository, { commandId: input.commandId, slotId: input.slotId, now: input.at, quote: REAL_QUOTE, actorId: input.actorId, approvalId: input.approvalId }, client);
  if (result === "blocked") return { ok: false, reason: "blocked" };
  return { ok: true, result };
}
