import { describe, expect, it, vi } from "vitest";
import { type NotificationProvider, type NotificationSendResult } from "@/lib/kakao/notify";
import {
  buildOutboxInput, enqueueOutboxEvent, OutboxInputError, OutboxTransitionError,
  type OutboxEnqueueInput, type OutboxRow, type OutboxStore,
} from "@/lib/kakao/outbox";
import { InMemoryOutboxStore, PrismaOutboxStore, type OutboxDbClient, type OutboxDbRow } from "@/lib/kakao/outbox-store";
import { BACKOFF, processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { createP5Fixture, p5At } from "./p5-fixture";

const now = new Date("2026-10-26T00:00:00Z");
function input(n = 1): OutboxEnqueueInput {
  return buildOutboxInput("application.received", `c${String(n).padStart(24, "0")}`, "created", "admin", new Date(now.getTime() + n));
}
type SendInput = Parameters<NotificationProvider["send"]>[0];
class RecordingProvider implements NotificationProvider {
  readonly calls: SendInput[] = [];
  constructor(private readonly behavior: (call: SendInput, attempt: number) => NotificationSendResult | Error = () => ({ status: "sent" })) {}
  async send(call: SendInput): Promise<NotificationSendResult> {
    this.calls.push({ ...call });
    const attempt = this.calls.filter((item) => item.dedupeKey === call.dedupeKey).length;
    const result = this.behavior(call, attempt);
    if (result instanceof Error) throw result;
    return result;
  }
}
async function stored(store: OutboxStore, n = 1): Promise<OutboxRow> {
  const row = await store.findByDedupeKey(input(n).dedupeKey);
  expect(row).not.toBeNull();
  return row!;
}
const configured = (provider: NotificationProvider, clock = now, limit?: number) => ({ provider, isProviderConfigured: true, now: clock, limit });

describe("outbox minimal data and uniqueness", () => {
  it("returns the existing globally unique row without changing the first event", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    const first = await store.enqueue(input());
    const second = await store.enqueue({ ...input(), occurredAt: new Date("2026-10-27T00:00:00Z") });
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, row: first.row });
    expect(await store.claimDue(10, now)).toHaveLength(1);
  });

  it.each(["name", "phone", "amount", "token", "url", "financialDetails", "title", "body"])("rejects extra %s instead of persisting a payload", async (field) => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await expect(store.enqueue({ ...input(), [field]: "synthetic-private-probe" })).rejects.toBeInstanceOf(OutboxInputError);
    expect(await store.findByDedupeKey(input().dedupeKey)).toBeNull();
  });

  it.each([
    { eventKind: "invented.event" }, { audience: "everybody" },
    { entityId: "https://synthetic.invalid/private" }, { entityId: "01000000000" },
    { entityId: "chttps://synthetic.invalid/private" }, { entityId: "contact@synthetic.invalid" },
    { dedupeKey: "raw-private-key" }, { occurredAt: new Date("invalid") },
  ])("validates kind/audience/internal identity/key/time using Zod: %s", async (invalid) => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await expect(store.enqueue({ ...input(), ...invalid } as OutboxEnqueueInput)).rejects.toBeInstanceOf(OutboxInputError);
  });

  it("accepts the existing group-core phase8_UUID submission identity without contract changes", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    const existingContract = buildOutboxInput("application.received", "phase8_00000000-0000-4000-8000-000000000001", "created", "admin", now);
    expect((await store.enqueue(existingContract)).row.entityId).toBe(existingContract.entityId);
  });

  it("returns snapshots so callers cannot mutate persisted status or dates", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    const { row } = await store.enqueue(input());
    row.status = "sent";
    row.occurredAt.setFullYear(2000);
    expect((await stored(store)).status).toBe("pending");
    expect((await stored(store)).occurredAt).toEqual(input().occurredAt);
    const claimed = await store.claimDue(1, now);
    claimed[0].status = "failed";
    expect((await stored(store)).status).toBe("processing");
  });

  it("best-effort enqueue contains store errors without reflecting private details", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    vi.spyOn(store, "enqueue").mockRejectedValue(new Error("synthetic-private-probe"));
    await expect(enqueueOutboxEvent(store, input())).resolves.toEqual({ status: "failed", reason: "outbox_enqueue_failed" });
  });

  it("best-effort enqueue reports creation, duplicates and invalid input without throwing", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    expect(await enqueueOutboxEvent(store, input())).toMatchObject({ status: "enqueued", created: true });
    expect(await enqueueOutboxEvent(store, input())).toMatchObject({ status: "enqueued", created: false });
    expect(await enqueueOutboxEvent(store, { ...input(), audience: "invalid" } as unknown as OutboxEnqueueInput)).toEqual({ status: "failed", reason: "outbox_enqueue_failed" });
  });
});

