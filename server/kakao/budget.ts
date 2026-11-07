import "server-only";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { completionPurgeDeadline, PrismaDispatchRepository, type DispatchRepository } from "@/server/kakao/dispatch-repository";

// G2-only synthetic values in milliKRW, never a claim about real prices.
export const SEND_MAX = 15_000;
export const MONTH_MESSAGE_MAX = 3_000_000;
export const MONTH_TOTAL_MAX = 5_000_000;
export const DAY_REQUEST_MAX = 20;
export const MONTH_REQUEST_MAX = 200;
const money = z.number().int().nonnegative().safe();
const quote = z.object({ send: z.literal(15000), requiredRequestFee: money, lookup: z.literal(500), monthlyPlan: z.literal(1000000), setup: z.literal(0), planApproved: z.literal(true) }).strict();
export type SyntheticQuote = z.infer<typeof quote>;
export type BudgetExposure = { dayRequests: number; monthRequests: number; message: number; total: number };
const exposureSchema = z.object({ dayRequests: money, monthRequests: money, message: money, total: money }).strict().refine((x) => x.message <= x.total);

function sum(a: number, b: number): number | null {
  const value = a + b;
  return Number.isSafeInteger(value) ? value : null;
}
/** Pure preflight only. This is not a permit; storage and audit must commit atomically. */
export function evaluateSyntheticSendCost(input: { quote: unknown; exposure: unknown }): { ok: true; amount: number } | { ok: false } {
  const q = quote.safeParse(input.quote); const e = exposureSchema.safeParse(input.exposure);
  if (!q.success || !e.success) return { ok: false };
  const amount = sum(q.data.send, q.data.requiredRequestFee);
  if (q.data.send !== SEND_MAX || amount === null || amount > SEND_MAX || e.data.dayRequests >= DAY_REQUEST_MAX || e.data.monthRequests >= MONTH_REQUEST_MAX) return { ok: false };
  const message = sum(e.data.message, amount); const total = sum(e.data.total, amount);
  if (message === null || total === null || message > MONTH_MESSAGE_MAX || total > MONTH_TOTAL_MAX) return { ok: false };
  return { ok: true, amount };
}
export function getBudgetSummary(value: unknown): (BudgetExposure & { warning: boolean }) | null {
  const e = exposureSchema.safeParse(value);
  if (!e.success) return null;
  return { ...e.data, warning: e.data.monthRequests >= 160 || e.data.message >= 2_400_000 };
}
/** Evidence is required for *every* reduction; this calculation never restores a slot. */
export function calculateSyntheticReconciliation(input: { reserved: unknown; confirmed: unknown; nonBillableEvidence: unknown }): { confirmed: number; reserved: number } | null {
  const r = money.safeParse(input.reserved); const c = money.safeParse(input.confirmed);
  if (!r.success || !c.success || c.data > r.data) return null;
  if (c.data < r.data && input.nonBillableEvidence !== true) return { confirmed: c.data, reserved: r.data - c.data };
  return { confirmed: c.data, reserved: 0 };
}

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const periodRevisionKey = z.string().regex(/^(?:day:\d{4}-\d{2}-\d{2}|month:\d{4}-\d{2})$/);
const reconciliation = z.object({ commandId: identifier, slotId: identifier, actorId: identifier, approvalId: identifier, evidenceId: identifier, confirmed: money, nonBillableEvidence: z.literal(true), at: z.date(), periodRevisions: z.record(periodRevisionKey, money).optional(), costRevision: money.optional() }).strict();
function reconciliationBinding(command: z.infer<typeof reconciliation>): string | null {
  if (command.costRevision === undefined || !command.periodRevisions) return null;
  // The amount remains only in the sealed cost proposal, not even as a
  // guessable digest in the audit record.
  return createHash("sha256").update(JSON.stringify(["cost_reconciliation_v1", command.commandId, command.slotId, command.actorId, command.approvalId, command.evidenceId, command.costRevision, Object.entries(command.periodRevisions).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
}
/** WIP synthetic reference only; approval and persistence wiring remain outstanding. */
export async function reconcileCost(repository: DispatchRepository | PrismaDispatchRepository, value: unknown): Promise<void> {
  const command = reconciliation.parse(value);
  if (repository instanceof PrismaDispatchRepository) return reconcilePrismaCost(repository, command);
  await repository.transaction(async (state) => {
    const approval = state.costApprovals.find((a) => a.commandId === command.commandId);
    if (!approval || approval.slotId !== command.slotId || approval.actorId !== command.actorId || approval.approvalId !== command.approvalId || approval.evidenceId !== command.evidenceId || approval.confirmed !== command.confirmed) throw new Error("Cost approval unavailable.");
    const slot = state.slots.find((s) => s.id === command.slotId);
    if (!slot) throw new Error("Slot unavailable.");
    const prior = state.audits.find((a) => a.eventId === command.commandId);
    if (prior) {
      if (prior.eventType !== "cost_reconciled" || prior.slotId !== command.slotId || prior.actorId !== command.actorId || prior.approvalId !== command.approvalId || prior.evidenceId !== command.evidenceId) throw new Error("Command conflict.");
      return;
    }
    if (slot.costSummaryPurgedAt || slot.costState === "summary_purged" || slot.reserved === null || slot.confirmed === null) throw new Error("Cost detail unavailable.");
    const exposure = sum(slot.reserved, slot.confirmed);
    if (exposure === null || command.confirmed > exposure) throw new Error("Invalid cost evidence.");
    const dispatch = state.dispatches.find((d) => d.id === slot.dispatchId);
    if (!dispatch) throw new Error("Dispatch unavailable.");
    if (state.budgetPeriods) {
      if (!approval.periodRevisions || !command.periodRevisions || approval.costRevision === undefined || command.costRevision !== approval.costRevision || slot.revision !== command.costRevision || JSON.stringify(Object.entries(approval.periodRevisions).sort()) !== JSON.stringify(Object.entries(command.periodRevisions).sort())) throw new Error("Cost revision approval unavailable.");
      const keys = [`day:${slot.day}`, `month:${slot.month}`];
      if (Object.keys(command.periodRevisions).sort().join("|") !== keys.sort().join("|")) throw new Error("Cost revision unavailable.");
      for (const key of keys) {
        const [type, periodKey] = key.split(":");
        const period = state.budgetPeriods.find((p) => p.type === type && p.key === periodKey);
        if (!period || period.revision !== command.periodRevisions[key] || !Number.isSafeInteger(period.confirmed + command.confirmed - slot.confirmed) || period.confirmed + command.confirmed - slot.confirmed < period.archivedConfirmed) throw new Error("Cost aggregate invalid.");
        period.confirmed += command.confirmed - slot.confirmed; period.revision++;
      }
    }
    slot.confirmed = command.confirmed; slot.reserved = 0; slot.costState = "settled"; if (slot.revision !== undefined) slot.revision++; dispatch.auditSequence++;
    state.audits.push({ eventId: command.commandId, dispatchId: slot.dispatchId, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "cost_reconciled", occurredAt: command.at, approvalId: command.approvalId, evidenceId: command.evidenceId, actorId: command.actorId });
  });
}

const correctionCommand = z.object({ commandId: identifier, slotId: identifier, actorId: identifier, approvalId: identifier, evidenceId: identifier, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), month: z.string().regex(/^\d{4}-\d{2}$/), delta: z.number().int().safe(), version: identifier, costRevision: money, periodRevisions: z.record(periodRevisionKey, money), at: z.date() }).strict();
export function correctionBinding(value: z.infer<typeof correctionCommand>): string {
  return createHash("sha256").update(JSON.stringify(["cost_correction_v1", value.commandId, value.slotId, value.actorId, value.approvalId, value.evidenceId, value.day, value.month, value.version, value.costRevision, Object.entries(value.periodRevisions).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
}
/** Synthetic evidence-backed correction; the purged source is never rewritten. */
export async function correctPurgedSyntheticCost(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = correctionCommand.parse(value);
  await repository.transaction(async (state) => {
    const purged = state.corrections?.find((c) => c.commandId === input.commandId && c.costSummaryPurgedAt);
    if (purged) throw new Error("Applied correction detail purged.");
    const evidence = state.correctionEvidence?.find((e) => e.evidenceId === input.evidenceId && e.version === input.version);
    const approval = state.correctionApprovals?.find((a) => a.commandId === input.commandId);
    const bound = (v: { evidenceId: string; slotId: string; day: string; month: string; delta: number | null; version: string }) => v.evidenceId === input.evidenceId && v.slotId === input.slotId && v.day === input.day && v.month === input.month && v.delta === input.delta && v.version === input.version;
    if (!evidence || !bound(evidence) || !approval || !bound(approval) || approval.actorId !== input.actorId || approval.approvalId !== input.approvalId || approval.costRevision !== input.costRevision || JSON.stringify(Object.entries(approval.periodRevisions).sort()) !== JSON.stringify(Object.entries(input.periodRevisions).sort())) throw new Error("Correction evidence or approval unavailable.");
    const prior = state.corrections?.find((c) => c.commandId === input.commandId);
    if (prior) {
      if (!bound(prior) || prior.actorId !== input.actorId || prior.approvalId !== input.approvalId || prior.costRevision !== input.costRevision || JSON.stringify(Object.entries(prior.periodRevisions).sort()) !== JSON.stringify(Object.entries(input.periodRevisions).sort())) throw new Error("Command conflict.");
      return;
    }
    if (state.corrections?.some((c) => c.slotId === input.slotId && c.evidenceId === input.evidenceId && c.version === input.version)) throw new Error("Correction evidence already applied.");
    const slot = state.slots.find((s) => s.id === input.slotId);
    const dispatch = slot && state.dispatches.find((d) => d.id === slot.dispatchId);
    if (!slot || !dispatch || slot.costState !== "summary_purged" || !slot.costSummaryPurgedAt || slot.reserved !== null || slot.confirmed !== null || slot.adjustment != null || slot.revision !== input.costRevision || slot.day !== input.day || slot.month !== input.month) throw new Error("Correction source unavailable.");
    if (input.delta > 0) throw new Error("Positive exposure evidence unavailable.");
    const keys = [`day:${input.day}`, `month:${input.month}`];
    if (Object.keys(input.periodRevisions).sort().join("|") !== keys.sort().join("|")) throw new Error("Period binding unavailable.");
    for (const key of keys) {
      const [type, periodKey] = key.split(":"); const period = state.budgetPeriods?.find((p) => p.type === type && p.key === periodKey);
      if (!period || period.revision !== input.periodRevisions[key] || !Number.isSafeInteger(period.confirmed + input.delta) || !Number.isSafeInteger(period.archivedConfirmed + input.delta) || period.archivedConfirmed + input.delta < 0 || period.confirmed + input.delta < period.archivedConfirmed + input.delta) throw new Error("Correction aggregate invalid.");
      period.confirmed += input.delta; period.archivedConfirmed += input.delta; period.revision++;
    }
    const { at, ...correction } = input; (state.corrections ??= []).push({ ...correction, appliedAt: new Date(at), completedAt: new Date(at), purgeDueAt: completionPurgeDeadline(at), contribution: "folded_archive", revision: 0 });
    dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "cost_corrected", occurredAt: at, actorId: input.actorId, approvalId: input.approvalId, evidenceId: input.evidenceId });
  });
}

/** Applies only a pre-verified, sealed synthetic correction proposal. */
export async function correctPurgedPrismaCost(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = correctionCommand.parse(value); const binding = correctionBinding(input);
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; costExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "costExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime?.ownerId || runtime.costExecutorId !== input.actorId || !runtime.policyVersion) throw new Error("Cost authority unavailable.");
    const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string; recipientId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId", d."recipientId" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE c."id" = ${input.slotId} AND c."entryKind" = 'SEND_SLOT' AND d."environment" = 'preview'`;
    if (!link) throw new Error("Correction source unavailable.");
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (outbox.length !== 1 || !registration) throw new Error("Cost context unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${input.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((u) => u.id === id && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(input.actorId)) throw new Error("Cost authority unavailable.");
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
    if (recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) throw new Error("Cost context changed.");
    const [source] = await tx.$queryRaw<{ id: string; dayKey: string; monthKey: string; costState: string; costSummaryPurgedAt: Date | null; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; adjustmentMilliKrw: bigint | null; revision: number }[]>`SELECT "id", "dayKey", "monthKey", "costState", "costSummaryPurgedAt", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "revision" FROM "NotificationCostReservation" WHERE "id" = ${input.slotId} AND "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' FOR UPDATE`;
    if (!source || source.costState !== "summary_purged" || !source.costSummaryPurgedAt || source.reservedMilliKrw !== null || source.confirmedMilliKrw !== null || source.adjustmentMilliKrw !== null || source.revision !== input.costRevision || source.dayKey !== input.day || source.monthKey !== input.month) throw new Error("Correction source unavailable.");
    type Proposal = { id: string; sourceSlotId: string | null; sourceCostId: string | null; adjustmentMilliKrw: bigint | null; adjustmentCommandId: string | null; adjustmentApprovalId: string | null; adjustmentEvidenceId: string | null; correctionVersion: string | null; evidenceVerifiedAt: Date | null; expectedCostRevision: number | null; status: string; costState: string };
    const [proposal] = await tx.$queryRaw<Proposal[]>`SELECT "id", "sourceSlotId", "sourceCostId", "adjustmentMilliKrw", "adjustmentCommandId", "adjustmentApprovalId", "adjustmentEvidenceId", "correctionVersion", "evidenceVerifiedAt", "expectedCostRevision", "status", "costState" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'COST_CORRECTION' AND "operationKey" = ${input.commandId} FOR UPDATE`;
    if (!proposal || proposal.sourceSlotId !== source.id || proposal.sourceCostId !== source.id || proposal.adjustmentMilliKrw !== BigInt(input.delta) || proposal.adjustmentCommandId !== input.commandId || proposal.adjustmentApprovalId !== input.approvalId || proposal.adjustmentEvidenceId !== input.evidenceId || proposal.correctionVersion !== input.version || !proposal.evidenceVerifiedAt || proposal.expectedCostRevision !== input.costRevision) throw new Error("Correction evidence unavailable.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; slotId: string | null; costOperationId: string | null; commandId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "actorId", "slotId", "costOperationId", "commandId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'cost_correction_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.slotId !== source.id || approval.costOperationId !== proposal.id || approval.commandId !== input.commandId || approval.evidenceId !== input.evidenceId || approval.payloadBinding !== binding) throw new Error("Correction approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; slotId: string | null; actorId: string | null; approvalId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "eventType", "slotId", "actorId", "approvalId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.commandId}`;
    if (existing) {
      if (proposal.status !== "applied" || existing.eventType !== "cost_corrected" || existing.slotId !== source.id || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId || existing.payloadBinding !== binding) throw new Error("Command conflict.");
      return;
    }
    if (proposal.status !== "proposed" || proposal.costState !== "proposed" || input.delta > 0) throw new Error("Correction exposure unavailable.");
    const keys = [`day:${input.day}`, `month:${input.month}`];
    if (Object.keys(input.periodRevisions).sort().join("|") !== keys.sort().join("|")) throw new Error("Period binding unavailable.");
    for (const key of keys.sort()) {
      const [type, periodKey] = key.split(":");
      const [period] = await tx.$queryRaw<{ id: string; confirmedMilliKrw: bigint; archivedConfirmedMilliKrw: bigint; revision: number }[]>`SELECT "id", "confirmedMilliKrw", "archivedConfirmedMilliKrw", "revision" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = ${type} AND "periodKey" = ${periodKey} FOR UPDATE`;
      const delta = BigInt(input.delta);
      if (!period || period.revision !== input.periodRevisions[key] || period.archivedConfirmedMilliKrw + delta < 0n || period.confirmedMilliKrw + delta < period.archivedConfirmedMilliKrw + delta) throw new Error("Correction aggregate invalid.");
      const changed = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "confirmedMilliKrw" = "confirmedMilliKrw" + ${delta}, "archivedConfirmedMilliKrw" = "archivedConfirmedMilliKrw" + ${delta}, "revision" = "revision" + 1 WHERE "id" = ${period.id} AND "revision" = ${period.revision}`;
      if (changed !== 1) throw new Error("Cost period changed.");
    }
    const applied = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'applied', "costState" = 'applied', "revision" = "revision" + 1 WHERE "id" = ${proposal.id} AND "status" = 'proposed' AND "costState" = 'proposed'`;
    const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (applied !== 1 || changed !== 1) throw new Error("Correction storage failed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "costOperationId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${input.commandId}, ${input.commandId}, 'preview', 'cost_corrected', ${link.outboxId}, ${dispatch.id}, ${source.id}, ${proposal.id}, ${dispatch.auditSequence + 1}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${binding}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${input.at})`;
  });
}

const lookupCommand = z.object({ commandId: identifier, slotId: identifier, now: z.date(), quote, actorId: identifier.optional(), approvalId: identifier.optional() }).strict();
export function syntheticLookupBinding(command: { commandId: string; slotId: string; actorId: string; approvalId: string; day: string; month: string }): string {
  return createHash("sha256").update(JSON.stringify(["synthetic_lookup_v1", command.commandId, command.slotId, command.actorId, command.approvalId, command.day, command.month])).digest("hex");
}
class LookupBudgetDenied extends Error {}
/** Synthetic lookup exposure; reserving does not issue a send slot or perform IO. */
export async function reserveSyntheticLookup(repository: DispatchRepository | PrismaDispatchRepository, value: unknown): Promise<{ id: string } | null> {
  const parsed = lookupCommand.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  if (repository instanceof PrismaDispatchRepository) return reservePrismaLookup(repository, input);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(input.now);
  const month = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
  return repository.transaction(async (state) => {
    const slot = state.slots.find((s) => s.id === input.slotId);
    const dispatch = slot && state.dispatches.find((d) => d.id === slot.dispatchId);
    if (!slot || !dispatch || !state.runtime || !state.runtime.recoveryVerified || !state.runtime.nonceCurrent || !state.runtime.rotationComplete || !["unknown", "accepted"].includes(slot.status) || state.lookups.some((l) => l.id === input.commandId) || state.audits.some((a) => a.eventId === input.commandId)) return null;
    if (state.slots.some((s) => s.reserved === null || s.confirmed === null || s.costSummaryPurgedAt) || state.lookups.some((l) => l.reserved === null || l.confirmed === null)) return null;
    const message = state.slots.reduce((n, s) => n + (s.month === month ? s.confirmed! + s.reserved! : s.month < month ? s.reserved! : 0), 0);
    const lookupExposure = state.lookups.filter((l) => l.month <= month).reduce((n, l) => n + l.reserved! + (l.month === month ? l.confirmed! : 0), 0);
    const prior = state.monthlyAdditionalCosts[month]; const other = prior === undefined ? input.quote.monthlyPlan : prior;
    if (prior !== undefined && prior < input.quote.monthlyPlan) return null;
    const total = sum(message, lookupExposure); const withOther = total === null ? null : sum(total, other); const after = withOther === null ? null : sum(withOther, input.quote.lookup);
    if (after === null || after > MONTH_TOTAL_MAX) return null;
    if (prior === undefined) state.monthlyAdditionalCosts[month] = input.quote.monthlyPlan;
    state.lookups.push({ id: input.commandId, slotId: slot.id, month, status: "in_flight", reserved: input.quote.lookup, confirmed: 0 });
    dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "lookup_reserved", occurredAt: input.now });
    return { id: input.commandId };
  });
}

/** Persists the synthetic 500 milliKRW lookup exposure before any lookup IO. */
async function reservePrismaLookup(repository: PrismaDispatchRepository, input: z.infer<typeof lookupCommand>): Promise<{ id: string } | null> {
  if (!input.actorId || !input.approvalId) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(input.now);
  const get = (kind: string) => parts.find((p) => p.type === kind)?.value;
  const month = `${get("year")}-${get("month")}`; const day = `${month}-${get("day")}`;
  const binding = syntheticLookupBinding({ commandId: input.commandId, slotId: input.slotId, actorId: input.actorId, approvalId: input.approvalId, day, month });
  try { return await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; costExecutorId: string | null; policyVersion: string | null; revision: number; blocked: boolean; recoveryVerified: boolean; nonceCurrent: boolean; rotationComplete: boolean }[]>`SELECT "ownerId", "costExecutorId", "policyVersion", "revision", "blocked", "recoveryVerified", "nonceCurrent", "rotationComplete" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime?.ownerId || runtime.costExecutorId !== input.actorId || !runtime.policyVersion || runtime.blocked || !runtime.recoveryVerified || !runtime.nonceCurrent || !runtime.rotationComplete) return null;
    const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string; recipientId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId", d."recipientId" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE c."id" = ${input.slotId} AND c."entryKind" = 'SEND_SLOT' AND d."environment" = 'preview'`;
    if (!link) return null;
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (outbox.length !== 1 || !registration) return null;
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${input.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((u) => u.id === id && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(input.actorId) || !authorized(registration.userId)) return null;
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
    if (recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) return null;
    const [slot] = await tx.$queryRaw<{ id: string; status: string; detailPurgedAt: Date | null }[]>`SELECT "id", "status", "detailPurgedAt" FROM "NotificationCostReservation" WHERE "id" = ${input.slotId} AND "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' FOR UPDATE`;
    if (!slot || !["unknown", "accepted"].includes(slot.status) || slot.detailPurgedAt) return null;
    const [approval] = await tx.$queryRaw<{ actorId: string | null; slotId: string | null; commandId: string | null; payloadBinding: string | null }[]>`SELECT "actorId", "slotId", "commandId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'lookup_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.slotId !== slot.id || approval.commandId !== input.commandId || approval.payloadBinding !== binding) return null;
    const [prior] = await tx.$queryRaw<{ id: string; sourceSlotId: string | null; dayKey: string; monthKey: string }[]>`SELECT "id", "sourceSlotId", "dayKey", "monthKey" FROM "NotificationCostReservation" WHERE "operationKey" = ${input.commandId} FOR UPDATE`;
    if (prior) {
      if (prior.sourceSlotId !== slot.id || prior.dayKey !== day || prior.monthKey !== month) throw new Error("Lookup command conflict.");
      return { id: prior.id };
    }
    const periodId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion") VALUES (${periodId}, 'preview', 'application.received', 'month', ${month}, ${runtime.policyVersion}) ON CONFLICT ("environment", "service", "periodType", "periodKey") DO NOTHING`;
    type Period = { id: string; revision: number; planApplied: boolean; otherMilliKrw: bigint; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint };
    const [period] = await tx.$queryRaw<Period[]>`SELECT "id", "revision", "planApplied", "otherMilliKrw", "reservedMilliKrw", "confirmedMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'month' AND "periodKey" = ${month} FOR UPDATE`;
    const [carry] = await tx.$queryRaw<{ message: bigint; lookup: bigint }[]>`SELECT COALESCE(SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'SEND_SLOT'), 0)::bigint AS "message", COALESCE(SUM(c."reservedMilliKrw") FILTER (WHERE c."entryKind" = 'LOOKUP_COST'), 0)::bigint AS "lookup" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE d."environment" = 'preview' AND c."monthKey" < ${month} AND c."reservedMilliKrw" > 0`;
    if (!period || !carry) throw new Error("Budget unavailable.");
    const values = [period.otherMilliKrw, period.reservedMilliKrw, period.confirmedMilliKrw, period.lookupReservedMilliKrw, period.lookupConfirmedMilliKrw, carry.message, carry.lookup];
    if (values.some((value) => value < 0n)) throw new Error("Budget invalid.");
    if (period.planApplied && period.otherMilliKrw < BigInt(input.quote.monthlyPlan)) throw new Error("Monthly plan state invalid.");
    const plan = period.planApplied ? 0n : BigInt(input.quote.monthlyPlan);
    const total = values.reduce((sum, value) => sum + value, 0n) + plan + BigInt(input.quote.lookup);
    if (total > BigInt(MONTH_TOTAL_MAX)) throw new LookupBudgetDenied();
    const lookupId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookupId}, ${dispatch.id}, 'LOOKUP_COST', ${input.commandId}, ${slot.id}, NULL, 'in_flight', ${input.now}, ${day}, ${month}, ${BigInt(input.quote.lookup)}, 'reserved')`;
    const changed = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "lookupReservedMilliKrw" = "lookupReservedMilliKrw" + ${BigInt(input.quote.lookup)}, "otherMilliKrw" = "otherMilliKrw" + ${plan}, "planApplied" = true, "carryMilliKrw" = ${carry.message}, "lookupCarryMilliKrw" = ${carry.lookup}, "revision" = "revision" + 1 WHERE "id" = ${period.id} AND "revision" = ${period.revision}`;
    const dispatchChanged = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (changed !== 1 || dispatchChanged !== 1) throw new Error("Lookup storage failed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "costOperationId", "sequence", "actorId", "commandId", "approvalId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${input.commandId}, ${input.commandId}, 'preview', 'lookup_reserved', ${link.outboxId}, ${dispatch.id}, ${slot.id}, ${lookupId}, ${dispatch.auditSequence + 1}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${binding}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${input.now})`;
    return { id: lookupId };
  }); } catch (error) { if (error instanceof LookupBudgetDenied) return null; throw error; }
}
/** Lack of a final lookup response never releases its reservation. */
export async function markSyntheticLookupUnknown(repository: DispatchRepository | PrismaDispatchRepository, lookupId: string, at: Date): Promise<void> {
  identifier.parse(lookupId); z.date().parse(at);
  if (repository instanceof PrismaDispatchRepository) return markPrismaLookupUnknown(repository, lookupId, at);
  await repository.transaction(async (state) => {
    const lookup = state.lookups.find((l) => l.id === lookupId); const slot = lookup && state.slots.find((s) => s.id === lookup.slotId); const dispatch = slot && state.dispatches.find((d) => d.id === slot.dispatchId);
    if (!lookup || !slot || !dispatch) throw new Error("Lookup unavailable.");
    if (lookup.status === "unknown") return;
    if (lookup.status !== "in_flight") throw new Error("Lookup already resolved.");
    lookup.status = "unknown"; dispatch.auditSequence++;
    state.audits.push({ eventId: randomUUID(), dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "lookup_unknown", occurredAt: at });
  });
}

async function markPrismaLookupUnknown(repository: PrismaDispatchRepository, lookupId: string, at: Date): Promise<void> {
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string; recipientId: string; sourceSlotId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId", d."recipientId", c."sourceSlotId" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE c."id" = ${lookupId} AND c."entryKind" = 'LOOKUP_COST' AND d."environment" = 'preview'`;
    if (!runtime || !link) throw new Error("Lookup unavailable.");
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
    if (outbox.length !== 1 || recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) throw new Error("Lookup context unavailable.");
    const [lookup] = await tx.$queryRaw<{ id: string; status: string; costState: string; sourceSlotId: string | null }[]>`SELECT "id", "status", "costState", "sourceSlotId" FROM "NotificationCostReservation" WHERE "id" = ${lookupId} AND "dispatchId" = ${dispatch.id} AND "entryKind" = 'LOOKUP_COST' FOR UPDATE`;
    if (!lookup || lookup.sourceSlotId !== link.sourceSlotId) throw new Error("Lookup unavailable.");
    if (lookup.status === "unknown" && lookup.costState === "reserved_unknown") return;
    if (lookup.status !== "in_flight" || lookup.costState !== "reserved") throw new Error("Lookup already resolved.");
    const changed = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'unknown', "costState" = 'reserved_unknown', "resultAt" = ${at}, "revision" = "revision" + 1 WHERE "id" = ${lookupId} AND "status" = 'in_flight' AND "costState" = 'reserved'`;
    const dispatchChanged = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (changed !== 1 || dispatchChanged !== 1) throw new Error("Lookup storage failed.");
    const eventId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "costOperationId", "sequence", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'lookup_unknown', ${link.outboxId}, ${dispatch.id}, ${link.sourceSlotId}, ${lookupId}, ${dispatch.auditSequence + 1}, ${at})`;
  });
}

const lookupReconciliation = z.object({ commandId: identifier, lookupId: identifier, actorId: identifier, approvalId: identifier, evidenceId: identifier, confirmed: money.max(500), nonBillableEvidence: z.literal(true), at: z.date(), costRevision: money.optional(), periodRevisions: z.record(periodRevisionKey, money).optional() }).strict();
/** Evidence-backed synthetic lookup reconciliation; never changes send counts. */
export async function reconcileSyntheticLookup(repository: DispatchRepository | PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = lookupReconciliation.parse(value);
  if (repository instanceof PrismaDispatchRepository) return reconcilePrismaLookup(repository, input);
  await repository.transaction(async (state) => {
    const approval = state.lookupApprovals.find((a) => a.commandId === input.commandId);
    if (!approval || approval.lookupId !== input.lookupId || approval.actorId !== input.actorId || approval.approvalId !== input.approvalId || approval.evidenceId !== input.evidenceId || approval.confirmed !== input.confirmed) throw new Error("Lookup approval unavailable.");
    const existing = state.audits.find((a) => a.eventId === input.commandId);
    const lookup = state.lookups.find((l) => l.id === input.lookupId); const slot = lookup && state.slots.find((s) => s.id === lookup.slotId); const dispatch = slot && state.dispatches.find((d) => d.id === slot.dispatchId);
    if (!lookup || !slot || !dispatch) throw new Error("Lookup unavailable.");
    if (existing) {
      if (existing.eventType !== "lookup_reconciled" || existing.slotId !== slot.id || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId) throw new Error("Command conflict.");
      return;
    }
    if (lookup.status === "resolved" || lookup.reserved === null || lookup.confirmed === null || input.confirmed > lookup.reserved + lookup.confirmed) throw new Error("Lookup evidence invalid.");
    lookup.reserved = 0; lookup.confirmed = input.confirmed; lookup.status = "resolved"; dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "lookup_reconciled", occurredAt: input.at, actorId: input.actorId, approvalId: input.approvalId, evidenceId: input.evidenceId });
  });
}

