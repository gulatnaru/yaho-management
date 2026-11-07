import "server-only";
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dispatchContextSchema } from "@/lib/kakao/send-contract";

export type FixedContext = z.infer<typeof dispatchContextSchema>;
export type CoreOutbox = { id: string; dedupeKey: string; occurredAt: Date; status: "processing" | "pending" | "sent" | "skipped" | "failed"; claimToken: string | null; leaseExpiresAt: Date | null; providerRef?: string | null };
export type CoreRuntime = { environment: "preview"; provider: "solapi"; namespace: string; blocked: boolean; activationEpoch: Date; revision: number; keyVersion: string; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean; ownerId?: string; purgeExecutorId?: string; nonceHighWater?: bigint };
export type CoreDispatch = { id: string; outboxId: string; clientKey: string; context: FixedContext; slotCount: number; auditSequence: number; state: "ready" | "in_flight" | "unknown" | "accepted" | "rejected" | "closed_unconfirmed"; unknownSince: Date | null; finalStatus?: "delivered" | "delivery_failed" | "not_sent" | "unknown"; completionEvidenceId?: string; completedAt?: Date; purgeDueAt?: Date; detailPurgedAt?: Date; closedAt?: Date; reviewed7dAt?: Date; responsibilityReviewedAt?: Date; closureApprovalId?: string; nextReviewAt?: Date };
export type CoreSlot = { id: string; dispatchId: string; sequence: number; month: string; day: string; status: "in_flight" | "unknown" | "accepted" | "rejected"; reserved: number | null; confirmed: number | null; adjustment?: number | null; revision?: number; costState?: "settled" | "summary_purged"; costSummaryPurgedAt?: Date; issuedAt: Date; providerRef?: string | null; detailPurgedAt?: Date };
export type CoreAudit = { eventId: string; dispatchId?: string; outboxId?: string; slotId?: string; registrationId?: string; commandId?: string; keyVersion?: string; code?: string; payloadBinding?: string; fromState?: string; toState?: string; sequence?: number; eventType: "recipient_assignment_granted" | "recipient_assignment_revoked" | "recipient_registered" | "recipient_verified" | "recipient_activated" | "recipient_revoked" | "recipient_purged" | "nonce_consumed" | "outbox_claimed" | "outbox_recovered" | "outbox_skipped" | "outbox_failed" | "result_recorded" | "permit_issued" | "result_unknown" | "cost_reconciled" | "cost_corrected" | "completed" | "details_purged" | "cost_summary_purged" | "closed_unconfirmed" | "lookup_reserved" | "lookup_unknown" | "lookup_reconciled"; occurredAt: Date; approvalId?: string; evidenceId?: string; actorId?: string };
export type CoreRecipient = { registration: unknown; target: unknown; id: string; version: string; userId: string };
export type CoreApproval = { commandId: string; slotId: string; actorId: string; approvalId: string; evidenceId: string; confirmed: number | null; periodRevisions?: Record<string, number>; costRevision?: number };
export type CorePurgeApproval = { commandId: string; dispatchId: string; actorId: string; approvalId: string; evidenceId: string };
export type CoreClosureApproval = { commandId: string; dispatchId: string; actorId: string; approvalId: string; evidenceId: string };
export type CoreLookup = { id: string; slotId: string; month: string; status: "in_flight" | "unknown" | "resolved"; reserved: number | null; confirmed: number | null; revision?: number; costSummaryPurgedAt?: Date; completedAt?: Date; purgeDueAt?: Date; contribution?: "live_summary" | "folded_archive" };
export type CoreLookupApproval = { commandId: string; lookupId: string; actorId: string; approvalId: string; evidenceId: string; confirmed: number | null };
export type CoreBudgetPeriod = { type: "day" | "month"; key: string; confirmed: number; archivedConfirmed: number; lookupConfirmed?: number; lookupArchivedConfirmed?: number; revision: number };
export type CoreSummaryPurgeApproval = CorePurgeApproval & { periodRevisions: Record<string, number>; costRevisions: Record<string, number> };
export type CoreCorrectionEvidence = { evidenceId: string; slotId: string; day: string; month: string; delta: number | null; version: string };
export type CoreCorrectionApproval = CoreCorrectionEvidence & { commandId: string; actorId: string; approvalId: string; costRevision: number; periodRevisions: Record<string, number> };
export type CoreCorrection = Omit<CoreCorrectionApproval, "delta"> & { delta: number | null; appliedAt: Date; completedAt?: Date; purgeDueAt?: Date; costSummaryPurgedAt?: Date; contribution?: "folded_archive"; revision?: number };
export type CoreState = { users?: import("@/server/kakao/recipient-registration").RecipientUser[]; ownershipEvidence?: unknown[]; nonceHighWaters?: Record<string, bigint>; recipientAssignments?: { ownerId: string; userId: string; assignment: "register" | "verify"; active: boolean }[]; recipientPurgeApprovals?: { registrationId: string; actorId: string; commandId: string; approvalId: string; evidenceId: string }[]; budgetPeriods?: CoreBudgetPeriod[]; summaryPurgeApprovals?: CoreSummaryPurgeApproval[]; correctionEvidence?: CoreCorrectionEvidence[]; correctionApprovals?: CoreCorrectionApproval[]; corrections?: CoreCorrection[]; lookupApprovals: CoreLookupApproval[]; lookups: CoreLookup[]; closureApprovals: CoreClosureApproval[]; purgeApprovals: CorePurgeApproval[]; costApprovals: CoreApproval[]; recipients: CoreRecipient[]; runtime: CoreRuntime | null; outboxes: CoreOutbox[]; dispatches: CoreDispatch[]; slots: CoreSlot[]; audits: CoreAudit[]; monthlyAdditionalCosts: Record<string, number> };
function cloneState(value: CoreState): CoreState { return deserialize(serialize(value)) as CoreState; }
export interface DispatchRepository { transaction<T>(work: (state: CoreState) => Promise<T>): Promise<T> }
/** Serial copy-on-write synthetic reference. A thrown write never commits any part. */
export class InMemoryDispatchRepository implements DispatchRepository {
  private state: CoreState;
  private tail: Promise<void> = Promise.resolve();
  constructor(initial: CoreState, private readonly beforeCommit?: (candidate: CoreState) => void) { this.state = cloneState(initial); }
  async transaction<T>(work: (state: CoreState) => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const candidate = cloneState(this.state);
      const result = await work(candidate);
      // Copy before committing: even a non-serializable return must roll back.
      const detachedResult = deserialize(serialize(result)) as T;
      this.beforeCommit?.(candidate);
      this.state = cloneState(candidate);
      return detachedResult;
    } finally { release(); }
  }
  async snapshot(): Promise<CoreState> { await this.tail; return cloneState(this.state); }
}

