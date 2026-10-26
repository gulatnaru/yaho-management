import { describe, expect, it, vi } from "vitest";
import { type NotificationProvider, type NotificationSendResult } from "@/lib/kakao/notify";
import {
  buildOutboxInput, LEASE_MS, OutboxStaleClaimError, OutboxTransitionError,
  type OutboxEnqueueInput, type OutboxRow, type OutboxStore,
} from "@/lib/kakao/outbox";
import { InMemoryOutboxStore, PrismaOutboxStore, type OutboxDbClient, type OutboxDbRow } from "@/lib/kakao/outbox-store";
import { BACKOFF, MAX_ATTEMPTS, processOutboxBatch, recoverStaleProcessing } from "@/lib/kakao/outbox-worker";

const now = new Date("2026-10-26T00:00:00Z");
const expiry = new Date(now.getTime() + LEASE_MS);
const expired = new Date(expiry.getTime() + 1);
function input(n = 1): OutboxEnqueueInput {
  return buildOutboxInput("application.received", `c${String(n).padStart(24, "0")}`, "created", "admin", new Date(now.getTime() + n));
}
type SendInput = Parameters<NotificationProvider["send"]>[0];
class RecordingProvider implements NotificationProvider {
  readonly calls: SendInput[] = [];
  constructor(private readonly behavior: (call: SendInput) => NotificationSendResult | Promise<NotificationSendResult> = () => ({ status: "sent" })) {}
  async send(call: SendInput): Promise<NotificationSendResult> {
    this.calls.push({ ...call });
    return this.behavior(call);
  }
}
const configured = (provider: NotificationProvider, clock = now, limit?: number) => ({ provider, isProviderConfigured: true, now: clock, limit });
async function stored(store: OutboxStore, n = 1): Promise<OutboxRow> {
  const row = await store.findByDedupeKey(input(n).dedupeKey);
  expect(row).not.toBeNull();
  return row!;
}

/** Pure synthetic delegate: synchronous conditional writes, no Prisma/DB import. */
function fakeDb() {
  const rows = new Map<string, OutboxDbRow>();
  const db: OutboxDbClient = { notificationOutbox: {
    create: vi.fn(async ({ data }) => {
      const row: OutboxDbRow = { ...data, id: `synthetic-${rows.size + 1}`, attemptCount: 0, lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, claimToken: null, leaseExpiresAt: null, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }) => {
      const row = "id" in where ? rows.get(where.id) : [...rows.values()].find((candidate) => candidate.dedupeKey === where.dedupeKey);
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where, take }) => [...rows.values()]
      .filter((row) => row.status === where.status && (where.status === "pending"
        ? row.nextRetryAt === null || row.nextRetryAt <= where.OR[1].nextRetryAt.lte
        : row.leaseExpiresAt !== null && row.leaseExpiresAt <= where.leaseExpiresAt.lte))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .slice(0, take).map((row) => ({ ...row }))),
    updateMany: vi.fn(async ({ where, data }) => {
      const row = rows.get(where.id);
      if (!row || row.status !== where.status) return { count: 0 };
      if (where.claimToken !== undefined && row.claimToken !== where.claimToken) return { count: 0 };
      if (where.OR && row.nextRetryAt !== null && row.nextRetryAt > where.OR[1].nextRetryAt.lte) return { count: 0 };
      if (where.leaseExpiresAt && (row.leaseExpiresAt === null || row.leaseExpiresAt > where.leaseExpiresAt.lte)) return { count: 0 };
      row.status = data.status;
      if (data.claimToken !== undefined) row.claimToken = data.claimToken;
      if (data.leaseExpiresAt !== undefined) row.leaseExpiresAt = data.leaseExpiresAt;
      if (data.nextRetryAt !== undefined) row.nextRetryAt = data.nextRetryAt;
      if (data.lastErrorCode !== undefined) row.lastErrorCode = data.lastErrorCode;
      if (data.attemptCount) row.attemptCount += data.attemptCount.increment;
      return { count: 1 };
    }),
  } };
  return { db, rows };
}

function fixture(kind: "memory" | "prisma"): { store: OutboxStore; seedMetadata: (id: string, metadata: Partial<OutboxRow>) => void } {
  if (kind === "prisma") {
    const { db, rows } = fakeDb();
    return { store: new PrismaOutboxStore(db), seedMetadata: (id, metadata) => Object.assign(rows.get(id)!, metadata) };
  }
  const store = new InMemoryOutboxStore();
  // Test-only access simulates historical missing leases/terminal metadata;
  // normal current claim paths always assign fresh tokens and lease timestamps.
  const rows = (store as unknown as { rows: Map<string, OutboxRow> }).rows;
  return { store, seedMetadata: (id, metadata) => Object.assign(rows.get(id)!, metadata) };
}