describe("outbox worker claims and transitions", () => {
  it("two overlapping workers partition rows with exactly one send call per row", async () => {
    const { store, safe, repository } = await createP5Fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    for (let n = 1; n <= 5; n++) await store.enqueue(buildOutboxInput("application.received", `c${String(n).padStart(24, "0")}`, "created", "admin", p5At));
    const send = vi.spyOn(MockProvider.prototype, "send");
    const results = await Promise.all([
      processOutboxBatch(store, { provider: null, now: p5At, limit: 3, safe }),
      processOutboxBatch(store, { provider: null, now: p5At, limit: 6, safe }),
    ]);
    const all = results.flatMap((result) => result.outcomes);
    expect(results[0].outcomes).toHaveLength(3);
    expect(results[1].outcomes).toHaveLength(3);
    expect(new Set(all.map((row) => row.rowId)).size).toBe(6);
    expect(all.every((row) => row.status === "sent" && row.rowStatus === "sent")).toBe(true);
    expect(send).toHaveBeenCalledTimes(6);
    expect((await repository.snapshot()).slots).toHaveLength(6);
    send.mockRestore();
  });

  it("claims by occurredAt up to the limit and never claims a terminal row", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await store.enqueue(input(3)); await store.enqueue(input(1)); await store.enqueue(input(2));
    const first = await store.claimDue(1, now);
    expect(first.map((row) => row.entityId)).toEqual([input(1).entityId]);
    await store.markSkipped(first[0].id, first[0].claimToken!, "send_disabled");
    const rest = await store.claimDue(10, now);
    expect(rest.map((row) => row.entityId)).toEqual([input(2).entityId, input(3).entityId]);
  });

  it.each(["markSent", "markSkipped", "markFailed"] as const)("rejects %s on pending and terminal rows with a typed error", async (method) => {
    const store: OutboxStore = new InMemoryOutboxStore();
    const { row } = await store.enqueue(input());
    const transition = () => method === "markFailed" ? store.markFailed(row.id, "unclaimed", "provider_error", null) : store[method](row.id, "unclaimed");
    await expect(transition()).rejects.toBeInstanceOf(OutboxTransitionError);
    const [claimed] = await store.claimDue(1, now);
    await store.markSkipped(row.id, claimed.claimToken!, "send_disabled");
    await expect(transition()).rejects.toBeInstanceOf(OutboxTransitionError);
    expect(await store.claimDue(10, now)).toEqual([]);
  });

  it("does not resend an already-sent row on duplicate execution", async () => {
    const { store, safe } = await createP5Fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    const send = vi.spyOn(MockProvider.prototype, "send");
    expect((await processOutboxBatch(store, { provider: null, now: p5At, safe })).outcomes[0].status).toBe("sent");
    expect((await processOutboxBatch(store, { provider: null, now: p5At, safe })).outcomes).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1); send.mockRestore();
  });

  it("rejects missing, malformed or unpermitted provider references", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    const { row } = await store.enqueue(input());
    const [claimed] = await store.claimDue(1, now);
    await expect(store.markSent(row.id, claimed.claimToken!, "synthetic-reference")).rejects.toBeInstanceOf(OutboxInputError);
    await expect(store.markSent(row.id, claimed.claimToken!)).rejects.toBeInstanceOf(OutboxInputError);
    await expect(store.markSent(row.id, claimed.claimToken!, `g2ref_${"a".repeat(32)}`)).rejects.toBeInstanceOf(OutboxTransitionError);
    expect(await stored(store)).toMatchObject({ status: "processing", providerId: null, providerRef: null });
  });
});