// Prisma adapter uses one database transaction and one global runtime row as the
// serialization root. This remains unwired until the G2 persistence integration
// and DB-specific verification are performed.
export interface PrismaGuardTransaction {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
export interface PrismaGuardClient {
  $transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
}
export class PrismaDispatchRepository {
  constructor(private readonly client: PrismaGuardClient) {}
  matchesClient(client: unknown): boolean { return this.client === client; }
  async transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(work, { isolationLevel: "Serializable" });
  }
}

/** UTC calendar-month addition, including end-of-month clamping. */
export function completionPurgeDeadline(completedAt: Date): Date {
  if (!Number.isFinite(completedAt.getTime())) throw new Error("Invalid completion time.");
  const year = completedAt.getUTCFullYear() + 1; const month = completedAt.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(completedAt.getUTCDate(), lastDay), completedAt.getUTCHours(), completedAt.getUTCMinutes(), completedAt.getUTCSeconds(), completedAt.getUTCMilliseconds()));
}
/** Synthetic reference only. Completed status cannot be inferred from acceptance. */
export async function completeSyntheticDispatch(repository: DispatchRepository, dispatchId: string, at: Date): Promise<void> {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error("Invalid completion time.");
  await repository.transaction(async (state) => {
    const dispatch = state.dispatches.find((d) => d.id === dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    if (!dispatch || !outbox || !["sent", "skipped", "failed"].includes(outbox.status) || !dispatch.completionEvidenceId) throw new Error("Completion evidence unavailable.");
    if (dispatch.completedAt) return;
    const closedWithApproval = dispatch.state === "closed_unconfirmed" && dispatch.finalStatus === "unknown" && !!dispatch.closedAt && !!dispatch.closureApprovalId && at >= dispatch.closedAt;
    if (!closedWithApproval && (!["delivered", "delivery_failed", "not_sent"].includes(dispatch.finalStatus ?? "") || ["in_flight", "unknown", "closed_unconfirmed"].includes(dispatch.state))) throw new Error("Delivery remains unresolved.");
    const slots = state.slots.filter((s) => s.dispatchId === dispatch.id);
    const lookups = state.lookups.filter((l) => slots.some((s) => s.id === l.slotId));
    const slotSettled = (s: CoreSlot) => s.costState === "summary_purged"
      ? !!s.costSummaryPurgedAt && s.reserved === null && s.confirmed === null && s.adjustment == null
      : s.reserved === 0 && s.confirmed !== null;
    const lookupSettled = (l: CoreLookup) => l.costSummaryPurgedAt
      ? l.status === "resolved" && l.reserved === null && l.confirmed === null && l.contribution === "folded_archive" && state.budgetPeriods?.some((p) => p.type === "month" && p.key === l.month && Number.isSafeInteger(p.lookupConfirmed) && Number.isSafeInteger(p.lookupArchivedConfirmed) && p.lookupArchivedConfirmed! >= 0 && p.lookupConfirmed! >= p.lookupArchivedConfirmed!) === true
      : l.status === "resolved" && l.reserved === 0 && l.confirmed !== null;
    if (slots.length !== dispatch.slotCount || slots.some((s) => !slotSettled(s)) || lookups.some((l) => !lookupSettled(l))) throw new Error("Cost remains unresolved.");
    if (slots.length === 0 && (outbox.status !== "skipped" || dispatch.finalStatus !== "not_sent")) throw new Error("No-send evidence unavailable.");
    dispatch.completedAt = new Date(at); dispatch.purgeDueAt = completionPurgeDeadline(at); dispatch.auditSequence++;
    for (const lookup of lookups) {
      // An early purge seals the numeric detail without inventing an earlier
      // dispatch completion; its deadline still derives from this event.
      if (!lookup.completedAt) { lookup.completedAt = new Date(at); lookup.purgeDueAt = completionPurgeDeadline(at); }
    }
    state.audits.push({ eventId: `complete_${dispatch.id}`, dispatchId: dispatch.id, sequence: dispatch.auditSequence, eventType: "completed", occurredAt: at, evidenceId: dispatch.completionEvidenceId });
  });
}

/** Removes only synthetic diagnostics; slot, cost, dedupe and fixed context remain. */
const internalId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const purgeCommand = z.object({ commandId: internalId, dispatchId: internalId, actorId: internalId, approvalId: internalId, evidenceId: internalId, at: z.date() }).strict();
const periodRevisionKey = z.string().regex(/^(?:day:\d{4}-\d{2}-\d{2}|month:\d{4}-\d{2})$/);
const summaryPurgeCommand = purgeCommand.extend({ periodRevisions: z.record(periodRevisionKey, z.number().int().nonnegative().safe()), costRevisions: z.record(internalId, z.number().int().nonnegative().safe()) });
export function summaryPurgeBinding(value: z.infer<typeof summaryPurgeCommand>): string {
  return createHash("sha256").update(JSON.stringify(["cost_summary_purge_v1", value.commandId, value.dispatchId, value.actorId, value.approvalId, value.evidenceId, Object.entries(value.periodRevisions).sort(([a], [b]) => a.localeCompare(b)), Object.entries(value.costRevisions).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
}
/** Synthetic cost-summary purge; each archived amount is a period aggregate. */
export async function purgeSyntheticCostSummary(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = summaryPurgeCommand.parse(value);
  await repository.transaction(async (state) => {
    const approval = state.summaryPurgeApprovals?.find((a) => a.commandId === input.commandId);
    if (!approval || approval.dispatchId !== input.dispatchId || approval.actorId !== input.actorId || approval.approvalId !== input.approvalId || approval.evidenceId !== input.evidenceId || JSON.stringify(Object.entries(approval.periodRevisions).sort()) !== JSON.stringify(Object.entries(input.periodRevisions).sort()) || JSON.stringify(Object.entries(approval.costRevisions).sort()) !== JSON.stringify(Object.entries(input.costRevisions).sort())) throw new Error("Cost purge approval unavailable.");
    const existing = state.audits.find((a) => a.eventId === input.commandId);
    if (existing) {
      if (existing.eventType !== "cost_summary_purged" || existing.dispatchId !== input.dispatchId || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId) throw new Error("Command conflict.");
      return;
    }
    const dispatch = state.dispatches.find((d) => d.id === input.dispatchId);
    if (!dispatch?.completedAt || !dispatch.purgeDueAt || input.at < dispatch.purgeDueAt || input.at < dispatch.completedAt) throw new Error("Cost purge not due.");
    const slots = state.slots.filter((s) => s.dispatchId === dispatch.id);
    const lookups = state.lookups.filter((l) => slots.some((s) => s.id === l.slotId));
    const corrections = (state.corrections ?? []).filter((c) => slots.some((s) => s.id === c.slotId));
    const inventory = [...slots, ...lookups, ...corrections.map((c) => ({ id: c.commandId, revision: c.revision }))];
    if (slots.length !== dispatch.slotCount || Object.keys(input.costRevisions).sort().join("|") !== inventory.map((c) => c.id).sort().join("|") || inventory.some((c) => c.revision !== input.costRevisions[c.id])) throw new Error("Cost revision unavailable.");
    const totals = new Map<string, number>();
    for (const slot of slots) {
      if (slot.costState === "summary_purged" && slot.costSummaryPurgedAt && slot.reserved === null && slot.confirmed === null && slot.adjustment == null) continue;
      if (slot.costState !== "settled" || slot.reserved !== 0 || slot.confirmed === null || !Number.isSafeInteger(slot.confirmed) || slot.confirmed < 0) throw new Error("Cost remains unresolved.");
      for (const key of [`day:${slot.day}`, `month:${slot.month}`]) {
        const total = (totals.get(key) ?? 0) + slot.confirmed;
        if (!Number.isSafeInteger(total)) throw new Error("Cost aggregate invalid.");
        totals.set(key, total);
      }
    }
    const lookupTotals = new Map<string, number>();
    for (const lookup of lookups) {
      if (lookup.costSummaryPurgedAt && lookup.reserved === null && lookup.confirmed === null && lookup.contribution === "folded_archive") continue;
      if (lookup.status !== "resolved" || lookup.reserved !== 0 || lookup.confirmed === null || !Number.isSafeInteger(lookup.confirmed) || lookup.confirmed < 0 || lookup.contribution !== "live_summary") throw new Error("Lookup remains unresolved.");
      const key = `month:${lookup.month}`;
      const total = (lookupTotals.get(key) ?? 0) + lookup.confirmed;
      if (!Number.isSafeInteger(total)) throw new Error("Lookup aggregate invalid.");
      lookupTotals.set(key, total);
    }
    for (const correction of corrections) {
      if (correction.costSummaryPurgedAt && correction.delta === null) continue;
      if (correction.contribution !== "folded_archive" || correction.delta === null || !Number.isSafeInteger(correction.delta) || !correction.completedAt || !correction.purgeDueAt || input.at < correction.completedAt) throw new Error("Correction remains unresolved.");
    }
    const keys = new Set([...totals.keys(), ...lookupTotals.keys()]);
    if (Object.keys(input.periodRevisions).sort().join("|") !== [...keys].sort().join("|")) throw new Error("Period binding unavailable.");
    for (const key of keys) {
      const [type, periodKey] = key.split(":");
      const period = state.budgetPeriods?.find((p) => p.type === type && p.key === periodKey);
      const amount = totals.get(key) ?? 0; const lookupAmount = lookupTotals.get(key);
      if (!period || period.revision !== input.periodRevisions[key] || !Number.isSafeInteger(period.confirmed) || !Number.isSafeInteger(period.archivedConfirmed) || period.archivedConfirmed < 0 || period.archivedConfirmed + amount > period.confirmed) throw new Error("Cost aggregate invalid.");
      if (lookupAmount !== undefined && (!Number.isSafeInteger(period.lookupConfirmed) || !Number.isSafeInteger(period.lookupArchivedConfirmed) || period.lookupArchivedConfirmed! < 0 || period.lookupArchivedConfirmed! + lookupAmount > period.lookupConfirmed!)) throw new Error("Lookup aggregate invalid.");
      period.archivedConfirmed += amount;
      if (lookupAmount !== undefined) period.lookupArchivedConfirmed! += lookupAmount;
      period.revision++;
    }
    for (const lookup of lookups) {
      if (lookup.costSummaryPurgedAt) continue;
      lookup.reserved = null; lookup.confirmed = null; lookup.contribution = "folded_archive"; lookup.costSummaryPurgedAt = new Date(input.at); lookup.revision!++;
    }
    for (const correction of corrections) {
      if (correction.costSummaryPurgedAt) continue;
      correction.delta = null; correction.costSummaryPurgedAt = new Date(input.at); correction.revision!++;
      for (const evidence of state.correctionEvidence ?? []) if (evidence.evidenceId === correction.evidenceId && evidence.slotId === correction.slotId && evidence.version === correction.version) evidence.delta = null;
      for (const evidence of state.correctionApprovals ?? []) if (evidence.evidenceId === correction.evidenceId && evidence.slotId === correction.slotId && evidence.version === correction.version) evidence.delta = null;
    }
    for (const slot of slots) {
      if (slot.costState === "summary_purged") continue;
      slot.reserved = null; slot.confirmed = null; slot.adjustment = null; slot.costState = "summary_purged"; slot.costSummaryPurgedAt = new Date(input.at); slot.revision!++;
    }
    dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, sequence: dispatch.auditSequence, eventType: "cost_summary_purged", occurredAt: input.at, actorId: input.actorId, approvalId: input.approvalId, evidenceId: input.evidenceId });
  });
}

/** Prisma counterpart; approval binds the exact command and period revisions. */
export async function purgePrismaCostSummary(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = summaryPurgeCommand.parse(value); const binding = summaryPurgeBinding(input);
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; purgeExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "purgeExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime?.ownerId || runtime.purgeExecutorId !== input.actorId || !runtime.policyVersion) throw new Error("Purge authority unavailable.");
    const [link] = await tx.$queryRaw<{ outboxId: string; recipientId: string }[]>`SELECT "outboxId", "recipientId" FROM "NotificationDispatch" WHERE "id" = ${input.dispatchId} AND "environment" = 'preview'`;
    if (!link) throw new Error("Dispatch unavailable.");
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (outbox.length !== 1 || !registration) throw new Error("Purge context unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${input.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((u) => u.id === id && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(input.actorId)) throw new Error("Purge authority unavailable.");
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; slotCount: number; auditSequence: number; completedAt: Date | null; purgeDueAt: Date | null }[]>`SELECT "id", "outboxId", "recipientId", "slotCount", "auditSequence", "completedAt", "purgeDueAt" FROM "NotificationDispatch" WHERE "id" = ${input.dispatchId} FOR UPDATE`;
    if (recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) throw new Error("Purge context changed.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; dispatchId: string | null; commandId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "actorId", "dispatchId", "commandId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'cost_summary_purge_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.dispatchId !== dispatch.id || approval.commandId !== input.commandId || approval.evidenceId !== input.evidenceId || approval.payloadBinding !== binding) throw new Error("Cost purge approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; dispatchId: string | null; actorId: string | null; approvalId: string | null; evidenceId: string | null; payloadBinding: string | null }[]>`SELECT "eventType", "dispatchId", "actorId", "approvalId", "evidenceId", "payloadBinding" FROM "NotificationAudit" WHERE "eventId" = ${input.commandId}`;
    if (existing) {
      if (existing.eventType !== "cost_summary_purged" || existing.dispatchId !== dispatch.id || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId || existing.payloadBinding !== binding) throw new Error("Command conflict.");
      return;
    }
    if (!dispatch.completedAt || !dispatch.purgeDueAt || input.at < dispatch.purgeDueAt || input.at < dispatch.completedAt) throw new Error("Cost purge not due.");
    type Cost = { id: string; entryKind: string; dayKey: string; monthKey: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; adjustmentMilliKrw: bigint | null; costState: string; status: string; costSummaryPurgedAt: Date | null; revision: number; sourceCostId: string | null; sourceSlotId: string | null; adjustmentEvidenceId: string | null; correctionVersion: string | null };
    const costs = await tx.$queryRaw<Cost[]>`SELECT "id", "entryKind", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costState", "status", "costSummaryPurgedAt", "revision", "sourceCostId", "sourceSlotId", "adjustmentEvidenceId", "correctionVersion" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} ORDER BY "id" FOR UPDATE`;
    if (costs.filter((c) => c.entryKind === "SEND_SLOT").length !== dispatch.slotCount || costs.some((c) => !["SEND_SLOT", "LOOKUP_COST", "COST_CORRECTION"].includes(c.entryKind))) throw new Error("Cost ledger incomplete.");
    if (Object.keys(input.costRevisions).sort().join("|") !== costs.map((c) => c.id).sort().join("|") || costs.some((c) => c.revision !== input.costRevisions[c.id])) throw new Error("Cost revision unavailable.");
    const totals = new Map<string, bigint>(); const lookupTotals = new Map<string, bigint>();
    for (const cost of costs) {
      if (cost.costState === "summary_purged" && cost.costSummaryPurgedAt && cost.reservedMilliKrw === null && cost.confirmedMilliKrw === null && cost.adjustmentMilliKrw === null) continue;
      if (cost.entryKind === "COST_CORRECTION") {
        if (cost.costState !== "applied" || cost.status !== "applied" || cost.adjustmentMilliKrw === null || !cost.sourceCostId || !cost.sourceSlotId || !cost.adjustmentEvidenceId || !cost.correctionVersion) throw new Error("Correction remains unresolved.");
        const [receipt] = await tx.$queryRaw<{ occurredAt: Date }[]>`SELECT "occurredAt" FROM "NotificationAudit" WHERE "costOperationId" = ${cost.id} AND "eventType" = 'cost_corrected' AND "dispatchId" = ${dispatch.id} FOR UPDATE`;
        if (!receipt || receipt.occurredAt > input.at) throw new Error("Correction completion unavailable.");
        continue;
      }
      if (cost.costState !== "settled" || cost.costSummaryPurgedAt || cost.reservedMilliKrw !== 0n || cost.confirmedMilliKrw === null || cost.confirmedMilliKrw < 0n) throw new Error("Cost remains unresolved.");
      if (cost.entryKind === "LOOKUP_COST") {
        if (cost.status !== "resolved" || !cost.sourceSlotId) throw new Error("Lookup remains unresolved.");
        const key = `month:${cost.monthKey}`; lookupTotals.set(key, (lookupTotals.get(key) ?? 0n) + cost.confirmedMilliKrw);
      } else for (const key of [`day:${cost.dayKey}`, `month:${cost.monthKey}`]) totals.set(key, (totals.get(key) ?? 0n) + cost.confirmedMilliKrw);
    }
    const keys = new Set([...totals.keys(), ...lookupTotals.keys()]);
    if (Object.keys(input.periodRevisions).sort().join("|") !== [...keys].sort().join("|")) throw new Error("Period binding unavailable.");
    for (const key of [...keys].sort()) {
      const [type, periodKey] = key.split(":"); const amount = totals.get(key) ?? 0n; const lookupAmount = lookupTotals.get(key) ?? 0n;
      const [period] = await tx.$queryRaw<{ id: string; confirmedMilliKrw: bigint; archivedConfirmedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint; lookupArchivedConfirmedMilliKrw: bigint; revision: number }[]>`SELECT "id", "confirmedMilliKrw", "archivedConfirmedMilliKrw", "lookupConfirmedMilliKrw", "lookupArchivedConfirmedMilliKrw", "revision" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = ${type} AND "periodKey" = ${periodKey} FOR UPDATE`;
      if (!period || period.revision !== input.periodRevisions[key] || period.archivedConfirmedMilliKrw < 0n || period.archivedConfirmedMilliKrw + amount > period.confirmedMilliKrw || (lookupTotals.has(key) && (period.lookupArchivedConfirmedMilliKrw < 0n || period.lookupArchivedConfirmedMilliKrw + lookupAmount > period.lookupConfirmedMilliKrw))) throw new Error("Cost aggregate invalid.");
      const changed = lookupTotals.has(key)
        ? await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "archivedConfirmedMilliKrw" = "archivedConfirmedMilliKrw" + ${amount}, "lookupArchivedConfirmedMilliKrw" = "lookupArchivedConfirmedMilliKrw" + ${lookupAmount}, "revision" = "revision" + 1 WHERE "id" = ${period.id} AND "revision" = ${period.revision}`
        : await tx.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "archivedConfirmedMilliKrw" = "archivedConfirmedMilliKrw" + ${amount}, "revision" = "revision" + 1 WHERE "id" = ${period.id} AND "revision" = ${period.revision}`;
      if (changed !== 1) throw new Error("Cost period changed.");
    }
    for (const cost of costs) {
      if (cost.costState === "summary_purged") continue;
      const changed = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "reservedMilliKrw" = NULL, "confirmedMilliKrw" = NULL, "adjustmentMilliKrw" = NULL, "adjustmentCommandId" = NULL, "adjustmentApprovalId" = NULL, "adjustmentEvidenceId" = CASE WHEN "entryKind" = 'COST_CORRECTION' THEN "adjustmentEvidenceId" ELSE NULL END, "evidenceId" = NULL, "costState" = 'summary_purged', "costSummaryPurgedAt" = ${input.at}, "revision" = "revision" + 1 WHERE "id" = ${cost.id} AND "revision" = ${cost.revision} AND "costState" = ${cost.costState} AND "costSummaryPurgedAt" IS NULL`;
      if (changed !== 1) throw new Error("Cost changed.");
    }
    const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
    if (changed !== 1) throw new Error("Dispatch changed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "payloadBinding", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${input.commandId}, ${input.commandId}, 'preview', 'cost_summary_purged', ${link.outboxId}, ${dispatch.id}, ${dispatch.auditSequence + 1}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${binding}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${input.at})`;
  });
}
export async function purgeSyntheticDetails(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = purgeCommand.parse(value);
  await repository.transaction(async (state) => {
    const approval = state.purgeApprovals.find((a) => a.commandId === input.commandId);
    if (!approval || approval.dispatchId !== input.dispatchId || approval.actorId !== input.actorId || approval.approvalId !== input.approvalId || approval.evidenceId !== input.evidenceId) throw new Error("Purge approval unavailable.");
    const existing = state.audits.find((a) => a.eventId === input.commandId);
    if (existing) {
      if (existing.eventType !== "details_purged" || existing.dispatchId !== input.dispatchId || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId) throw new Error("Command conflict.");
      return;
    }
    const dispatch = state.dispatches.find((d) => d.id === input.dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    if (!dispatch || !outbox) throw new Error("Dispatch unavailable.");
    const slots = state.slots.filter((s) => s.dispatchId === dispatch.id);
    if (slots.some((slot) => ["in_flight", "unknown", "accepted"].includes(slot.status))) throw new Error("Diagnostic purpose remains unresolved.");
    outbox.providerRef = null; dispatch.detailPurgedAt = new Date(input.at);
    for (const slot of slots) { slot.providerRef = null; slot.detailPurgedAt = new Date(input.at); }
    dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, sequence: dispatch.auditSequence, eventType: "details_purged", occurredAt: input.at, approvalId: input.approvalId, evidenceId: input.evidenceId, actorId: input.actorId });
  });
}

const closeCommand = z.object({ commandId: internalId, dispatchId: internalId, actorId: internalId, approvalId: internalId, evidenceId: internalId, at: z.date(), nextReviewAt: z.date() }).strict();
/** Synthetic approved closure never changes cost, slot, outbox, or delivery. */
export async function closeSyntheticUnconfirmed(repository: DispatchRepository, value: unknown): Promise<void> {
  const input = closeCommand.parse(value);
  await repository.transaction(async (state) => {
    const approval = state.closureApprovals.find((a) => a.commandId === input.commandId);
    if (!approval || approval.dispatchId !== input.dispatchId || approval.actorId !== input.actorId || approval.approvalId !== input.approvalId || approval.evidenceId !== input.evidenceId) throw new Error("Closure approval unavailable.");
    const existing = state.audits.find((a) => a.eventId === input.commandId);
    if (existing) {
      if (existing.eventType !== "closed_unconfirmed" || existing.dispatchId !== input.dispatchId || existing.actorId !== input.actorId || existing.approvalId !== input.approvalId || existing.evidenceId !== input.evidenceId) throw new Error("Command conflict.");
      return;
    }
    const dispatch = state.dispatches.find((d) => d.id === input.dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    if (!dispatch || !outbox || dispatch.state !== "unknown" || !dispatch.unknownSince || input.at.getTime() - dispatch.unknownSince.getTime() < 30 * 86400000 || !dispatch.reviewed7dAt || dispatch.reviewed7dAt.getTime() - dispatch.unknownSince.getTime() < 7 * 86400000 || dispatch.reviewed7dAt > input.at || !dispatch.responsibilityReviewedAt || dispatch.responsibilityReviewedAt.getTime() - dispatch.unknownSince.getTime() < 30 * 86400000 || dispatch.responsibilityReviewedAt > input.at || !["sent", "failed"].includes(outbox.status) || input.nextReviewAt <= input.at || input.nextReviewAt.getTime() - input.at.getTime() > 30 * 86400000) throw new Error("Closure conditions unavailable.");
    dispatch.state = "closed_unconfirmed"; dispatch.finalStatus = "unknown"; dispatch.closedAt = new Date(input.at); dispatch.closureApprovalId = input.approvalId; dispatch.nextReviewAt = new Date(input.nextReviewAt); dispatch.auditSequence++;
    state.audits.push({ eventId: input.commandId, dispatchId: dispatch.id, sequence: dispatch.auditSequence, eventType: "closed_unconfirmed", occurredAt: input.at, approvalId: input.approvalId, evidenceId: input.evidenceId, actorId: input.actorId });
  });
}

/** Prisma partial diagnostic purge; no slot, reservation, or dedupe row is deleted. */
export async function purgePrismaDetails(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const command = purgeCommand.parse(value);
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; purgeExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "purgeExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || !runtime.ownerId || runtime.purgeExecutorId !== command.actorId || !runtime.policyVersion) throw new Error("Purge authority unavailable.");
    const [link] = await tx.$queryRaw<{ outboxId: string; recipientId: string }[]>`SELECT "outboxId", "recipientId" FROM "NotificationDispatch" WHERE "id" = ${command.dispatchId}`;
    if (!link) throw new Error("Dispatch unavailable.");
    const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
    const [registration] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId}`;
    if (outbox.length !== 1 || !registration) throw new Error("Purge context unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${command.actorId}, ${registration.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (actorId: string) => users.some((u) => u.id === actorId && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(command.actorId)) throw new Error("Purge authority unavailable.");
    const recipient = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${link.recipientId} FOR UPDATE`;
    const [dispatch] = await tx.$queryRaw<{ id: string; outboxId: string; recipientId: string; auditSequence: number }[]>`SELECT "id", "outboxId", "recipientId", "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${command.dispatchId} FOR UPDATE`;
    if (recipient.length !== 1 || !dispatch || dispatch.outboxId !== link.outboxId || dispatch.recipientId !== link.recipientId) throw new Error("Purge context changed.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; dispatchId: string | null; commandId: string | null; evidenceId: string | null }[]>`SELECT "actorId", "dispatchId", "commandId", "evidenceId" FROM "NotificationAudit" WHERE "eventId" = ${command.approvalId} AND "environment" = 'preview' AND "eventType" = 'details_purge_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.dispatchId !== dispatch.id || approval.commandId !== command.commandId || approval.evidenceId !== command.evidenceId) throw new Error("Purge approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; dispatchId: string | null; actorId: string | null; approvalId: string | null; evidenceId: string | null }[]>`SELECT "eventType", "dispatchId", "actorId", "approvalId", "evidenceId" FROM "NotificationAudit" WHERE "eventId" = ${command.commandId}`;
    if (existing) {
      if (existing.eventType !== "details_purged" || existing.dispatchId !== dispatch.id || existing.actorId !== command.actorId || existing.approvalId !== command.approvalId || existing.evidenceId !== command.evidenceId) throw new Error("Command conflict.");
      return;
    }
    const costs = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} ORDER BY "sequence" FOR UPDATE`;
    // Until a per-reference purpose check is available, preserve references
    // whenever an in-flight or unknown operation may still need them.
    if (costs.some((cost) => ["in_flight", "unknown", "accepted"].includes(cost.status))) throw new Error("Diagnostic purpose remains unresolved.");
    const changedOutbox = await tx.$executeRaw`UPDATE "NotificationOutbox" SET "providerRef" = NULL WHERE "id" = ${link.outboxId}`;
    await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "providerRef" = NULL, "resultCode" = NULL, "detailPurgedAt" = COALESCE("detailPurgedAt", ${command.at}) WHERE "dispatchId" = ${dispatch.id}`;
    await tx.$executeRaw`UPDATE "NotificationAudit" SET "providerRef" = NULL WHERE "dispatchId" = ${dispatch.id} AND "providerRef" IS NOT NULL`;
    const changedDispatch = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "purgedAt" = COALESCE("purgedAt", ${command.at}), "purgeScope" = 'detail', "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id}`;
    if (changedOutbox !== 1 || changedDispatch !== 1) throw new Error("Purge storage failed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "sequence", "actorId", "commandId", "approvalId", "evidenceId", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${command.commandId}, ${command.commandId}, 'preview', 'details_purged', ${link.outboxId}, ${dispatch.id}, ${dispatch.auditSequence + 1}, ${command.actorId}, ${command.commandId}, ${command.approvalId}, ${command.evidenceId}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${command.at})`;
  });
}