describe.each(["memory", "prisma"] as const)("processing lease contract: %s", (kind) => {
  it("normal claim sets a fresh token and lease; the worker completes with that token and clears both", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const claim = vi.spyOn(store, "claimDue");
    const mark = vi.spyOn(store, "markSent");
    const provider = new RecordingProvider();
    expect((await processOutboxBatch(store, configured(provider))).outcomes).toMatchObject([{ status: "sent" }]);
    const [claimed] = await claim.mock.results[0].value;
    expect(claimed).toMatchObject({ status: "processing", leaseExpiresAt: expiry });
    expect(claimed.claimToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(claimed.claimToken).not.toBe(claimed.id);
    expect(mark).toHaveBeenCalledWith(claimed.id, claimed.claimToken);
    expect(await stored(store)).toMatchObject({ status: "sent", claimToken: null, leaseExpiresAt: null });
    expect(provider.calls).toHaveLength(1);
  });

  it("a simulated crash becomes immediately due after lease expiry without consuming an attempt or sending", async () => {
    const { store } = fixture(kind);
    const first = (await store.enqueue(input())).row;
    await store.claimDue(1, now);
    const provider = new RecordingProvider();
    const rows = await recoverStaleProcessing(store, expired);
    expect(rows).toHaveLength(1);
    expect(await stored(store)).toMatchObject({ id: first.id, dedupeKey: first.dedupeKey, status: "pending", attemptCount: 0, claimToken: null, leaseExpiresAt: null, nextRetryAt: expired });
    expect(provider.calls).toHaveLength(0);
  });

  it("an expired recovered row can be re-claimed with a new token and processed to sent", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [first] = await store.claimDue(1, now);
    await recoverStaleProcessing(store, expired);
    const claim = vi.spyOn(store, "claimDue");
    const provider = new RecordingProvider();
    expect((await processOutboxBatch(store, configured(provider, expired))).outcomes).toMatchObject([{ status: "sent" }]);
    const [second] = await claim.mock.results[0].value;
    expect(second.claimToken).not.toBe(first.claimToken);
    expect(second.leaseExpiresAt).toEqual(new Date(expired.getTime() + LEASE_MS));
    expect(await stored(store)).toMatchObject({ status: "sent", claimToken: null, leaseExpiresAt: null });
    expect(provider.calls).toHaveLength(1);
  });

  it("refuses recovery of a valid lease and keeps the processing owner intact", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    expect(await recoverStaleProcessing(store, new Date(expiry.getTime() - 1))).toEqual([]);
    expect(await stored(store)).toEqual(claimed);
  });

  it("recovers at the exact lease expiry boundary", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    await store.claimDue(1, now);
    expect(await recoverStaleProcessing(store, expiry)).toHaveLength(1);
    expect(await stored(store)).toMatchObject({ status: "pending", nextRetryAt: expiry });
  });

  it("two racing sweeps recover each row at most once and racing workers send each recovered row once", async () => {
    const { store } = fixture(kind);
    for (let n = 1; n <= 4; n++) await store.enqueue(input(n));
    const claimed = await store.claimDue(4, now);
    expect(new Set(claimed.map((row) => row.claimToken)).size).toBe(4);
    const sweeps = await Promise.all([recoverStaleProcessing(store, expired), recoverStaleProcessing(store, expired)]);
    const recovered = sweeps.flat();
    expect(recovered).toHaveLength(4);
    expect(new Set(recovered.map((row) => row.id)).size).toBe(4);
    const provider = new RecordingProvider();
    const batches = await Promise.all([
      processOutboxBatch(store, configured(provider, expired, 2)),
      processOutboxBatch(store, configured(provider, expired, 4)),
    ]);
    expect(batches.flatMap((batch) => batch.outcomes)).toHaveLength(4);
    for (let n = 1; n <= 4; n++) {
      expect(provider.calls.filter((call) => call.dedupeKey === input(n).dedupeKey)).toHaveLength(1);
      expect(await stored(store, n)).toMatchObject({ status: "sent", attemptCount: 0 });
    }
  });

  it("rejects all stale completions after recovery and re-claim, preserving the new owner and retry budget", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [a] = await store.claimDue(1, now);
    await recoverStaleProcessing(store, expired);
    const [b] = await store.claimDue(1, expired);
    expect(b.claimToken).not.toBe(a.claimToken);
    await expect(store.markSent(a.id, a.claimToken!)).rejects.toBeInstanceOf(OutboxStaleClaimError);
    await expect(store.markFailed(a.id, a.claimToken!, "provider_error", null)).rejects.toBeInstanceOf(OutboxStaleClaimError);
    await expect(store.markSkipped(a.id, a.claimToken!, "provider_unconfigured")).rejects.toBeInstanceOf(OutboxStaleClaimError);
    expect(await stored(store)).toEqual(b);
    expect((await stored(store)).attemptCount).toBe(0);
  });

  it("recovery preserves attempt four so the next failure exhausts the fifth and final attempt", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const provider = new RecordingProvider(() => ({ status: "failed" }));
    let clock = now;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      await processOutboxBatch(store, configured(provider, clock));
      clock = new Date(clock.getTime() + BACKOFF[attempt - 1] * 60_000);
    }
    expect(await stored(store)).toMatchObject({ status: "pending", attemptCount: 4 });
    await store.claimDue(1, clock); // Interrupted attempt has not completed.
    clock = new Date(clock.getTime() + LEASE_MS + 1);
    await recoverStaleProcessing(store, clock);
    expect(await stored(store)).toMatchObject({ status: "pending", attemptCount: 4 });
    expect((await processOutboxBatch(store, configured(provider, clock))).outcomes).toMatchObject([{ status: "failed", rowStatus: "failed", attemptCount: 5, nextRetryAt: null }]);
    expect(await stored(store)).toMatchObject({ status: "failed", attemptCount: 5, claimToken: null, leaseExpiresAt: null });
    expect((await processOutboxBatch(store, configured(provider, new Date(clock.getTime() + LEASE_MS)))).outcomes).toEqual([]);
    expect(provider.calls).toHaveLength(5);
  });

  it("never recovers terminal sent, skipped, or failed rows with old or absent lease timestamps", async () => {
    const { store, seedMetadata } = fixture(kind);
    const snapshots: OutboxRow[] = [];
    for (let n = 1; n <= 3; n++) {
      await store.enqueue(input(n));
      const [claimed] = await store.claimDue(1, now);
      if (n === 1) await store.markSent(claimed.id, claimed.claimToken!);
      else if (n === 2) await store.markSkipped(claimed.id, claimed.claimToken!, "provider_unconfigured");
      else await store.markFailed(claimed.id, claimed.claimToken!, "provider_error", null);
      seedMetadata(claimed.id, { leaseExpiresAt: n === 2 ? null : now });
      snapshots.push(await stored(store, n));
    }
    expect(await recoverStaleProcessing(store, expired)).toEqual([]);
    expect(await Promise.all([stored(store), stored(store, 2), stored(store, 3)])).toEqual(snapshots);
  });

  it("unconfigured workers use their own tokens, make zero sends, and never backfill terminal skips", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const provider = new RecordingProvider();
    const claim = vi.spyOn(store, "claimDue");
    const mark = vi.spyOn(store, "markSkipped");
    expect((await processOutboxBatch(store, { provider, now })).outcomes).toMatchObject([{ status: "skipped", reason: "provider_unconfigured" }]);
    const [claimed] = await claim.mock.results[0].value;
    expect(mark).toHaveBeenCalledWith(claimed.id, claimed.claimToken, "provider_unconfigured");
    expect(await stored(store)).toMatchObject({ status: "skipped", claimToken: null, leaseExpiresAt: null, attemptCount: 0 });
    expect(await recoverStaleProcessing(store, expired)).toEqual([]);
    expect((await processOutboxBatch(store, configured(provider, expired))).outcomes).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it("defensively leaves processing rows with no lease timestamp untouched", async () => {
    const { store, seedMetadata } = fixture(kind);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    seedMetadata(claimed.id, { leaseExpiresAt: null });
    const before = await stored(store);
    expect(await recoverStaleProcessing(store, expired)).toEqual([]);
    expect(await stored(store)).toEqual(before);
  });

  it("reports invalid status before stale ownership when a recovered claim has not been re-claimed", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    await recoverStaleProcessing(store, expired);
    await expect(store.markSent(claimed.id, claimed.claimToken!)).rejects.toBeInstanceOf(OutboxTransitionError);
    await expect(store.markFailed(claimed.id, claimed.claimToken!, "provider_error", null)).rejects.toBeInstanceOf(OutboxTransitionError);
    await expect(store.markSkipped(claimed.id, claimed.claimToken!)).rejects.toBeInstanceOf(OutboxTransitionError);
  });

  it("clears the lease on retry and creates a new token on the next claim", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [first] = await store.claimDue(1, now);
    const retryAt = new Date(now.getTime() + 60_000);
    expect(await store.markFailed(first.id, first.claimToken!, "provider_error", retryAt)).toMatchObject({ status: "pending", attemptCount: 1, claimToken: null, leaseExpiresAt: null });
    const [second] = await store.claimDue(1, retryAt);
    expect(second.claimToken).not.toBe(first.claimToken);
    expect(second.leaseExpiresAt).toEqual(new Date(retryAt.getTime() + LEASE_MS));
  });

  it("limits recovery without touching the remaining expired processing rows", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input(2)); await store.enqueue(input());
    await store.claimDue(2, now);
    expect((await recoverStaleProcessing(store, expired, 1)).map((row) => row.dedupeKey)).toEqual([input().dedupeKey]);
    expect(await stored(store, 2)).toMatchObject({ status: "processing" });
    expect(await recoverStaleProcessing(store, expired, 1)).toHaveLength(1);
  });

  it("process batches never automatically sweep expired processing rows", async () => {
    const { store } = fixture(kind);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    const sweep = vi.spyOn(store, "recoverStale");
    const provider = new RecordingProvider();
    expect((await processOutboxBatch(store, configured(provider, expired))).outcomes).toEqual([]);
    expect(sweep).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
    expect(await stored(store)).toEqual(claimed);
  });
});

