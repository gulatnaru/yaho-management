import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CoreState, DispatchRepository } from "@/server/kakao/dispatch-repository";
import { isValidSendRuntime } from "@/lib/kakao/send-config";
import { providerRefSchema, sendErrorCodeSchema, sendSkipCodeSchema } from "@/lib/kakao/send-contract";
import {
  LEASE_MS, OutboxInputError, OutboxStaleClaimError, OutboxTransitionError, parseOutboxInput,
  type OutboxEnqueueInput, type OutboxErrorCode, type OutboxSkipCode, type OutboxRow, type OutboxStatus, type OutboxStore,
} from "@/lib/kakao/outbox";

function clone(row: OutboxRow): OutboxRow {
  return { ...row, occurredAt: new Date(row.occurredAt), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), nextRetryAt: row.nextRetryAt === null ? null : new Date(row.nextRetryAt), leaseExpiresAt: row.leaseExpiresAt === null ? null : new Date(row.leaseExpiresAt) };
}
function checkClaim(limit: number, now: Date): void {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(now.getTime())) throw new OutboxInputError();
}
function checkRetry(errorCode: OutboxErrorCode, nextRetryAt: Date | null): void {
  if (!sendErrorCodeSchema.safeParse(errorCode).success || (nextRetryAt !== null && (!Number.isFinite(nextRetryAt.getTime()) || !["provider_error", "provider_rate_limited"].includes(errorCode)))) throw new OutboxInputError();
}
// Arbitrary provider reasons may contain PII. Never persist them.
function skippedCode(reason?: string): OutboxSkipCode | "provider_unconfigured" | null {
  if (reason === "provider_unconfigured") return reason;
  const parsed = sendSkipCodeSchema.safeParse(reason); return parsed.success ? parsed.data : null;
}

const outboxAuditSchema = z.object({
  eventId: z.string().uuid(), outboxId: z.string().min(1).max(128), dispatchId: z.string().min(1).max(128).optional(),
  sequence: z.number().int().positive().optional(), slotId: z.string().min(1).max(128).optional(),
  eventType: z.enum(["outbox_claimed", "outbox_recovered", "outbox_skipped", "outbox_failed", "result_recorded", "result_unknown"]), occurredAt: z.date(),
  fromState: z.string().optional(), toState: z.string().optional(), code: z.string().optional(), actorId: z.string().optional(),
}).strict();

/** The default adapter uses the same copy-on-write transaction contract as
 * an injected dispatch repository. No separate outbox or audit authority. */
