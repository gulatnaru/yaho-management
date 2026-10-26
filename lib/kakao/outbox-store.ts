import { randomUUID } from "node:crypto";
import {
  LEASE_MS, OutboxInputError, OutboxStaleClaimError, OutboxTransitionError, parseOutboxInput,
  type OutboxEnqueueInput, type OutboxRow, type OutboxStatus, type OutboxStore,
} from "@/lib/kakao/outbox";

function clone(row: OutboxRow): OutboxRow {
  return { ...row, occurredAt: new Date(row.occurredAt), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), nextRetryAt: row.nextRetryAt === null ? null : new Date(row.nextRetryAt), leaseExpiresAt: row.leaseExpiresAt === null ? null : new Date(row.leaseExpiresAt) };
}
function checkClaim(limit: number, now: Date): void {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(now.getTime())) throw new OutboxInputError();
}
function checkRetry(errorCode: "provider_error", nextRetryAt: Date | null): void {
  if (errorCode !== "provider_error" || (nextRetryAt !== null && !Number.isFinite(nextRetryAt.getTime()))) throw new OutboxInputError();
}
// Arbitrary provider reasons may contain PII. Never persist them.
function skippedCode(reason?: string): "provider_unconfigured" | null {
  return reason === "provider_unconfigured" ? reason : null;
}

/** Reference semantics: check-and-set happens synchronously before any await. */
export class InMemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxRow>();
  private readonly keys = new Map<string, string>();

  async enqueue(input: OutboxEnqueueInput): Promise<{ created: boolean; row: OutboxRow }> {
    const data = parseOutboxInput(input);
    const existing = this.keys.get(data.dedupeKey);
    if (existing !== undefined) return { created: false, row: clone(this.rows.get(existing)!) };
    const now = new Date();
    // Synthetic identity only; persistence uses Prisma's cuid() default.
    const row: OutboxRow = { ...data, id: randomUUID(), status: "pending", attemptCount: 0, lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, createdAt: now, updatedAt: now };
    this.rows.set(row.id, clone(row));
    this.keys.set(row.dedupeKey, row.id);
    return { created: true, row: clone(row) };
  }

  async findByDedupeKey(dedupeKey: string): Promise<OutboxRow | null> {
    const id = this.keys.get(dedupeKey);
    return id === undefined ? null : clone(this.rows.get(id)!);
  }

  async claimDue(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    const due = [...this.rows.values()]
      .filter((row) => row.status === "pending" && (row.nextRetryAt === null || row.nextRetryAt <= now))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, limit);
    return due.map((row) => {
      // Atomic per-row pending -> processing; terminal rows are never candidates.
      row.status = "processing";
      row.claimToken = randomUUID();
      row.leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      row.updatedAt = new Date(now);
      return clone(row);
    });
  }

  async recoverStale(limit: number, now: Date): Promise<OutboxRow[]> {
    checkClaim(limit, now);
    // A missing lease cannot prove expiry; current claim paths always set one.
    const expired = [...this.rows.values()]
      .filter((row) => row.status === "processing" && row.leaseExpiresAt !== null && row.leaseExpiresAt <= now)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, limit);
    return expired.map((row) => {
      // Synchronous check-and-set: no await between candidate check and write.
      Object.assign(row, { status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: new Date(now), updatedAt: new Date(now) });
      return clone(row);
    });
  }

  private processing(rowId: string, claimToken: string): OutboxRow {
    const row = this.rows.get(rowId);
    if (!row || row.status !== "processing") throw new OutboxTransitionError();
    if (row.claimToken !== claimToken) throw new OutboxStaleClaimError();
    return row;
  }

  async markSent(rowId: string, claimToken: string, providerRef?: string): Promise<OutboxRow> {
    const row = this.processing(rowId, claimToken);
    if (providerRef !== undefined) throw new OutboxInputError(); // reserved; null this phase
    Object.assign(row, { status: "sent", lastErrorCode: null, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: new Date() });
    return clone(row);
  }

  async markSkipped(rowId: string, claimToken: string, reason?: string): Promise<OutboxRow> {
    const row = this.processing(rowId, claimToken);
    Object.assign(row, { status: "skipped", lastErrorCode: skippedCode(reason), nextRetryAt: null, claimToken: null, leaseExpiresAt: null, updatedAt: new Date() });
    return clone(row);
  }

  async markFailed(rowId: string, claimToken: string, errorCode: "provider_error", nextRetryAt: Date | null): Promise<OutboxRow> {
    const row = this.processing(rowId, claimToken);
    checkRetry(errorCode, nextRetryAt);
    Object.assign(row, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: row.attemptCount + 1, lastErrorCode: errorCode, nextRetryAt: nextRetryAt === null ? null : new Date(nextRetryAt), claimToken: null, leaseExpiresAt: null, updatedAt: new Date() });
    return clone(row);
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
  lastErrorCode?: "provider_unconfigured" | "provider_error" | null;
  nextRetryAt?: Date | null;
  claimToken?: string | null;
  leaseExpiresAt?: Date | null;
};
type DueFilter = { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: Date } }] };
type ExpiredFilter = { leaseExpiresAt: { lte: Date } };
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
  if (row.lastErrorCode !== null && row.lastErrorCode !== "provider_unconfigured" && row.lastErrorCode !== "provider_error") throw new OutboxInputError();
  return clone({ ...row, ...input, lastErrorCode: row.lastErrorCode });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly db: OutboxDbClient) {}

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
      const result = await this.db.notificationOutbox.updateMany({ where: { id: row.id, status: "processing", leaseExpiresAt: { lte: now } }, data: { status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: now } });
      if (result.count === 1) recovered.push({ ...row, status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: new Date(now) });
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
    return this.transition(rowId, claimToken, { status: "sent", lastErrorCode: null, nextRetryAt: null }, () => {
      if (providerRef !== undefined) throw new OutboxInputError();
    });
  }
  async markSkipped(rowId: string, claimToken: string, reason?: string): Promise<OutboxRow> {
    return this.transition(rowId, claimToken, { status: "skipped", lastErrorCode: skippedCode(reason), nextRetryAt: null });
  }
  async markFailed(rowId: string, claimToken: string, errorCode: "provider_error", nextRetryAt: Date | null): Promise<OutboxRow> {
    return this.transition(rowId, claimToken, { status: nextRetryAt === null ? "failed" : "pending", attemptCount: { increment: 1 }, lastErrorCode: errorCode, nextRetryAt }, () => checkRetry(errorCode, nextRetryAt));
  }
}