describe("stale worker completion outcomes", () => {
  it.each(["sent", "failed", "skipped"] as const)("contains an actual stale %s completion without state changes or retry and continues the batch", async (status) => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await store.enqueue(input()); await store.enqueue(input(2));
    let newClaim: OutboxRow | undefined;
    const provider = new RecordingProvider(async (call) => {
      if (call.dedupeKey === input().dedupeKey) {
        // Worker A's provider call is in flight while recovery + worker B claim.
        await recoverStaleProcessing(store, expired, 1);
        [newClaim] = await store.claimDue(1, expired);
        return { status };
      }
      return { status: "sent" };
    });
    const batch = await processOutboxBatch(store, configured(provider));
    expect(batch.outcomes.map((outcome) => outcome.status)).toEqual(["stale", "sent"]);
    expect(batch.outcomes[0]).toEqual({ rowId: newClaim!.id, status: "stale", reason: "stale_claim" });
    expect(await stored(store)).toEqual(newClaim);
    expect((await stored(store)).attemptCount).toBe(0);
    expect(await stored(store, 2)).toMatchObject({ status: "sent" });
    expect(provider.calls.filter((call) => call.dedupeKey === input().dedupeKey)).toHaveLength(1);
  });
});

describe("Prisma conditional write race fencing without a DB", () => {
  it.each(["sent", "skipped", "failed"] as const)("rejects a %s completion losing ownership between the read and conditional write", async (status) => {
    const { db, rows } = fakeDb();
    const store: OutboxStore = new PrismaOutboxStore(db);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    vi.mocked(db.notificationOutbox.updateMany).mockImplementationOnce(async () => {
      Object.assign(rows.get(claimed.id)!, { claimToken: "synthetic-new-owner", leaseExpiresAt: new Date(expired.getTime() + LEASE_MS) });
      return { count: 0 };
    });
    const completion = status === "sent" ? store.markSent(claimed.id, claimed.claimToken!)
      : status === "skipped" ? store.markSkipped(claimed.id, claimed.claimToken!)
        : store.markFailed(claimed.id, claimed.claimToken!, "provider_error", null);
    await expect(completion).rejects.toBeInstanceOf(OutboxStaleClaimError);
    expect(db.notificationOutbox.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: claimed.id, status: "processing", claimToken: claimed.claimToken } }));
    expect(await stored(store)).toMatchObject({ status: "processing", claimToken: "synthetic-new-owner", attemptCount: 0 });
  });

  it("rechecks lease expiry in the recovery write after a candidate is replaced by a valid new claim", async () => {
    const { db, rows } = fakeDb();
    const store: OutboxStore = new PrismaOutboxStore(db);
    await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    const findMany = vi.mocked(db.notificationOutbox.findMany).getMockImplementation()!;
    vi.mocked(db.notificationOutbox.findMany).mockImplementationOnce(async (args) => {
      const candidates = await findMany(args);
      Object.assign(rows.get(claimed.id)!, { claimToken: "synthetic-new-owner", leaseExpiresAt: new Date(expired.getTime() + LEASE_MS) });
      return candidates;
    });
    expect(await recoverStaleProcessing(store, expired)).toEqual([]);
    expect(db.notificationOutbox.updateMany).toHaveBeenLastCalledWith({ where: { id: claimed.id, status: "processing", leaseExpiresAt: { lte: expired } }, data: { status: "pending", claimToken: null, leaseExpiresAt: null, nextRetryAt: expired } });
    expect(await stored(store)).toMatchObject({ status: "processing", claimToken: "synthetic-new-owner", attemptCount: 0 });
  });
});