function emptyRepository(): DispatchRepository {
  let state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
  let tail = Promise.resolve();
  return { async transaction<T>(work: (candidate: CoreState) => Promise<T>): Promise<T> {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { const candidate = structuredClone(state); const result = await work(candidate); const detached = structuredClone(result); state = structuredClone(candidate); return detached; } finally { release(); }
  } };
}
export class InMemoryOutboxStore implements OutboxStore {
  constructor(private readonly repository: DispatchRepository = emptyRepository()) {}
  usesRepository(repository: unknown): boolean { return this.repository === repository; }
  private rows(state: CoreState): OutboxRow[] { return state.outboxes as OutboxRow[]; }
  private audit(state: CoreState, rowId: string, eventType: "outbox_claimed" | "outbox_recovered" | "outbox_skipped" | "outbox_failed" | "result_recorded" | "result_unknown", at: Date, slotId?: string): void {
    const dispatch = state.dispatches.find((d) => d.outboxId === rowId);
    if (dispatch) dispatch.auditSequence++;
    state.audits.push(outboxAuditSchema.parse({ eventId: randomUUID(), outboxId: rowId, dispatchId: dispatch?.id, sequence: dispatch?.auditSequence, slotId, eventType, occurredAt: at }));
  }
  async enqueue(input: OutboxEnqueueInput): Promise<{ created: boolean; row: OutboxRow }> {
    const data = parseOutboxInput(input);
    return this.repository.transaction(async (state) => {
      const existing = this.rows(state).find((row) => row.dedupeKey === data.dedupeKey);
      if (existing) return { created: false, row: clone(existing) };
      const now = new Date();
      const row: OutboxRow = { ...data, id: randomUUID(), status: "pending", attemptCount: 0, lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, createdAt: now, updatedAt: now };
      state.outboxes.push(row); return { created: true, row: clone(row) };
    });
  }
  async findByDedupeKey(key: string): Promise<OutboxRow | null> {
    return this.repository.transaction(async (state) => { const row = this.rows(state).find((item) => item.dedupeKey === key); return row ? clone(row) : null; });
  }
  async claimDue(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    const ids = await this.repository.transaction(async (state) => this.rows(state).filter((r) => r.status === "pending" && (r.nextRetryAt === null || r.nextRetryAt <= now)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).slice(0, limit).map((r) => r.id));
    const result: OutboxRow[] = [];
    for (const id of ids) {
      const row = await this.repository.transaction(async (state) => {
        const row = this.rows(state).find((r) => r.id === id);
        if (!row || row.status !== "pending" || (row.nextRetryAt !== null && row.nextRetryAt > now)) return null;
        Object.assign(row, { status: "processing", claimToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: new Date(now) });
        this.audit(state, id, "outbox_claimed", now); return clone(row);
      });
      if (row) result.push(row);
    }
    return result;
  }
  async recoverStale(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    const ids = await this.repository.transaction(async (state) => this.rows(state).filter((r) => r.status === "processing" && r.leaseExpiresAt !== null && r.leaseExpiresAt <= now).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).slice(0, limit).map((r) => r.id));
    const result: OutboxRow[] = [];
    for (const id of ids) {
      const row = await this.repository.transaction(async (state) => {
        const row = this.rows(state).find((r) => r.id === id);
        if (!row || row.status !== "processing" || row.leaseExpiresAt === null || row.leaseExpiresAt > now) return null;
        const dispatch = state.dispatches.find((d) => d.outboxId === id);
        const slot = dispatch && state.slots.find((s) => s.dispatchId === dispatch.id && s.status === "in_flight");
        if (dispatch && slot) {
          slot.status = "unknown"; dispatch.state = "unknown"; dispatch.unknownSince ??= new Date(now);
          Object.assign(row, { status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: new Date(now) });
          this.audit(state, id, "result_unknown", now, slot.id); return clone(row);
        }
        if (dispatch && (dispatch.state === "unknown" || dispatch.state === "closed_unconfirmed")) {
          Object.assign(row, { status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: new Date(now) });
          this.audit(state, id, "result_unknown", now); return clone(row);
        }
        if (dispatch && !["ready", "rejected"].includes(dispatch.state)) return null;
        Object.assign(row, { status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: new Date(now), updatedAt: new Date(now) });
        this.audit(state, id, "outbox_recovered", now); return clone(row);
      });
      if (row) result.push(row);
    }
    return result;
  }
  private processing(state: CoreState, rowId: string, claimToken: string): OutboxRow {
    const row = this.rows(state).find((r) => r.id === rowId);
    if (!row || row.status !== "processing") throw new OutboxTransitionError();
    if (row.claimToken !== claimToken) throw new OutboxStaleClaimError();
    return row;
  }
  /** Release only a fenced claim with no unresolved or issued send. */
  async releaseUnissued(rowId: string, claimToken: string, now: Date): Promise<void> {
    await this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken);
      const dispatch = state.dispatches.find((d) => d.outboxId === rowId);
      if (dispatch && (!['ready', 'rejected'].includes(dispatch.state) || state.slots.some((s) => s.dispatchId === dispatch.id && s.status !== 'rejected'))) throw new OutboxTransitionError();
      Object.assign(row, { status: 'pending', claimToken: null, leaseExpiresAt: null, updatedAt: new Date(now) });
      this.audit(state, rowId, 'outbox_recovered', now);
    });
  }
  async markSent(rowId: string, claimToken: string, providerRef?: string): Promise<OutboxRow> {
    return this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken); const dispatch = state.dispatches.find((d) => d.outboxId === rowId); const now = new Date();
      if (!providerRefSchema.safeParse(providerRef).success) throw new OutboxInputError();
      if (!dispatch) throw new OutboxTransitionError();
      const slot = state.slots.find((s) => s.dispatchId === dispatch.id && s.status === "in_flight");
      if (!providerRef || dispatch.state !== "in_flight" || dispatch.detailPurgedAt || !slot || slot.detailPurgedAt) throw new OutboxTransitionError();
      slot.status = "accepted"; slot.providerRef = providerRef; dispatch.state = "accepted"; const slotId = slot.id;
      Object.assign(row, { status: "sent", lastErrorCode: null, providerId: providerRef === undefined ? null : "solapi", providerRef: providerRef ?? null, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: now });
      this.audit(state, rowId, "result_recorded", now, slotId); return clone(row);
    });
  }
  async markSkipped(rowId: string, claimToken: string, reason?: string, at?: Date): Promise<OutboxRow> {
    return this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken); const now = at ?? new Date();
      if (!Number.isFinite(now.getTime()) || (at && !isValidSendRuntime(state.runtime && { environment: state.runtime.environment, provider: state.runtime.provider, blocked: state.runtime.blocked, activationEpoch: state.runtime.activationEpoch }))) throw new OutboxInputError();
      if (at && (!row.leaseExpiresAt || row.leaseExpiresAt <= now)) throw new OutboxStaleClaimError();
      const dispatch = state.dispatches.find((d) => d.outboxId === rowId);
      // Only lookups identifiable with this dispatch are in scope; ambiguous
      // links to one of its slots fail closed, as do unavailable values.
      const unresolvedLookup = state.lookups.some((l) => {
        const linked = state.slots.filter((slot) => slot.id === l.slotId);
        return linked.some((slot) => slot.dispatchId === dispatch?.id) && (linked.length !== 1 || l.status !== "resolved" || (l.costSummaryPurgedAt
          ? l.reserved !== null || l.confirmed !== null || l.contribution !== "folded_archive"
          : l.reserved !== 0 || l.confirmed === null || !Number.isSafeInteger(l.confirmed) || l.confirmed < 0));
      });
      const unresolvedCorrection = (state.corrections ?? []).some((c) => { const linked = state.slots.filter((slot) => slot.id === c.slotId); return linked.some((slot) => slot.dispatchId === dispatch?.id) && (linked.length !== 1 || !(c.appliedAt instanceof Date) || !Number.isFinite(c.appliedAt.getTime()) || (c.costSummaryPurgedAt == null ? !Number.isSafeInteger(c.delta) : !(c.costSummaryPurgedAt instanceof Date) || !Number.isFinite(c.costSummaryPurgedAt.getTime()) || c.delta !== null || c.contribution !== "folded_archive")); });
      if (unresolvedLookup || unresolvedCorrection || (dispatch && (!['ready', 'rejected'].includes(dispatch.state) || state.slots.some((s) => s.dispatchId === dispatch.id && (s.status !== 'rejected' || (s.costState === 'summary_purged' ? !s.costSummaryPurgedAt || s.reserved !== null || s.confirmed !== null || s.adjustment != null : s.costState !== 'settled' || s.costSummaryPurgedAt != null || s.reserved !== 0 || !Number.isSafeInteger(s.confirmed) || s.confirmed! < 0)))))) throw new OutboxTransitionError();
      const code = skippedCode(reason);
      Object.assign(row, { status: "skipped", lastErrorCode: code, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: now });
      if (dispatch) dispatch.auditSequence++;
      state.audits.push(outboxAuditSchema.parse({ eventId: randomUUID(), outboxId: rowId, dispatchId: dispatch?.id, sequence: dispatch?.auditSequence, eventType: "outbox_skipped", occurredAt: now, fromState: "processing", toState: "skipped", code: code ?? undefined, actorId: "system" }));
      return clone(row);
    });
  }
  async markFailed(rowId: string, claimToken: string, errorCode: OutboxErrorCode, nextRetryAt: Date | null): Promise<OutboxRow> {
    checkRetry(errorCode, nextRetryAt);
    return this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken); const dispatch = state.dispatches.find((d) => d.outboxId === rowId); const now = new Date(); let slotId: string | undefined;
      if (dispatch && errorCode === "provider_result_unknown") {
        const slot = state.slots.find((s) => s.dispatchId === dispatch.id && s.status === "in_flight");
        if (!slot || dispatch.state !== "in_flight") throw new OutboxTransitionError();
        slot.status = "unknown"; dispatch.state = "unknown"; dispatch.unknownSince ??= now; slotId = slot.id;
      } else if (dispatch && state.slots.some((s) => s.dispatchId === dispatch.id && s.status === "in_flight")) throw new OutboxTransitionError();
      Object.assign(row, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: row.attemptCount + 1, lastErrorCode: errorCode, nextRetryAt: nextRetryAt === null ? null : new Date(nextRetryAt), claimToken: null, leaseExpiresAt: null, updatedAt: now });
      this.audit(state, rowId, errorCode === "provider_result_unknown" ? "result_unknown" : "outbox_failed", now, slotId); return clone(row);
    });
  }

  async markDefiniteRejection(rowId: string, claimToken: string, dispatchId: string, slotId: string, nextRetryAt: Date | null, at: Date): Promise<OutboxRow> {
    checkRetry("provider_error", nextRetryAt);
    return this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken);
      const dispatch = state.dispatches.find((d) => d.id === dispatchId && d.outboxId === rowId);
      const slot = state.slots.find((s) => s.id === slotId && s.dispatchId === dispatchId && s.status === "in_flight");
      if (!dispatch || dispatch.state !== "in_flight" || !slot) throw new OutboxTransitionError();
      slot.status = "rejected"; dispatch.state = "rejected";
      Object.assign(row, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: row.attemptCount + 1, lastErrorCode: "provider_error", nextRetryAt, claimToken: null, leaseExpiresAt: null, updatedAt: new Date(at) });
      this.audit(state, rowId, "outbox_failed", at, slotId);
      return clone(row);
    });
  }
  async markExpired(rowId: string, claimToken: string, at: Date): Promise<OutboxRow> {
    return this.repository.transaction(async (state) => {
      const row = this.processing(state, rowId, claimToken);
      const dispatch = state.dispatches.find((d) => d.outboxId === rowId);
      const slots = dispatch ? state.slots.filter((slot) => slot.dispatchId === dispatch.id) : [];
      const unresolvedSlot = slots.some((slot) => slot.status !== "rejected" || (slot.costState === "summary_purged"
        ? !slot.costSummaryPurgedAt || slot.reserved !== null || slot.confirmed !== null || slot.adjustment != null
        : slot.costState !== "settled" || slot.costSummaryPurgedAt != null || slot.reserved !== 0 || !Number.isSafeInteger(slot.confirmed) || slot.confirmed! < 0));
      const unresolvedLookup = state.lookups.some((lookup) => {
        const linked = state.slots.filter((slot) => slot.id === lookup.slotId);
        return linked.some((slot) => slot.dispatchId === dispatch?.id) && (linked.length !== 1 || lookup.status !== "resolved" || (lookup.costSummaryPurgedAt
          ? lookup.reserved !== null || lookup.confirmed !== null || lookup.contribution !== "folded_archive"
          : lookup.reserved !== 0 || lookup.confirmed === null || !Number.isSafeInteger(lookup.confirmed) || lookup.confirmed < 0));
      });
      const unresolvedCorrection = (state.corrections ?? []).some((c) => { const linked = state.slots.filter((slot) => slot.id === c.slotId); return linked.some((slot) => slot.dispatchId === dispatch?.id) && (linked.length !== 1 || !(c.appliedAt instanceof Date) || !Number.isFinite(c.appliedAt.getTime()) || (c.costSummaryPurgedAt == null ? !Number.isSafeInteger(c.delta) : !(c.costSummaryPurgedAt instanceof Date) || !Number.isFinite(c.costSummaryPurgedAt.getTime()) || c.delta !== null || c.contribution !== "folded_archive")); });
      if (!Number.isFinite(at.getTime()) || at.getTime() < row.occurredAt.getTime() + 86_400_000 || unresolvedLookup || unresolvedCorrection || (dispatch && (!['ready', 'rejected'].includes(dispatch.state) || unresolvedSlot))) throw new OutboxTransitionError();
      Object.assign(row, { status: 'skipped', lastErrorCode: 'event_expired', nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: new Date(at) });
      this.audit(state, rowId, 'outbox_skipped', at); return clone(row);
    });
  }
}