async function reconcilePrismaLookup(repository: PrismaDispatchRepository, input: z.infer<typeof lookupReconciliation>): Promise<void> {
  if (input.costRevision === undefined || !input.periodRevisions) throw new Error("Lookup revision approval unavailable.");
  const binding = createHash("sha256").update(JSON.stringify(["lookup_reconciliation_v1", input.commandId, input.lookupId, input.actorId, input.approvalId, input.evidenceId, input.costRevision, Object.entries(input.periodRevisions).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; costExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "costExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime?.ownerId || runtime.costExecutorId !== input.actorId || !runtime.policyVersion) throw new Error("Cost authority unavailable.");
    const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string; recipientId: string; sourceSlotId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId", d."recipientId", c."sourceSlotId" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE c."id" = ${input.lookupId} AND c."entryKind" = 'LOOKUP_COST' AND d."environment" = 'preview'`;
    if (!link) throw new Error("Lookup unavailable.");
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (outbox.length !== 1 || !registration) throw new Error("Lookup context unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${input.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((u) => u.id === id && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(input.actorId)) throw new Error("Cost authority unavailable.");
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
    if (recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) throw new Error("Lookup context changed.");
    type Lookup = { id: string; sourceSlotId: string | null; monthKey: string; status: string; costState: string; costSummaryPurgedAt: Date | null; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; revision: number; adjustmentMilliKrw: bigint | null; adjustmentCommandId: string | null; adjustmentApprovalId: string | null; adjustmentEvidenceId: string | null };
    const [lookup] = await tx.$queryRaw<Lookup[]>`SELECT "id", "sourceSlotId", "monthKey", "status", "costState", "costSummaryPurgedAt", "reservedMilliKrw", "confirmedMilliKrw", "revision", "adjustmentMilliKrw", "adjustmentCommandId", "adjustmentApprovalId", "adjustmentEvidenceId" FROM "NotificationCostReservation" WHERE "id" = ${input.lookupId} AND "dispatchId" = ${dispatch.id} AND "entryKind" = 'LOOKUP_COST' FOR UPDATE`;
    if (!lookup || lookup.sourceSlotId !== link.sourceSlotId || lookup.adjustmentMilliKrw !== BigInt(input.confirmed) || lookup.adjustmentCommandId !== input.commandId || lookup.adjustmentApprovalId !== input.approvalId || lookup.adjustmentEvidenceId !== input.evidenceId) throw new Error("Lookup proposal unavailable.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; slotId: string | null; costOperationId: string | null; commandId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "actorId", "slotId", "costOperationId", "commandId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'lookup_adjust_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.slotId !== link.sourceSlotId || approval.costOperationId !== lookup.id || approval.commandId !== input.commandId || approval.evidenceId !== input.evidenceId || approval.payloadBinding !== binding) throw new Error("Lookup approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; costOperationId: string | null; payloadBinding: string | null }[]>`SELECT "eventType", "costOperationId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.commandId}`;
    if (existing) {
      if (existing.eventType !== "lookup_reconciled" || existing.costOperationId !== lookup.id || existing.payloadBinding !== binding) throw new Error("Lookup command conflict.");
      return;
    }
    if (lookup.costSummaryPurgedAt || lookup.revision !== input.costRevision || !["reserved", "reserved_unknown"].includes(lookup.costState) || lookup.reservedMilliKrw === null || lookup.confirmedMilliKrw !== null || BigInt(input.confirmed) > lookup.reservedMilliKrw) throw new Error("Lookup evidence invalid.");
    type Period = { id: string; periodKey: string; revision: number; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint };
    const periods = await tx.$queryRaw<Period[]>`SELECT "id", "periodKey", "revision", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'month' AND "periodKey" >= ${lookup.monthKey} ORDER BY "periodKey" FOR UPDATE`;
    if (!periods.length || periods[0].periodKey !== lookup.monthKey || Object.keys(input.periodRevisions!).sort().join("|") !== periods.map((p) => `month:${p.periodKey}`).sort().join("|") || periods.some((p) => p.revision !== input.periodRevisions![`month:${p.periodKey}`]) || periods[0].lookupReservedMilliKrw < lookup.reservedMilliKrw) throw new Error("Lookup period unavailable.");
    const changed = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "reservedMilliKrw" = 0, "confirmedMilliKrw" = ${BigInt(input.confirmed)}, "costState" = 'settled', "status" = 'resolved', "evidenceId" = ${input.evidenceId}, "revision" = "revision" + 1 WHERE "id" = ${lookup.id} AND "revision" = ${lookup.revision}`;
    if (changed !== 1) throw new Error("Lookup changed.");
    const current = periods[0];
    const periodChanged = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "lookupReservedMilliKrw" = "lookupReservedMilliKrw" - ${lookup.reservedMilliKrw}, "lookupConfirmedMilliKrw" = "lookupConfirmedMilliKrw" + ${BigInt(input.confirmed)}, "revision" = "revision" + 1 WHERE "id" = ${current.id} AND "revision" = ${current.revision}`;
    if (periodChanged !== 1) throw new Error("Lookup period changed.");
    for (const period of periods.slice(1)) {
      const [carry] = await tx.$queryRaw<{ amount: bigint }[]>`SELECT COALESCE(SUM(c."reservedMilliKrw"), 0)::bigint AS "amount" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE d."environment" = 'preview' AND c."entryKind" = 'LOOKUP_COST' AND c."monthKey" < ${period.periodKey} AND c."reservedMilliKrw" > 0`;
      if (!carry || carry.amount < 0n) throw new Error("Lookup carry unavailable.");
      const updated = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "lookupCarryMilliKrw" = ${carry.amount}, "revision" = "revision" + 1 WHERE "id" = ${period.id} AND "revision" = ${period.revision}`;
      if (updated !== 1) throw new Error("Lookup carry changed.");
    }
    const dispatchChanged = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (dispatchChanged !== 1) throw new Error("Dispatch changed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "costOperationId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${input.commandId}, ${input.commandId}, 'preview', 'lookup_reconciled', ${link.outboxId}, ${dispatch.id}, ${link.sourceSlotId}, ${lookup.id}, ${dispatch.auditSequence + 1}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${binding}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${input.at})`;
  });
}

/** Prisma reconciliation accepts only a previously persisted approval and proposal. */
async function reconcilePrismaCost(repository: PrismaDispatchRepository, command: z.infer<typeof reconciliation>): Promise<void> {
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; costExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "costExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || !runtime.ownerId || runtime.costExecutorId !== command.actorId || !runtime.policyVersion) throw new Error("Cost authority unavailable.");
    const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string; recipientId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId", d."recipientId" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE c."id" = ${command.slotId}`;
    if (!link) throw new Error("Slot unavailable.");
    const [outbox] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (!outbox || !registration) throw new Error("Cost context unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${command.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((u) => u.id === id && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(command.actorId)) throw new Error("Cost authority unavailable.");
    const recipientLock = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
    if (recipientLock.length !== 1 || !dispatch || dispatch.outboxId !== outbox.id || dispatch.recipientId !== link.recipientId) throw new Error("Cost context changed.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; slotId: string | null; commandId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "actorId", "slotId", "commandId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${command.approvalId} AND "environment" = 'preview' AND "eventType" = 'cost_adjust_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.slotId !== command.slotId || approval.commandId !== command.commandId || approval.evidenceId !== command.evidenceId) throw new Error("Cost approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; slotId: string | null; actorId: string | null; approvalId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "eventType", "slotId", "actorId", "approvalId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${command.commandId}`;
    type Slot = { id: string; dispatchId: string; dayKey: string; monthKey: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; costState: string; costSummaryPurgedAt: Date | null; revision: number; adjustmentMilliKrw: bigint | null; adjustmentCommandId: string | null; adjustmentApprovalId: string | null; adjustmentEvidenceId: string | null };
    const [slot] = await tx.$queryRaw<Slot[]>`SELECT "id", "dispatchId", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState", "costSummaryPurgedAt", "revision", "adjustmentMilliKrw", "adjustmentCommandId", "adjustmentApprovalId", "adjustmentEvidenceId" FROM "NotificationCostReservation" WHERE "id" = ${command.slotId} AND "entryKind" = 'SEND_SLOT' FOR UPDATE`;
    if (!slot || slot.dispatchId !== dispatch.id || slot.adjustmentCommandId !== command.commandId || slot.adjustmentApprovalId !== command.approvalId || slot.adjustmentEvidenceId !== command.evidenceId || slot.adjustmentMilliKrw !== BigInt(command.confirmed)) throw new Error("Cost proposal unavailable.");
    if (existing) {
      if (existing.eventType !== "cost_reconciled" || existing.slotId !== command.slotId || existing.actorId !== command.actorId || existing.approvalId !== command.approvalId || existing.evidenceId !== command.evidenceId || !reconciliationBinding(command) || existing.payloadBinding !== reconciliationBinding(command)) throw new Error("Command conflict.");
      return;
    }
    // An absent confirmed value means no confirmed contribution only for a
    // still-reserved cost; a purged or otherwise unknown value is not zero.
    if (slot.costSummaryPurgedAt || slot.reservedMilliKrw === null || !["reserved", "reserved_unknown", "partially_confirmed", "settled"].includes(slot.costState) || (slot.confirmedMilliKrw === null && !["reserved", "reserved_unknown"].includes(slot.costState))) throw new Error("Cost detail unavailable.");
    const binding = reconciliationBinding(command);
    if (!binding || approval.payloadBinding !== binding || command.costRevision !== slot.revision || !command.periodRevisions || Object.keys(command.periodRevisions).sort().join("|") !== [`day:${slot.dayKey}`, `month:${slot.monthKey}`].sort().join("|")) throw new Error("Cost revision approval unavailable.");
    const confirmed = slot.confirmedMilliKrw === null ? 0n : slot.confirmedMilliKrw; const target = BigInt(command.confirmed);
    if (slot.reservedMilliKrw < 0n || confirmed < 0n || target > slot.reservedMilliKrw + confirmed) throw new Error("Cost evidence invalid.");
    type Period = { id: string; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; archivedConfirmedMilliKrw: bigint; revision: number };
    const [daily] = await tx.$queryRaw<Period[]>`SELECT "id", "reservedMilliKrw", "confirmedMilliKrw", "archivedConfirmedMilliKrw", "revision" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'day' AND "periodKey" = ${slot.dayKey} FOR UPDATE`;
    const [monthly] = await tx.$queryRaw<Period[]>`SELECT "id", "reservedMilliKrw", "confirmedMilliKrw", "archivedConfirmedMilliKrw", "revision" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'month' AND "periodKey" = ${slot.monthKey} FOR UPDATE`;
    const laterMonths = await tx.$queryRaw<{ id: string; periodKey: string }[]>`SELECT "id", "periodKey" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'month' AND "periodKey" > ${slot.monthKey} ORDER BY "periodKey" FOR UPDATE`;
    if (!daily || !monthly || daily.revision !== command.periodRevisions[`day:${slot.dayKey}`] || monthly.revision !== command.periodRevisions[`month:${slot.monthKey}`] || daily.reservedMilliKrw < slot.reservedMilliKrw || monthly.reservedMilliKrw < slot.reservedMilliKrw || daily.confirmedMilliKrw + target - confirmed < daily.archivedConfirmedMilliKrw || monthly.confirmedMilliKrw + target - confirmed < monthly.archivedConfirmedMilliKrw) throw new Error("Cost aggregate invalid.");
    const changedSlot = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "reservedMilliKrw" = 0, "confirmedMilliKrw" = ${target}, "costState" = 'settled', "evidenceId" = ${command.evidenceId}, "revision" = "revision" + 1 WHERE "id" = ${slot.id} AND "reservedMilliKrw" = ${slot.reservedMilliKrw} AND "revision" = ${slot.revision}`;
    const changedDay = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "reservedMilliKrw" = "reservedMilliKrw" - ${slot.reservedMilliKrw}, "confirmedMilliKrw" = "confirmedMilliKrw" + ${target - confirmed}, "revision" = "revision" + 1 WHERE "id" = ${daily.id} AND "revision" = ${daily.revision}`;
    const changedMonth = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "reservedMilliKrw" = "reservedMilliKrw" - ${slot.reservedMilliKrw}, "confirmedMilliKrw" = "confirmedMilliKrw" + ${target - confirmed}, "revision" = "revision" + 1 WHERE "id" = ${monthly.id} AND "revision" = ${monthly.revision}`;
    const changedDispatch = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id}`;
    if (changedSlot !== 1 || changedDay !== 1 || changedMonth !== 1 || changedDispatch !== 1) throw new Error("Cost storage failed.");
    for (const later of laterMonths) {
      const [carry] = await tx.$queryRaw<{ amount: bigint }[]>`SELECT COALESCE(SUM(c."reservedMilliKrw"), 0)::bigint AS "amount" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE d."environment" = 'preview' AND c."entryKind" = 'SEND_SLOT' AND c."monthKey" < ${later.periodKey} AND c."reservedMilliKrw" > 0`;
      if (!carry || carry.amount < 0n) throw new Error("Carry unavailable.");
      const changedCarry = await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "carryMilliKrw" = ${carry.amount} WHERE "id" = ${later.id}`;
      if (changedCarry !== 1) throw new Error("Carry storage failed.");
    }
    const eventId = command.commandId;
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'cost_reconciled', ${outbox.id}, ${dispatch.id}, ${slot.id}, ${dispatch.auditSequence + 1}, ${command.actorId}, ${command.commandId}, ${command.approvalId}, ${command.evidenceId}, ${binding}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${command.at})`;
  });
}