const recipientPurgeCommand = z.object({ commandId: internalId, registrationId: internalId, actorId: internalId, approvalId: internalId, evidenceId: internalId, at: z.date() }).strict();
/** Purge ciphertext of an already revoked version; never cascade to dispatch or slots. */
export async function purgePrismaRecipientCiphertext(repository: PrismaDispatchRepository, value: unknown): Promise<void> {
  const command = recipientPurgeCommand.parse(value);
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ ownerId: string | null; purgeExecutorId: string | null; policyVersion: string | null; revision: number }[]>`SELECT "ownerId", "purgeExecutorId", "policyVersion", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || !runtime.ownerId || runtime.purgeExecutorId !== command.actorId || !runtime.policyVersion) throw new Error("Purge authority unavailable.");
    const [target] = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "NotificationRecipientRegistration" WHERE "id" = ${command.registrationId} AND "environment" = 'preview'`;
    if (!target) throw new Error("Registration unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${command.actorId}, ${target.userId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (actorId: string) => users.some((u) => u.id === actorId && u.role === "ADMIN" && u.isActive && !u.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(command.actorId)) throw new Error("Purge authority unavailable.");
    const [registration] = await tx.$queryRaw<{ id: string; userId: string; state: string }[]>`SELECT "id", "userId", "state" FROM "NotificationRecipientRegistration" WHERE "id" = ${command.registrationId} AND "environment" = 'preview' FOR UPDATE`;
    if (!registration || registration.userId !== target.userId || !["revoked", "superseded", "purged"].includes(registration.state)) throw new Error("Registration purpose has not ended.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; registrationId: string | null; commandId: string | null; evidenceId: string | null }[]>`SELECT "actorId", "registrationId", "commandId", "evidenceId" FROM "NotificationAudit" WHERE "eventId" = ${command.approvalId} AND "environment" = 'preview' AND "eventType" = 'recipient_purge_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.registrationId !== registration.id || approval.commandId !== command.commandId || approval.evidenceId !== command.evidenceId) throw new Error("Purge approval unavailable.");
    const [existing] = await tx.$queryRaw<{ eventType: string; registrationId: string | null; actorId: string | null; approvalId: string | null; evidenceId: string | null }[]>`SELECT "eventType", "registrationId", "actorId", "approvalId", "evidenceId" FROM "NotificationAudit" WHERE "eventId" = ${command.commandId}`;
    if (existing) {
      if (existing.eventType !== "recipient_purged" || existing.registrationId !== registration.id || existing.actorId !== command.actorId || existing.approvalId !== command.approvalId || existing.evidenceId !== command.evidenceId) throw new Error("Command conflict.");
      return;
    }
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "purgedAt" = COALESCE("purgedAt", ${command.at}) WHERE "id" = ${registration.id} AND "state" IN ('revoked', 'superseded', 'purged')`;
    if (changed !== 1) throw new Error("Registration changed.");
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "registrationId", "actorId", "commandId", "approvalId", "evidenceId", "policyVersion", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${command.commandId}, ${command.commandId}, 'preview', 'recipient_purged', ${registration.id}, ${command.actorId}, ${command.commandId}, ${command.approvalId}, ${command.evidenceId}, ${runtime.policyVersion}, ${runtime.revision}, ${runtime.revision}, ${command.at})`;
  });
}