// Deliberately local types: the unapplied migration has no generated delegate.
// After migration + prisma generate, verify the real client structurally fits
// this interface before wiring. No generated model imports or Prisma singleton.
export type OutboxDbRow = Omit<OutboxRow, "eventKind" | "audience" | "lastErrorCode"> & {
  eventKind: string; audience: string; lastErrorCode: string | null;
};
type OutboxDbUpdate = {
  status: OutboxStatus;
  attemptCount?: { increment: number };
  lastErrorCode?: OutboxErrorCode | OutboxSkipCode | null;
  providerId?: string | null;
  providerRef?: string | null;
  nextRetryAt?: Date | null;
  claimToken?: string | null;
  leaseExpiresAt?: Date | null;
};
type DueFilter = { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: Date } }] };
type ExpiredFilter = { leaseExpiresAt: { lte: Date } };
type OutboxAuditTx = OutboxDbClient & {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  notificationAudit: { create(args: { data: { eventId: string; environment: "preview"; eventType: "result_recorded"; outboxId: string; dispatchId: string; slotId: string; sequence: number; providerRef: string; occurredAt: Date } }): Promise<unknown> };
  notificationDispatch: { findUnique(args: { where: { outboxId: string } }): Promise<{ id: string; reconciliationState: string; auditSequence: number; purgedAt: Date | null; purgeScope: string | null } | null>; updateMany(args: { where: { id: string; reconciliationState: string }; data: { reconciliationState: string; auditSequence: { increment: number } } }): Promise<{ count: number }> };
  notificationCostReservation: { findFirst(args: { where: { dispatchId: string; status: string; entryKind: "SEND_SLOT" } }): Promise<{ id: string; detailPurgedAt: Date | null } | null>; updateMany(args: { where: { id: string; status: string }; data: { status: string; providerRef: string; resultAt: Date } }): Promise<{ count: number }> };
};
export interface OutboxDbClient {
  notificationOutbox: {
    create(args: { data: OutboxEnqueueInput & { status: "pending" } }): Promise<OutboxDbRow>;
    findUnique(args: { where: { id: string } | { dedupeKey: string } }): Promise<OutboxDbRow | null>;
    findMany(args: { where: ({ status: "pending" } & DueFilter) | ({ status: "processing" } & ExpiredFilter); orderBy: { occurredAt: "asc" }; take: number }): Promise<OutboxDbRow[]>;
    updateMany(args: { where: { id: string; status: "pending" | "processing"; claimToken?: string } & Partial<DueFilter & ExpiredFilter>; data: OutboxDbUpdate }): Promise<{ count: number }>;
  };
}