describe("outbox retry and isolated failures", () => {
  it("retries a definite rejection at the first backoff, then succeeds", async () => {
    const { store, safe, input: event } = await createP5Fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    const retryAt = new Date(p5At.getTime() + BACKOFF[0] * 60_000);
    const first = await processOutboxBatch(store, { provider: null, now: p5At, safe });
    expect(first.outcomes[0]).toMatchObject({ status: "failed", rowStatus: "pending", attemptCount: 1, nextRetryAt: retryAt, reason: "provider_error" });
    expect(await store.findByDedupeKey(event.dedupeKey)).toMatchObject({ status: "pending", attemptCount: 1, lastErrorCode: "provider_error", nextRetryAt: retryAt });
    expect((await processOutboxBatch(store, { provider: null, now: new Date(retryAt.getTime() - 1), safe })).outcomes).toEqual([]);
    const secondAt = new Date(retryAt.getTime() + 1);
    const second = await processOutboxBatch(store, { provider: null, now: secondAt, safe: { ...safe, clock: () => secondAt, provider: new MockProvider({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` }) } });
    expect(second.outcomes[0]).toMatchObject({ status: "sent", rowStatus: "sent" });
    expect(await store.findByDedupeKey(event.dedupeKey)).toMatchObject({ status: "sent", attemptCount: 1, lastErrorCode: null, nextRetryAt: null });
  });

  it("a thrown provider result is terminal unknown and cannot be retried", async () => {
    const { store, safe, input: event } = await createP5Fixture({ code: "S_THROW" });
    const result = await processOutboxBatch(store, { provider: null, now: p5At, safe });
    expect(result.outcomes[0]).toMatchObject({ status: "failed", rowStatus: "failed", nextRetryAt: null });
    const row = (await store.findByDedupeKey(event.dedupeKey))!;
    expect(row).toMatchObject({ status: "failed", attemptCount: 1, nextRetryAt: null, lastErrorCode: "provider_result_unknown" });
    await expect(store.markSent(row.id, "old-claim")).rejects.toBeInstanceOf(OutboxTransitionError);
    expect((await processOutboxBatch(store, { provider: null, now: new Date("2027-01-01T00:00:00Z"), safe })).outcomes).toEqual([]);
  });

  it("a provider row failure does not throw or prevent another row succeeding", async () => {
    const { store, safe } = await createP5Fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    const second = buildOutboxInput("application.received", `c${"4".repeat(24)}`, "created", "admin", p5At); await store.enqueue(second);
    const spy = vi.spyOn(MockProvider.prototype, "send").mockRejectedValueOnce(new Error("synthetic-private-probe"));
    const result = await processOutboxBatch(store, { provider: null, now: p5At, safe });
    expect(result.outcomes.map((row) => row.status)).toEqual(["failed", "sent"]);
    expect(await store.findByDedupeKey(second.dedupeKey)).toMatchObject({ status: "sent" });
    spy.mockRestore();
  });

  it.each([new OutboxTransitionError(), new Error("synthetic-private-probe")])("contains a row transition/store error and continues the batch: %s", async (error) => {
    const { store, safe } = await createP5Fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    await store.enqueue(buildOutboxInput("application.received", `c${"4".repeat(24)}`, "created", "admin", p5At));
    vi.spyOn(store, "markSent").mockRejectedValueOnce(error);
    const result = await processOutboxBatch(store, { provider: null, now: p5At, safe });
    expect(result.outcomes.map((row) => row.status)).toEqual(["failed", "sent"]);
    expect(result.outcomes[0]).toMatchObject({ reason: "provider_error", nextRetryAt: null });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-probe");
  });

  it("contains a failed claim without sending or exposing the error", async () => {
    const { store, safe } = await createP5Fixture({ code: "S_UNKNOWN" });
    vi.spyOn(store, "claimDue").mockRejectedValue(new Error("synthetic-private-probe"));
    const provider = new RecordingProvider();
    expect(await processOutboxBatch(store, { provider, now: p5At, safe })).toEqual({ outcomes: [], error: "claim_failed" });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("outbox provider gate and terminal skips", () => {
  it.each(["default", "false", "null"] as const)("unconfigured %s guard makes zero send calls and leaves rows unclaimed", async (mode) => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await store.enqueue(input()); await store.enqueue(input(2));
    const provider = new RecordingProvider();
    const options = mode === "default" ? { provider, now } : { provider: mode === "null" ? null : provider, now, isProviderConfigured: mode === "null" };
    const result = await processOutboxBatch(store, options);
    expect(result).toEqual({ outcomes: [], error: "guard_unavailable" });
    expect(await stored(store)).toMatchObject({ status: "pending", attemptCount: 0, lastErrorCode: null });
    expect(await processOutboxBatch(store, configured(provider))).toEqual({ outcomes: [], error: "guard_unavailable" });
    await expect(store.markSent((await stored(store)).id, "old-claim")).rejects.toBeInstanceOf(OutboxTransitionError);
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a legacy provider without storing its arbitrary reason", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await store.enqueue(input()); await store.enqueue(input(2));
    const provider = new RecordingProvider((call) => call.dedupeKey === input().dedupeKey ? { status: "skipped", reason: "synthetic-private-probe" } : { status: "sent" });
    const result = await processOutboxBatch(store, configured(provider));
    expect(result).toEqual({ outcomes: [], error: "guard_unavailable" });
    expect(await stored(store)).toMatchObject({ status: "pending", attemptCount: 0, lastErrorCode: null });
    expect(provider.calls).toHaveLength(0);
    expect(JSON.stringify({ result, row: await stored(store) })).not.toContain("synthetic-private-probe");
  });

  it("rejects legacy payload delivery and retains minimal outbox bookkeeping", async () => {
    const store: OutboxStore = new InMemoryOutboxStore();
    await store.enqueue(input());
    const provider = new RecordingProvider();
    await processOutboxBatch(store, configured(provider));
    expect(provider.calls).toEqual([]);
    expect(Object.keys(await stored(store)).sort()).toEqual(["id", "eventKind", "entityId", "dedupeKey", "audience", "occurredAt", "status", "attemptCount", "lastErrorCode", "providerId", "providerRef", "nextRetryAt", "claimToken", "leaseExpiresAt", "createdAt", "updatedAt"].sort());
  });
});

/** A synthetic narrow delegate only: never instantiates Prisma or opens a DB. */
function fakeDb(seed: OutboxRow): { db: OutboxDbClient; row: OutboxDbRow } {
  const row: OutboxDbRow = { ...seed };
  const db: OutboxDbClient = { notificationOutbox: {
    create: vi.fn(async () => { throw { code: "P2002" }; }),
    findUnique: vi.fn(async () => ({ ...row })),
    findMany: vi.fn(async () => [{ ...row }]),
    updateMany: vi.fn(async ({ where, data }: Parameters<OutboxDbClient["notificationOutbox"]["updateMany"]>[0]) => {
      if (where.id !== row.id || where.status !== row.status) return { count: 0 };
      if (where.claimToken !== undefined && where.claimToken !== row.claimToken) return { count: 0 };
      if (where.leaseExpiresAt && (row.leaseExpiresAt === null || row.leaseExpiresAt > where.leaseExpiresAt.lte)) return { count: 0 };
      if (where.OR && row.nextRetryAt !== null && row.nextRetryAt > where.OR[1].nextRetryAt.lte) return { count: 0 };
      row.status = data.status;
      if (data.attemptCount) row.attemptCount += data.attemptCount.increment;
      if (data.lastErrorCode !== undefined) row.lastErrorCode = data.lastErrorCode;
      if (data.nextRetryAt !== undefined) row.nextRetryAt = data.nextRetryAt;
      if (data.claimToken !== undefined) row.claimToken = data.claimToken;
      if (data.leaseExpiresAt !== undefined) row.leaseExpiresAt = data.leaseExpiresAt;
      return { count: 1 };
    }),
  } };
  return { db, row };
}

describe("Prisma adapter through the OutboxStore seam without a DB", () => {
  it("P2002 returns the existing row without a second insert", async () => {
    const memory: OutboxStore = new InMemoryOutboxStore();
    const first = await memory.enqueue(input());
    const { db } = fakeDb(first.row);
    const store: OutboxStore = new PrismaOutboxStore(db);
    expect(await store.enqueue(input())).toEqual({ created: false, row: first.row });
    expect(db.notificationOutbox.create).toHaveBeenCalledTimes(1);
    expect(db.notificationOutbox.findUnique).toHaveBeenCalledWith({ where: { dedupeKey: input().dedupeKey } });
  });

  it("two workers with overlapping stale candidates win the conditional claim only once", async () => {
    const memory: OutboxStore = new InMemoryOutboxStore();
    const { db } = fakeDb((await memory.enqueue(input())).row);
    const store: OutboxStore = new PrismaOutboxStore(db);
    const results = await Promise.all([store.claimDue(1, now), store.claimDue(1, now)]);
    expect(results.flat()).toHaveLength(1);
    expect(await store.findByDedupeKey(input().dedupeKey)).toMatchObject({ status: "processing", claimToken: expect.any(String) });
  });

  it("rechecks due at claim so a stale candidate cannot bypass a new backoff", async () => {
    const memory: OutboxStore = new InMemoryOutboxStore();
    const seed = (await memory.enqueue(input())).row;
    const { db, row } = fakeDb(seed);
    vi.mocked(db.notificationOutbox.findMany).mockImplementation(async () => {
      const stale = { ...row };
      row.nextRetryAt = new Date(now.getTime() + 60_000);
      return [stale];
    });
    const store: OutboxStore = new PrismaOutboxStore(db);
    expect(await store.claimDue(1, now)).toEqual([]);
    expect(row.status).toBe("pending");
  });

  it("enforces processing-only terminal transitions and increments failure count atomically", async () => {
    const memory: OutboxStore = new InMemoryOutboxStore();
    const seed = (await memory.enqueue(input())).row;
    const { db } = fakeDb(seed);
    const store: OutboxStore = new PrismaOutboxStore(db);
    await expect(store.markSent(seed.id, "unclaimed")).rejects.toBeInstanceOf(OutboxTransitionError);
    const [claimed] = await store.claimDue(1, now);
    const retryAt = new Date(now.getTime() + 60_000);
    expect(await store.markFailed(seed.id, claimed.claimToken!, "provider_error", retryAt)).toMatchObject({ status: "pending", attemptCount: 1, nextRetryAt: retryAt });
    expect(db.notificationOutbox.updateMany).toHaveBeenLastCalledWith({ where: { id: seed.id, status: "processing", claimToken: claimed.claimToken }, data: { status: "pending", attemptCount: { increment: 1 }, lastErrorCode: "provider_error", nextRetryAt: retryAt, claimToken: null, leaseExpiresAt: null } });
  });
});