function fromDb(row: OutboxDbRow): OutboxRow {
  const input = parseOutboxInput({ eventKind: row.eventKind as OutboxEnqueueInput["eventKind"], entityId: row.entityId, dedupeKey: row.dedupeKey, audience: row.audience as OutboxEnqueueInput["audience"], occurredAt: row.occurredAt });
  if (row.lastErrorCode !== null && row.lastErrorCode !== "provider_unconfigured" && !sendErrorCodeSchema.safeParse(row.lastErrorCode).success && !sendSkipCodeSchema.safeParse(row.lastErrorCode).success) throw new OutboxInputError();
  if ((row.providerId !== null && row.providerId !== "solapi") || (row.providerRef !== null && (row.providerId !== "solapi" || !providerRefSchema.safeParse(row.providerRef).success))) throw new OutboxInputError();
  return clone({ ...row, ...input, lastErrorCode: row.lastErrorCode as OutboxErrorCode | OutboxSkipCode | null });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly db: OutboxDbClient) {}
  usesClient(client: { matchesClient(value: unknown): boolean }): boolean { return client.matchesClient(this.db); }

  /** Return a fenced, unissued claim to pending without reopening a send. */
  async releaseUnissued(rowId: string, claimToken: string, now: Date): Promise<void> {
    if (!Number.isFinite(now.getTime()) || !("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const db = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
    await db.$transaction(async (tx) => {
      const runtime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${rowId} AND "status" = 'processing' AND "claimToken" = ${claimToken} FOR UPDATE`;
      if (runtime.length !== 1 || locked.length !== 1) throw new OutboxStaleClaimError();
      const [dispatch] = await tx.$queryRaw<{ id: string; reconciliationState: string; auditSequence: number }[]>`SELECT "id", "reconciliationState", "auditSequence" FROM "NotificationDispatch" WHERE "outboxId" = ${rowId} FOR UPDATE`;
      if (dispatch) {
        if (!["ready", "rejected"].includes(dispatch.reconciliationState)) throw new OutboxTransitionError();
        const slots = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' AND "status" <> 'rejected' FOR UPDATE`;
        if (slots.length) throw new OutboxTransitionError();
        const updated = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
        if (updated !== 1) throw new OutboxTransitionError();
        const eventId = randomUUID();
        await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "sequence", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'outbox_recovered', ${rowId}, ${dispatch.id}, ${dispatch.auditSequence + 1}, ${now})`;
      } else {
        const eventId = randomUUID();
        await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'outbox_recovered', ${rowId}, ${now})`;
      }
      const changed = await tx.notificationOutbox.updateMany({ where: { id: rowId, status: "processing", claimToken }, data: { status: "pending", claimToken: null, leaseExpiresAt: null } });
      if (changed.count !== 1) throw new OutboxStaleClaimError();
    });
  }

  async enqueue(input: OutboxEnqueueInput): Promise<{ created: boolean; row: OutboxRow }> {
    const data = parseOutboxInput(input);
    try {
      return { created: true, row: fromDb(await this.db.notificationOutbox.create({ data: { ...data, status: "pending" } })) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const row = await this.findByDedupeKey(data.dedupeKey);
      if (row === null) throw error;
      return { created: false, row };
    }
  }

  async findByDedupeKey(dedupeKey: string): Promise<OutboxRow | null> {
    const row = await this.db.notificationOutbox.findUnique({ where: { dedupeKey } });
    return row === null ? null : fromDb(row);
  }

  async claimDue(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    const candidates = await this.db.notificationOutbox.findMany({ where: { status: "pending", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }, orderBy: { occurredAt: "asc" }, take: limit });
    const claimed: OutboxRow[] = [];
    for (const candidate of candidates) {
      const row = fromDb(candidate);
      // Recheck due as well: a stale candidate may have been claimed and then
      // returned to pending with a future retry timestamp by another worker.
      const claimToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const result = await this.db.notificationOutbox.updateMany({ where: { id: row.id, status: "pending", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }, data: { status: "processing", claimToken, leaseExpiresAt } });
      if (result.count === 1) claimed.push({ ...row, status: "processing", claimToken, leaseExpiresAt }); // count=0: lost race
    }
    return claimed;
  }

  async recoverStale(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    // SQL lte excludes NULL: without a lease timestamp expiry is unproven.
    const candidates = await this.db.notificationOutbox.findMany({ where: { status: "processing", leaseExpiresAt: { lte: now } }, orderBy: { occurredAt: "asc" }, take: limit });
    const recovered: OutboxRow[] = [];
    for (const candidate of candidates) {
      const row = fromDb(candidate);
      if (!("$transaction" in this.db) || typeof this.db.$transaction !== "function") continue;
      const db = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
      const recoveredRow = await db.$transaction(async (tx) => {
        const runtime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
        if (runtime.length !== 1) return null;
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${row.id} AND "status" = 'processing' AND "leaseExpiresAt" <= ${now} FOR UPDATE`;
        if (!locked) return null;
        const [dispatch] = await tx.$queryRaw<{ id: string; auditSequence: number; reconciliationState: string }[]>`SELECT "id", "auditSequence", "reconciliationState" FROM "NotificationDispatch" WHERE "outboxId" = ${row.id} FOR UPDATE`;
        const [slot] = dispatch ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' AND "status" = 'in_flight' FOR UPDATE` : [];
        if (dispatch && (slot || ["open_unknown", "closed_unconfirmed"].includes(dispatch.reconciliationState))) {
          if (slot) {
            const changed = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'unknown', "costState" = 'reserved_unknown', "resultAt" = ${now} WHERE "id" = ${slot.id} AND "status" = 'in_flight'`;
            if (changed !== 1) throw new OutboxTransitionError();
          }
          const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState" = CASE WHEN "reconciliationState" = 'closed_unconfirmed' THEN 'closed_unconfirmed' ELSE 'open_unknown' END, "unknownSince" = COALESCE("unknownSince", ${now}), "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
          if (changed !== 1) throw new OutboxTransitionError();
          const eventId = randomUUID();
          await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "code", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'result_unknown', ${row.id}, ${dispatch.id}, ${slot?.id ?? null}, ${dispatch.auditSequence + 1}, 'provider_result_unknown', ${now})`;
          const result = await tx.notificationOutbox.updateMany({ where: { id: row.id, status: "processing", leaseExpiresAt: { lte: now } }, data: { status: "failed", lastErrorCode: "provider_result_unknown", claimToken: null, leaseExpiresAt: null, nextRetryAt: null } });
          if (result.count !== 1) throw new OutboxTransitionError();
          return { ...row, status: "failed" as const, lastErrorCode: "provider_result_unknown" as const, claimToken: null, leaseExpiresAt: null, nextRetryAt: null };
        }
        if (dispatch && !["ready", "rejected"].includes(dispatch.reconciliationState)) return null;
        const result = await tx.notificationOutbox.updateMany({ where: { id: row.id, status: "processing", leaseExpiresAt: { lte: now } }, data: { status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: now } });
        return result.count === 1 ? { ...row, status: "pending" as const, claimToken: null, leaseExpiresAt: null, nextRetryAt: new Date(now) } : null;
      });
      if (recoveredRow) recovered.push(recoveredRow);
    }
    return recovered;
  }

  private async transition(rowId: string, claimToken: string, data: OutboxDbUpdate, validate?: () => void): Promise<OutboxRow> {
    const current = await this.db.notificationOutbox.findUnique({ where: { id: rowId } });
    if (current === null || current.status !== "processing") throw new OutboxTransitionError();
    if (current.claimToken !== claimToken) throw new OutboxStaleClaimError();
    validate?.();
    // Recheck ownership in the write: recovery/re-claim may race the read.
    const result = await this.db.notificationOutbox.updateMany({ where: { id: rowId, status: "processing", claimToken }, data: { ...data, claimToken: null, leaseExpiresAt: null } });
    if (result.count !== 1) throw new OutboxStaleClaimError();
    const row = await this.db.notificationOutbox.findUnique({ where: { id: rowId } });
    if (row === null) throw new OutboxTransitionError();
    return fromDb(row);
  }

  async markSent(rowId: string, claimToken: string, providerRef?: string): Promise<OutboxRow> {
    if (!providerRefSchema.safeParse(providerRef).success) {
      const row = await this.db.notificationOutbox.findUnique({ where: { id: rowId } });
      if (!row || row.status !== "processing") throw new OutboxTransitionError();
      if (row.claimToken !== claimToken) throw new OutboxStaleClaimError();
      throw new OutboxInputError();
    }
    if (providerRef === undefined) throw new OutboxInputError();
    if (!("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const transactional = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx) => Promise<T>): Promise<T> };
    return transactional.$transaction(async (tx) => {
      if (!tx.notificationAudit || !tx.notificationDispatch || !tx.notificationCostReservation || typeof tx.$queryRaw !== "function") throw new OutboxInputError();
      const lockedRuntime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const lockedOutbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${rowId} FOR UPDATE`;
      if (lockedRuntime.length !== 1 || lockedOutbox.length !== 1) throw new OutboxTransitionError();
      const dispatch = await tx.notificationDispatch.findUnique({ where: { outboxId: rowId } });
      if (!dispatch || dispatch.reconciliationState !== "in_flight" || dispatch.purgedAt !== null) throw new OutboxTransitionError();
      const slot = await tx.notificationCostReservation.findFirst({ where: { dispatchId: dispatch.id, status: "in_flight", entryKind: "SEND_SLOT" } });
      if (!slot || slot.detailPurgedAt !== null) throw new OutboxTransitionError();
      const observedAt = new Date();
      const changedSlot = await tx.notificationCostReservation.updateMany({ where: { id: slot.id, status: "in_flight" }, data: { status: "accepted", providerRef, resultAt: observedAt } });
      const changedDispatch = await tx.notificationDispatch.updateMany({ where: { id: dispatch.id, reconciliationState: "in_flight" }, data: { reconciliationState: "awaiting_final", auditSequence: { increment: 1 } } });
      if (changedSlot.count !== 1 || changedDispatch.count !== 1) throw new OutboxTransitionError();
      const row = await new PrismaOutboxStore(tx).transition(rowId, claimToken, { status: "sent", providerId: "solapi", providerRef, lastErrorCode: null, nextRetryAt: null });
      await tx.notificationAudit.create({ data: { eventId: randomUUID(), environment: "preview", eventType: "result_recorded", outboxId: rowId, dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence + 1, providerRef, occurredAt: observedAt } });
      return row;
    });
  }
  async markSkipped(rowId: string, claimToken: string, reason?: string, at?: Date): Promise<OutboxRow> {
    const now = at ?? new Date();
    if (!Number.isFinite(now.getTime()) || !("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const db = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
    return db.$transaction(async (tx) => {
      const [runtime] = await tx.$queryRaw<{ environment: string; providerId: string | null; blocked: boolean; activationEpoch: Date | null }[]>`SELECT "environment", "providerId", "blocked", "activationEpoch" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const [row] = await tx.$queryRaw<{ id: string; status: string; claimToken: string | null; leaseExpiresAt: Date | null }[]>`SELECT "id", "status", "claimToken", "leaseExpiresAt" FROM "NotificationOutbox" WHERE "id" = ${rowId} FOR UPDATE`;
      if (!row || row.status !== 'processing') throw new OutboxTransitionError();
      if (row.claimToken !== claimToken) throw new OutboxStaleClaimError();
      if (at && !isValidSendRuntime(runtime && { environment: runtime.environment, provider: runtime.providerId, blocked: runtime.blocked, activationEpoch: runtime.activationEpoch })) throw new OutboxInputError();
      if (at && (!row.leaseExpiresAt || row.leaseExpiresAt <= now)) throw new OutboxStaleClaimError();
      const [dispatch] = await tx.$queryRaw<{ id: string; reconciliationState: string; auditSequence: number }[]>`SELECT "id", "reconciliationState", "auditSequence" FROM "NotificationDispatch" WHERE "outboxId" = ${rowId} FOR UPDATE`;
      if (dispatch) {
        type Cost = { id: string; entryKind: string; status: string; costState: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; adjustmentMilliKrw: bigint | null; costSummaryPurgedAt: Date | null; sourceSlotId: string | null; sourceCostId: string | null };
        const slots = await tx.$queryRaw<Cost[]>`SELECT "id", "entryKind", "status", "costState", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costSummaryPurgedAt", "sourceSlotId", "sourceCostId" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' ORDER BY "sequence" FOR UPDATE`;
        const related = await tx.$queryRaw<Cost[]>`SELECT "id", "entryKind", "status", "costState", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costSummaryPurgedAt", "sourceSlotId", "sourceCostId" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" <> 'SEND_SLOT' ORDER BY "id" FOR UPDATE`;
        const settled = (cost: Cost) => cost.costState === "summary_purged"
          ? cost.costSummaryPurgedAt !== null && cost.reservedMilliKrw === null && cost.confirmedMilliKrw === null && cost.adjustmentMilliKrw === null
          : cost.costState === "settled" && cost.reservedMilliKrw === 0n && cost.confirmedMilliKrw !== null;
        const unresolved = slots.some((slot) => slot.status !== "rejected" || !settled(slot)) || related.some((cost) => {
          if (!slots.some((slot) => slot.id === cost.sourceSlotId)) return true;
          if (cost.entryKind === "LOOKUP_COST") return cost.status !== "resolved" || !settled(cost);
          if (cost.entryKind === "COST_CORRECTION") return !([...slots, ...related].some((source) => source.id === cost.sourceCostId && (source.id === cost.sourceSlotId || (source.entryKind === "LOOKUP_COST" && source.sourceSlotId === cost.sourceSlotId)))) || !((cost.status === "applied" && cost.costState === "applied") || (cost.status === "applied" && cost.costState === "summary_purged" && cost.costSummaryPurgedAt !== null));
          return true;
        });
        if (!["ready", "rejected"].includes(dispatch.reconciliationState) || unresolved) throw new OutboxTransitionError();
        const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
        if (changed !== 1) throw new OutboxTransitionError();
      }
      const code = skippedCode(reason);
      const saved = await new PrismaOutboxStore(tx).transition(rowId, claimToken, { status: "skipped", lastErrorCode: code, nextRetryAt: null });
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "sequence", "fromState", "toState", "code", "actorId", "occurredAt") VALUES (${id}, ${id}, 'preview', 'outbox_skipped', ${rowId}, ${dispatch?.id ?? null}, ${dispatch ? dispatch.auditSequence + 1 : null}, 'processing', 'skipped', ${code}, 'system', ${now})`;
      return saved;
    });
  }
  async markFailed(rowId: string, claimToken: string, errorCode: OutboxErrorCode, nextRetryAt: Date | null): Promise<OutboxRow> {
    checkRetry(errorCode, nextRetryAt);
    if (errorCode !== "provider_result_unknown") return this.transition(rowId, claimToken, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: { increment: 1 }, lastErrorCode: errorCode, nextRetryAt });
    if (!("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const transactional = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
    return transactional.$transaction(async (tx) => {
      if (typeof tx.$queryRaw !== "function" || typeof tx.$executeRaw !== "function") throw new OutboxInputError();
      const runtime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${rowId} FOR UPDATE`;
      if (runtime.length !== 1 || outbox.length !== 1) throw new OutboxTransitionError();
      const [dispatch] = await tx.$queryRaw<{ id: string; auditSequence: number }[]>`SELECT "id", "auditSequence" FROM "NotificationDispatch" WHERE "outboxId" = ${rowId} AND "reconciliationState" = 'in_flight' FOR UPDATE`;
      if (!dispatch) throw new OutboxTransitionError();
      const [slot] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' AND "status" = 'in_flight' FOR UPDATE`;
      if (!slot) throw new OutboxTransitionError();
      const at = new Date();
      const changedSlot = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'unknown', "costState" = 'reserved_unknown', "resultAt" = ${at} WHERE "id" = ${slot.id} AND "status" = 'in_flight'`;
      const changedDispatch = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState" = 'open_unknown', "unknownSince" = COALESCE("unknownSince", ${at}), "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "reconciliationState" = 'in_flight'`;
      if (changedSlot !== 1 || changedDispatch !== 1) throw new OutboxTransitionError();
      const row = await new PrismaOutboxStore(tx).transition(rowId, claimToken, { status: "failed", attemptCount: { increment: 1 }, lastErrorCode: errorCode, nextRetryAt: null });
      const eventId = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "code", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'result_unknown', ${rowId}, ${dispatch.id}, ${slot.id}, ${dispatch.auditSequence + 1}, 'provider_result_unknown', ${at})`;
      return row;
    });
  }
  async markDefiniteRejection(rowId: string, claimToken: string, dispatchId: string, slotId: string, nextRetryAt: Date | null, at: Date): Promise<OutboxRow> {
    checkRetry("provider_error", nextRetryAt);
    if (!("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const db = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
    return db.$transaction(async (tx) => {
      const runtime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const outbox = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationOutbox" WHERE "id" = ${rowId} AND "status" = 'processing' AND "claimToken" = ${claimToken} FOR UPDATE`;
      if (runtime.length !== 1 || outbox.length !== 1) throw new OutboxStaleClaimError();
      const [dispatch] = await tx.$queryRaw<{ auditSequence: number }[]>`SELECT "auditSequence" FROM "NotificationDispatch" WHERE "id" = ${dispatchId} AND "outboxId" = ${rowId} AND "reconciliationState" = 'in_flight' FOR UPDATE`;
      const [slot] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationCostReservation" WHERE "id" = ${slotId} AND "dispatchId" = ${dispatchId} AND "entryKind" = 'SEND_SLOT' AND "status" = 'in_flight' FOR UPDATE`;
      if (!dispatch || !slot) throw new OutboxTransitionError();
      const slotChanged = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'rejected', "resultAt" = ${at} WHERE "id" = ${slotId} AND "status" = 'in_flight'`;
      const dispatchChanged = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState" = 'rejected', "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatchId} AND "reconciliationState" = 'in_flight' AND "auditSequence" = ${dispatch.auditSequence}`;
      if (slotChanged !== 1 || dispatchChanged !== 1) throw new OutboxTransitionError();
      const saved = await new PrismaOutboxStore(tx).transition(rowId, claimToken, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: { increment: 1 }, lastErrorCode: "provider_error", nextRetryAt });
      const eventId = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "code", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'outbox_failed', ${rowId}, ${dispatchId}, ${slotId}, ${dispatch.auditSequence + 1}, 'provider_error', ${at})`;
      return saved;
    });
  }
  async markExpired(rowId: string, claimToken: string, at: Date): Promise<OutboxRow> {
    if (!("$transaction" in this.db) || typeof this.db.$transaction !== "function") throw new OutboxInputError();
    const db = this.db as unknown as { $transaction<T>(fn: (tx: OutboxAuditTx & { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> };
    return db.$transaction(async (tx) => {
      const runtime = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const [outbox] = await tx.$queryRaw<{ occurredAt: Date }[]>`SELECT "occurredAt" FROM "NotificationOutbox" WHERE "id" = ${rowId} AND "status" = 'processing' AND "claimToken" = ${claimToken} FOR UPDATE`;
      if (runtime.length !== 1 || !outbox || !Number.isFinite(at.getTime()) || at.getTime() < outbox.occurredAt.getTime() + 86_400_000) throw new OutboxTransitionError();
      const [dispatch] = await tx.$queryRaw<{ id: string; reconciliationState: string; auditSequence: number }[]>`SELECT "id", "reconciliationState", "auditSequence" FROM "NotificationDispatch" WHERE "outboxId" = ${rowId} FOR UPDATE`;
      if (dispatch) {
        // All writers lock runtime, outbox and dispatch before their reservation rows.
        // Lock slots first, then their linked lookups and corrections, matching reconciliation.
        type Cost = { id: string; entryKind: string; status: string; costState: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; adjustmentMilliKrw: bigint | null; costSummaryPurgedAt: Date | null; sourceSlotId: string | null; sourceCostId: string | null };
        const slots = await tx.$queryRaw<Cost[]>`SELECT "id", "entryKind", "status", "costState", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costSummaryPurgedAt", "sourceSlotId", "sourceCostId" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" = 'SEND_SLOT' ORDER BY "sequence" FOR UPDATE`;
        const related = await tx.$queryRaw<Cost[]>`SELECT "id", "entryKind", "status", "costState", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costSummaryPurgedAt", "sourceSlotId", "sourceCostId" FROM "NotificationCostReservation" WHERE "dispatchId" = ${dispatch.id} AND "entryKind" <> 'SEND_SLOT' ORDER BY "id" FOR UPDATE`;
        const settled = (cost: Cost) => cost.costState === "summary_purged"
          ? cost.costSummaryPurgedAt !== null && cost.reservedMilliKrw === null && cost.confirmedMilliKrw === null && cost.adjustmentMilliKrw === null
          : cost.costState === "settled" && cost.reservedMilliKrw === 0n && cost.confirmedMilliKrw !== null;
        const unresolved = slots.some((slot) => slot.status !== "rejected" || !settled(slot)) || related.some((cost) => {
          if (!slots.some((slot) => slot.id === cost.sourceSlotId)) return true;
          if (cost.entryKind === "LOOKUP_COST") return cost.status !== "resolved" || !settled(cost);
          if (cost.entryKind === "COST_CORRECTION") return !([...slots, ...related].some((source) => source.id === cost.sourceCostId && (source.id === cost.sourceSlotId || (source.entryKind === "LOOKUP_COST" && source.sourceSlotId === cost.sourceSlotId)))) || !((cost.status === "applied" && cost.costState === "applied") || (cost.status === "applied" && cost.costState === "summary_purged" && cost.costSummaryPurgedAt !== null));
          return true;
        });
        if (!["ready", "rejected"].includes(dispatch.reconciliationState) || unresolved) throw new OutboxTransitionError();
        const changed = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "auditSequence" = "auditSequence" + 1 WHERE "id" = ${dispatch.id} AND "auditSequence" = ${dispatch.auditSequence}`;
        if (changed !== 1) throw new OutboxTransitionError();
      }
      const saved = await new PrismaOutboxStore(tx).transition(rowId, claimToken, { status: "skipped", lastErrorCode: "event_expired", nextRetryAt: null });
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "sequence", "code", "occurredAt") VALUES (${id}, ${id}, 'preview', 'outbox_skipped', ${rowId}, ${dispatch?.id ?? null}, ${dispatch ? dispatch.auditSequence + 1 : null}, 'event_expired', ${at})`;
      return saved;
    });
  }
}
