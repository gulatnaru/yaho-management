import { describe, expect, it, vi } from "vitest";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { MockLookupProvider } from "@/lib/kakao/providers/mock-lookup";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore, PrismaOutboxStore, type OutboxDbClient } from "@/lib/kakao/outbox-store";
import { processOutboxBatch, recoverStaleProcessing } from "@/lib/kakao/outbox-worker";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { prepareSyntheticDispatch } from "@/server/kakao/dispatch-prepare";
import { pollDeliveryResult } from "@/server/kakao/reconcile";
import { recordLateResult } from "@/server/kakao/late-result";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";

const at = new Date("2026-10-28T00:00:00Z");
const key = Buffer.alloc(32, 7);
async function fixture(mock: unknown, beforeCommit?: (state: CoreState) => void) {
  const state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
  const repository = new InMemoryDispatchRepository(state, beforeCommit);
  const store = new InMemoryOutboxStore(repository);
  const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
  await store.enqueue(input);
  const evidence = { id: "mock_ownership_v1" as const, method: "synthetic_call" as const, synthetic: true as const, success: true as const, registrationId: "r1", version: "v1", verifiedAt: at, verifierId: "u1" };
  const ciphertext = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), key, 1n, { environment: "preview", registrationId: "r1", registrationVersion: "v1", keyVersion: "k1" }, { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true });
  const user = { id: "u1", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
  const registration = { environment: "preview", service: "application.received", id: "r1", version: "v1", userId: "u1", purposeVersion: "p1", policyVersion: "p1", state: "active", ciphertext: { ...ciphertext, keyVersion: "k1", synthetic: true }, evidence };
  await repository.transaction(async (s) => {
    s.users = [user]; s.ownershipEvidence = [evidence]; s.nonceHighWaters = { k1: 1n };
    s.recipients.push({ id: "r1", version: "v1", userId: "u1", registration, target: user });
    s.runtime = { environment: "preview", provider: "solapi", namespace: "preview_g2", blocked: false, activationEpoch: at, revision: 1, keyVersion: "k1", nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true };
  });
  const safe = { repository, provider: new MockProvider(mock), clock: () => at, prepare: async (row: import("@/lib/kakao/outbox").OutboxRow) => {
    const fixed = await prepareSyntheticDispatch(repository, { rowId: row.id, claimToken: row.claimToken!, submission: { id: input.entityId, submittedAt: at, personalDataPurgedAt: null } });
    if (!fixed) throw new Error("Synthetic dispatch unavailable.");
    return { ...fixed, syntheticKey: { key, keyVersion: "k1", synthetic: true as const }, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const };
  } };
  return { store, repository, input, safe };
}

describe("P5 synthetic worker", () => {
  it.each(["dry-run", "off"] as const)("terminally skips explicit %s without issuing a slot", async (kind) => {
    const { store, repository, input, safe } = await fixture({ code: "S_UNKNOWN" });
    const prepare = safe.prepare;
    const disabled = { ...safe, prepare: async (row: import("@/lib/kakao/outbox").OutboxRow) => {
      const value = await prepare(row);
      return { ...value, config: { ...value.config, mode: kind === "dry-run" ? "dry-run" : "live", enabled: kind !== "off" } };
    } };
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const [a, b] = await Promise.all([processOutboxBatch(store, { provider: null, now: at, safe: disabled }), processOutboxBatch(store, { provider: null, now: at, safe: disabled })]);
      expect([...a.outcomes, ...b.outcomes]).toMatchObject([{ status: "skipped", rowStatus: "skipped", attemptCount: 0 }]);
      const row = await store.findByDedupeKey(input.dedupeKey);
      expect(row).toMatchObject({ status: "skipped", lastErrorCode: "send_disabled", attemptCount: 0, claimToken: null, leaseExpiresAt: null });
      const state = await repository.snapshot();
      expect(state.slots).toHaveLength(0); expect(state.monthlyAdditionalCosts).toEqual({}); expect(spy).not.toHaveBeenCalled();
      expect(state.audits.filter((audit) => audit.eventType === "outbox_skipped")).toMatchObject([{ outboxId: row!.id, fromState: "processing", toState: "skipped", code: "send_disabled", actorId: "system", occurredAt: at }]);
      expect((await processOutboxBatch(store, { provider: null, now: at, safe: disabled })).outcomes).toEqual([]);
      await expect(store.markSkipped(row!.id, "stale", "send_disabled", at)).rejects.toThrow();
      expect((await repository.snapshot()).audits.filter((audit) => audit.eventType === "outbox_skipped")).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  it("rolls back a skipped transition when its audit fails", async () => {
    const { store, repository, safe, input } = await fixture({ code: "S_UNKNOWN" }, (state) => {
      if (state.audits.some((audit) => audit.eventType === "outbox_skipped")) throw new Error("audit failed");
    });
    const prepare = safe.prepare;
    const result = await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, prepare: async (row) => { const value = await prepare(row); return { ...value, config: { ...value.config, enabled: false } }; } } });
    expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", lastErrorCode: null });
    expect((await repository.snapshot()).audits.some((audit) => audit.eventType === "outbox_skipped")).toBe(false);
  });
  it.each(["unknown", "accepted", "in_flight"] as const)("preserves unresolved %s evidence when skip is attempted", async (status) => {
    const { store, repository, safe, input } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    expect(permit).not.toBeNull();
    await repository.transaction(async (state) => { state.dispatches[0].state = status; state.slots[0].status = status; });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", claimToken: claim.claimToken });
  });
  it.each([
    ["open_unknown", "unknown"], ["awaiting_final", "accepted"], ["awaiting_cost", "rejected"], ["ready", "in_flight"],
  ])("Prisma skip refuses unresolved dispatch %s or slot %s", async (dispatchState, slotState) => {
    const outbox = { id: "outbox", status: "processing", claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000), lastErrorCode: "provider_error" };
    const dispatch = { id: "dispatch", reconciliationState: dispatchState, auditSequence: 2 };
    const slot = { status: slotState, reservedMilliKrw: 15000 };
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
      if (sql.includes('"NotificationOutbox"')) return [outbox];
      if (sql.includes('"NotificationDispatch"')) return [dispatch];
      if (sql.includes('"NotificationCostReservation"')) return [slot];
      throw new Error("Unexpected query");
    });
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    const store = new PrismaOutboxStore(db as unknown as OutboxDbClient);
    await expect(store.markSkipped(outbox.id, "claim", "send_disabled", at)).rejects.toThrow();
    expect(outbox).toMatchObject({ status: "processing", claimToken: "claim", lastErrorCode: "provider_error" });
    expect(dispatch).toMatchObject({ reconciliationState: dispatchState, auditSequence: 2 });
    expect(slot).toMatchObject({ status: slotState, reservedMilliKrw: 15000 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("keeps a blocked runtime nonterminal even when config is OFF", async () => {
    const { store, repository, safe, input } = await fixture({ code: "S_UNKNOWN" });
    await repository.transaction(async (state) => { state.runtime!.blocked = true; });
    const prepare = safe.prepare;
    const result = await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, prepare: async (row) => { const value = await prepare(row); return { ...value, config: { ...value.config, enabled: false } }; } } });
    expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
    expect((await repository.snapshot()).slots).toHaveLength(0);
    expect((await repository.snapshot()).audits.some((audit) => audit.eventType === "outbox_skipped")).toBe(false);
  });
  it.each([
    { provider: "other" }, { environment: "production" }, { activationEpoch: null }, { activationEpoch: new Date("invalid") },
  ])("does not skip OFF with invalid runtime %j", async (invalid) => {
    const { store, repository, safe, input } = await fixture({ code: "S_UNKNOWN" });
    await repository.transaction(async (state) => { Object.assign(state.runtime!, invalid); });
    const prepare = safe.prepare;
    const result = await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, prepare: async (row) => { const value = await prepare(row); return { ...value, config: { ...value.config, enabled: false } }; } } });
    expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
    const state = await repository.snapshot();
    expect(state.slots).toHaveLength(0); expect(state.audits.some((audit) => audit.eventType === "outbox_skipped")).toBe(false);
  });
  it("rejects expired lease and stale token before a safe skip", async () => {
    const { store, repository } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at);
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, "stale", "send_disabled", at)).rejects.toThrow();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", claim.leaseExpiresAt!)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it("Prisma skip rolls back its transition if audit insertion fails", async () => {
    const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
    let saved = { ...input, id: "outbox", status: "processing", attemptCount: 0, claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000), lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, createdAt: at, updatedAt: at };
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const candidate = { ...saved };
      const tx = {
        $queryRaw: async (parts: TemplateStringsArray) => { const sql = parts.join("?"); if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }]; if (sql.includes('"NotificationOutbox"')) return [candidate]; if (sql.includes('"NotificationDispatch"')) return []; throw new Error("Unexpected query"); },
        $executeRaw: async () => { throw new Error("Audit failed"); },
        notificationOutbox: { findUnique: async () => ({ ...candidate }), updateMany: async ({ data }: { data: Partial<typeof candidate> }) => { Object.assign(candidate, data); return { count: 1 }; } },
      };
      const result = await work(tx); saved = candidate; return result;
    } };
    const store = new PrismaOutboxStore(db as unknown as OutboxDbClient);
    await expect(store.markSkipped(saved.id, "claim", "send_disabled", at)).rejects.toThrow("Audit failed");
    expect(saved).toMatchObject({ status: "processing", claimToken: "claim", lastErrorCode: null, attemptCount: 0 });
  });
  it("preserves an unresolved lookup reservation attached through a dispatch slot", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    expect(permit).not.toBeNull();
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected"; Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "unknown", reserved: 500, confirmed: 0 });
    });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it.each([
    ["unknown", 0], ["in_flight", 0], ["unknown", 500], ["in_flight", 500],
  ] as const)("refuses %s lookup with reservation %i and preserves all evidence", async (status, reserved) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status, reserved, confirmed: 0 });
    });
    const before = await repository.snapshot();
    const results = await Promise.allSettled([store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at), store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await expect(store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it("allows a resolved zero-reservation lookup, with fencing under concurrent skips", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected"; Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "resolved", reserved: 0, confirmed: 0 });
    });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, "stale", "send_disabled", at)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
    const results = await Promise.allSettled([store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at), store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const after = await repository.snapshot();
    expect(after.outboxes[0]).toMatchObject({ status: "skipped", claimToken: null, leaseExpiresAt: null, attemptCount: 0 });
    expect(after.slots).toEqual(before.slots); expect(after.lookups).toEqual(before.lookups);
    expect(after.audits.filter((audit) => audit.eventType === "outbox_skipped")).toHaveLength(1);
  });
  it.each(["skip", "expiry"] as const)("ignores an unrelated orphan lookup on %s", async (transition) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); await safe.prepare(claim);
    await repository.transaction(async (state) => { state.lookups.push({ id: "orphan", slotId: "missing", month: "2026-10", status: "unknown", reserved: 500, confirmed: 0 }); });
    const before = await repository.snapshot();
    const result = transition === "skip" ? await store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : await store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000));
    expect(result.status).toBe("skipped");
    expect((await repository.snapshot()).lookups).toEqual(before.lookups);
  });
  it("fails closed for an ambiguous lookup linked to a target slot", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.slots.push({ ...state.slots[0], dispatchId: "other" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "resolved", reserved: 0, confirmed: 0 });
    });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).rejects.toThrow();
    await expect(store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it("allows a synthetic applied in-memory correction without weakening slot checks", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      // Synthetic insertion bypasses the real correction path's summary_purged source-slot requirement.
      state.corrections = [{ commandId: "correction", slotId: permit!.slotId, actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: 0, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at }];
    });
    expect(await store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).toMatchObject({ status: "skipped" });
  });
  it.each(["skip", "expiry"] as const)("allows a purged in-memory correction on %s", async (transition) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: null, confirmed: null, adjustment: null, costState: "summary_purged", costSummaryPurgedAt: at });
      state.corrections = [{ commandId: "correction", slotId: permit!.slotId, actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: null, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at, costSummaryPurgedAt: at, contribution: "folded_archive" }];
    });
    const before = await repository.snapshot();
    const result = transition === "skip" ? await store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : await store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000));
    expect(result.status).toBe("skipped");
    const after = await repository.snapshot();
    expect(after.corrections).toEqual(before.corrections);
    expect(after.audits.filter((audit) => audit.eventType === "outbox_skipped")).toHaveLength(1);
  });
  it.each(["skip", "expiry"] as const)("rejects contradictory settled slot values on %s", async (transition) => {
    for (const invalid of [{ confirmed: -1 }, { confirmed: Number.MAX_SAFE_INTEGER + 1 }, { confirmed: undefined }, { costSummaryPurgedAt: at }]) {
      const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
      const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
      await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
      await repository.transaction(async (state) => {
        state.dispatches[0].state = "rejected";
        Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" }, invalid);
      });
      const before = await repository.snapshot();
      const result = transition === "skip" ? store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000));
      await expect(result).rejects.toThrow();
      expect(await repository.snapshot()).toEqual(before);
    }
  });
  it.each(["skip", "expiry"] as const)("rejects malformed purged correction on %s", async (transition) => {
    for (const invalid of [{ delta: 0 }, { contribution: undefined }, { costSummaryPurgedAt: new Date("invalid") }, { appliedAt: new Date("invalid") }]) {
      const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
      const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
      const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
      await repository.transaction(async (state) => {
        state.dispatches[0].state = "rejected";
        Object.assign(state.slots[0], { status: "rejected", reserved: null, confirmed: null, adjustment: null, costState: "summary_purged", costSummaryPurgedAt: at });
        state.corrections = [{ commandId: "correction", slotId: permit!.slotId, actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: null, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at, costSummaryPurgedAt: at, contribution: "folded_archive", ...invalid }];
      });
      const before = await repository.snapshot();
      const result = transition === "skip" ? store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000));
      await expect(result).rejects.toThrow();
      expect(await repository.snapshot()).toEqual(before);
    }
  });
  it.each(["unknown", "in_flight"] as const)("Prisma skip rejects zero-reservation %s lookup without writes", async (status) => {
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
      if (sql.includes('"NotificationOutbox"')) return [{ id: "outbox", status: "processing", claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000) }];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: "rejected", auditSequence: 2 }];
      if (sql.includes("= 'SEND_SLOT'")) return [{ id: "slot", entryKind: "SEND_SLOT", status: "rejected", reservedMilliKrw: 0n }];
      if (sql.includes("<> 'SEND_SLOT'")) return [{ id: "lookup", entryKind: "LOOKUP_COST", status, reservedMilliKrw: 0n, sourceSlotId: "slot" }];
      throw new Error("Unexpected query");
    });
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markSkipped("outbox", "claim", "send_disabled", at)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([false, true])("Prisma skip permits a resolved lookup with applied correction=%s", async (correction) => {
    const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
    const saved = { ...input, id: "outbox", status: "processing", attemptCount: 0, claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000), lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, createdAt: at, updatedAt: at };
    const query = async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
      if (sql.includes('"NotificationOutbox"')) return [saved];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: "rejected", auditSequence: 2 }];
      if (sql.includes("= 'SEND_SLOT'")) return [{ id: "slot", entryKind: "SEND_SLOT", status: "rejected", costState: "settled", reservedMilliKrw: 0n, confirmedMilliKrw: 0n }];
      // Synthetic applied correction uses a settled source; the real correction path requires a summary_purged source slot.
      if (sql.includes("<> 'SEND_SLOT'")) return [{ id: "lookup", entryKind: "LOOKUP_COST", status: "resolved", costState: "settled", reservedMilliKrw: 0n, confirmedMilliKrw: 500n, sourceSlotId: "slot" }, ...(correction ? [{ id: "correction", entryKind: "COST_CORRECTION", status: "applied", costState: "applied", reservedMilliKrw: null, sourceSlotId: "slot", sourceCostId: "slot" }] : [])];
      throw new Error("Unexpected query");
    };
    const execute = vi.fn(async () => 1);
    const tx = { $queryRaw: query, $executeRaw: execute, notificationOutbox: { findUnique: async () => ({ ...saved }), updateMany: async ({ data }: { data: Partial<typeof saved> }) => { Object.assign(saved, data); return { count: 1 }; } } };
    const db = { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx) };
    expect(await new PrismaOutboxStore(db as unknown as OutboxDbClient).markSkipped("outbox", "claim", "send_disabled", at)).toMatchObject({ status: "skipped", claimToken: null, leaseExpiresAt: null });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("Prisma skip rejects a proposed correction even with no reservation", async () => {
    const query = async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
      if (sql.includes('"NotificationOutbox"')) return [{ status: "processing", claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000) }];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: "rejected", auditSequence: 0 }];
      if (sql.includes("= 'SEND_SLOT'")) return [{ id: "slot", status: "rejected", reservedMilliKrw: 0n }];
      if (sql.includes("<> 'SEND_SLOT'")) return [{ id: "correction", entryKind: "COST_CORRECTION", status: "proposed", costState: "proposed", reservedMilliKrw: null, sourceSlotId: "slot", sourceCostId: "slot" }];
      throw new Error("Unexpected query");
    };
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markSkipped("outbox", "claim", "send_disabled", at)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("Prisma skip fails closed for an unlinked resolved lookup", async () => {
    const query = async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
      if (sql.includes('"NotificationOutbox"')) return [{ status: "processing", claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000) }];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: "ready", auditSequence: 0 }];
      if (sql.includes("= 'SEND_SLOT'")) return [];
      if (sql.includes("<> 'SEND_SLOT'")) return [{ id: "lookup", entryKind: "LOOKUP_COST", status: "resolved", reservedMilliKrw: 0n, sourceSlotId: "missing" }];
      throw new Error("Unexpected query");
    };
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markSkipped("outbox", "claim", "send_disabled", at)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not call the mock if permit or audit commit rolls back", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" }, (state) => {
      if (state.audits.some((audit) => audit.eventType === "permit_issued")) throw new Error("Synthetic rollback.");
    });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      await processOutboxBatch(store, { provider: null, now: at, safe });
      expect(spy).not.toHaveBeenCalled();
      const state = await repository.snapshot();
      expect(state.slots).toHaveLength(0);
      expect(state.audits.some((audit) => audit.eventType === "permit_issued")).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it("bases backoff on the time the result is observed", async () => {
    const { store, input, safe } = await fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    const observed = new Date(at.getTime() + 30000); let reads = 0;
    await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, clock: () => ++reads >= 3 ? observed : at } });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "pending", nextRetryAt: new Date(observed.getTime() + 60000) });
  });
  it("blocks an unexpected environment before issuing a slot", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const original = safe.prepare;
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, prepare: async (row) => ({ ...await original(row), config: { mode: "live", enabled: true, provider: "solapi", environment: "production" } }) } });
      expect(spy).not.toHaveBeenCalled(); expect((await repository.snapshot()).slots).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
  it("retains closure and terminal outbox after bound late acceptance and lookup", async () => {
    const ref = `g2ref_${"c".repeat(32)}`;
    const { store, repository, input, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    expect(permit).not.toBeNull();
    await store.markFailed(claim.id, claim.claimToken!, "provider_result_unknown", null);
    await expect(recordLateResult(repository, { ...permit!, slotId: "other_slot" }, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow();
    expect((await repository.snapshot()).slots[0].status).toBe("unknown");
    await repository.transaction(async (state) => { state.dispatches[0].state = "closed_unconfirmed"; state.dispatches[0].finalStatus = "unknown"; });
    await recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at);
    const command = { commandId: "lookup1", slotId: permit!.slotId, now: at, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } };
    expect(await pollDeliveryResult(repository, command, new MockLookupProvider({ code: "L_DELIVERED", ref }))).toBe("recorded");
    const state = await repository.snapshot();
    expect(state.dispatches[0]).toMatchObject({ state: "closed_unconfirmed", finalStatus: "delivered" });
    expect(state.slots).toMatchObject([{ status: "accepted", reserved: 15000, providerRef: ref }]);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", nextRetryAt: null });
    expect((await processOutboxBatch(store, { provider: null, now: at, safe })).outcomes).toEqual([]);
  });
  it.each(["L_DELIVERED", "L_FAILED", "L_PENDING", "L_NOT_FOUND"] as const)("reconciles %s without another send or releasing reservations", async (code) => {
    const ref = `g2ref_${"a".repeat(32)}`;
    const { store, repository, input, safe } = await fixture({ code: "S_ACCEPTED", ref });
    await processOutboxBatch(store, { provider: null, now: at, safe });
    const before = await repository.snapshot(); const slotId = before.slots[0].id;
    const command = { commandId: "lookup1", slotId, now: at, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } };
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const result = await pollDeliveryResult(repository, command, new MockLookupProvider({ code, ref }));
      expect(result).toBe(code === "L_DELIVERED" || code === "L_FAILED" ? "recorded" : "unknown");
      expect(spy).not.toHaveBeenCalled();
      const state = await repository.snapshot();
      expect(state.slots).toHaveLength(1); expect(state.slots[0].reserved).toBe(15000);
      expect(state.lookups).toMatchObject([{ status: "unknown", reserved: 500 }]);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "sent", providerRef: ref });
      if (code === "L_DELIVERED" || code === "L_FAILED") expect(state.dispatches[0].finalStatus).toBe(code === "L_DELIVERED" ? "delivered" : "delivery_failed");
      else expect(state.dispatches[0].finalStatus).toBeUndefined();
    } finally { spy.mockRestore(); }
  });
  it("makes no network request while processing a mock acceptance", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden."); });
    vi.stubGlobal("fetch", fetch);
    try {
      const { store, safe } = await fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
      await processOutboxBatch(store, { provider: null, now: at, safe });
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("allows overlapping workers only one committed send slot", async () => {
    const { store, repository, safe } = await fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      await Promise.all([processOutboxBatch(store, { provider: null, now: at, safe }), processOutboxBatch(store, { provider: null, now: at, safe })]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await repository.snapshot()).slots).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  it("does not issue a permit while the persistent kill switch is blocked", async () => {
    const { store, repository, safe } = await fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    await repository.transaction(async (state) => { state.runtime!.blocked = true; });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      await processOutboxBatch(store, { provider: null, now: at, safe });
      expect(spy).not.toHaveBeenCalled();
      expect((await repository.snapshot()).slots).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
  it("calls the mock only after the slot, reservation, and permit audit commit", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const original = MockProvider.prototype.send;
    const spy = vi.spyOn(MockProvider.prototype, "send").mockImplementation(async function (this: MockProvider, permit) {
      const state = await repository.snapshot();
      expect(state.slots).toMatchObject([{ status: "in_flight", reserved: 15000 }]);
      expect(state.audits.map((a) => a.eventType)).toContain("permit_issued");
      return original.call(this, permit);
    });
    try { await processOutboxBatch(store, { provider: null, now: at, safe }); expect(spy).toHaveBeenCalledTimes(1); }
    finally { spy.mockRestore(); }
  });
  it("treats an actual provider throw and an acceptance storage failure as unknown", async () => {
    for (const failure of ["throw", "store"] as const) {
      const { store, repository, input, safe } = await fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
      const mock = failure === "throw" ? vi.spyOn(MockProvider.prototype, "send").mockRejectedValueOnce(new Error("synthetic error")) : vi.spyOn(store, "markSent").mockRejectedValueOnce(new Error("synthetic error"));
      try {
        await processOutboxBatch(store, { provider: null, now: at, safe });
        expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
        expect((await repository.snapshot()).slots).toMatchObject([{ status: "unknown", reserved: 15000 }]);
      } finally { mock.mockRestore(); }
    }
  });
  it.each([{ code: "S_THROW" }, { code: "S_TIMEOUT" }, { code: "S_PENDING", accepted: false }, { code: "S_ACCEPTED" }, { code: "synthetic_5xx" }])("never retries an ambiguous mock result %j", async (mock) => {
    const { store, repository, input, safe } = await fixture(mock);
    await processOutboxBatch(store, { provider: null, now: at, safe });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
    expect((await repository.snapshot()).slots).toMatchObject([{ status: "unknown", reserved: 15000 }]);
    await processOutboxBatch(store, { provider: null, now: new Date(at.getTime() + 86400000), safe });
    expect((await repository.snapshot()).slots).toHaveLength(1);
  });
  it("keeps an unknown result terminal with its issued slot and reservation", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_UNKNOWN" });
    await processOutboxBatch(store, { provider: null, now: at, safe });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
    const result = await repository.snapshot();
    expect(result.slots).toMatchObject([{ status: "unknown", reserved: 15000 }]);
    expect(result.audits.map((a) => a.eventType)).toContain("permit_issued");
    expect((await processOutboxBatch(store, { provider: null, now: new Date(at.getTime() + 86400000), safe })).outcomes).toEqual([]);
  });
  it("records acceptance with a validated reference, without claiming delivery", async () => {
    const ref = `g2ref_${"a".repeat(32)}`;
    const { store, repository, input, safe } = await fixture({ code: "S_ACCEPTED", ref });
    await processOutboxBatch(store, { provider: null, now: at, safe });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "sent", providerRef: ref });
    const state = await repository.snapshot();
    expect(state.dispatches[0]).toMatchObject({ state: "accepted" });
    expect(state.dispatches[0].finalStatus).toBeUndefined();
    expect(state.slots).toMatchObject([{ status: "accepted", providerRef: ref, reserved: 15000 }]);
    expect((await processOutboxBatch(store, { provider: null, now: at, safe })).outcomes).toEqual([]);
    expect((await repository.snapshot()).slots).toHaveLength(1);
  });
  it("schedules only a definite retryable rejection and retains the slot", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    const retryAfter = new Date(at.getTime() + 120000);
    await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, retryAfter: () => retryAfter } });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "pending", attemptCount: 1, nextRetryAt: retryAfter });
    expect((await repository.snapshot()).slots).toMatchObject([{ status: "rejected", reserved: 15000 }]);
  });
  it.each([
    ["120", 120000], ["Wed, 28 Oct 2026 00:02:00 GMT", 120000],
    ["-5", 60000], ["0", 60000], ["999999999999999999999", 60000], ["not a date", 60000],
  ])("handles Retry-After %s at the observation boundary", async (header, delay) => {
    const { store, input, safe } = await fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    await processOutboxBatch(store, { provider: null, now: at, safe: { ...safe, retryAfter: () => header } });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "pending", nextRetryAt: new Date(at.getTime() + delay) });
  });
  it("stops after five definite rejections and five issued slots", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    let clock = at;
    for (const minutes of [1, 5, 15, 60, 0]) {
      await processOutboxBatch(store, { provider: null, now: clock, safe: { ...safe, clock: () => clock } });
      clock = new Date(clock.getTime() + minutes * 60000);
    }
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", attemptCount: 5, nextRetryAt: null });
    expect((await repository.snapshot()).slots).toHaveLength(5);
    expect((await processOutboxBatch(store, { provider: null, now: clock, safe: { ...safe, clock: () => clock } })).outcomes).toEqual([]);
  });
  it("does not issue a retry after the fixed recipient is withdrawn", async () => {
    const { store, repository, safe } = await fixture({ code: "S_REJECT_TEMP", nonBillableEvidence: false });
    await processOutboxBatch(store, { provider: null, now: at, safe });
    await repository.transaction(async (state) => { (state.recipients[0].registration as { state: string }).state = "revoked"; });
    const retryAt = new Date(at.getTime() + 60000);
    await processOutboxBatch(store, { provider: null, now: retryAt, safe: { ...safe, clock: () => retryAt } });
    const state = await repository.snapshot();
    expect(state.slots).toHaveLength(1);
    expect(state.dispatches[0].context.recipientVersion).toBe("v1");
  });
  it("converts an expired lease with an issued slot to unknown instead of resending", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at);
    const prepared = await safe.prepare(claim);
    expect(await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at })).not.toBeNull();
    const later = new Date(at.getTime() + 300000);
    await recoverStaleProcessing(store, later);
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
    expect((await repository.snapshot()).slots).toMatchObject([{ status: "unknown", reserved: 15000 }]);
    expect((await processOutboxBatch(store, { provider: null, now: later, safe })).outcomes).toEqual([]);
  });
  it.each(["accepted", "unknown", "rejected"] as const)("does not reopen a terminal outbox for a late %s result", async (status) => {
    const ref = `g2ref_${"b".repeat(32)}`;
    const mock = status === "accepted" ? { code: "S_ACCEPTED", ref } : status === "unknown" ? { code: "S_UNKNOWN" } : { code: "S_REJECT_TEMP", nonBillableEvidence: false };
    const { store, repository, input, safe } = await fixture(mock);
    const original = MockProvider.prototype.send;
    const spy = vi.spyOn(MockProvider.prototype, "send").mockImplementation(async function (this: MockProvider, permit) {
      await recoverStaleProcessing(store, new Date(at.getTime() + 300000));
      return original.call(this, permit);
    });
    try { await processOutboxBatch(store, { provider: null, now: at, safe }); } finally { spy.mockRestore(); }
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "failed", lastErrorCode: "provider_result_unknown", nextRetryAt: null });
    expect((await repository.snapshot()).slots).toMatchObject([{ status: status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : "unknown", reserved: 15000, ...(status === "accepted" ? { providerRef: ref } : {}) }]);
  });
  it("closes an event at the 24-hour boundary without issuing a slot", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
    const expiry = new Date(at.getTime() + 86400000);
    await processOutboxBatch(store, { provider: null, now: expiry, safe: { ...safe, clock: () => expiry } });
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "skipped", lastErrorCode: "event_expired", nextRetryAt: null });
    expect((await repository.snapshot()).slots).toHaveLength(0);
  });
  it.each(["in_flight", "unknown", "accepted", "closed_unconfirmed"] as const)("expiry preserves %s evidence", async (status) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at);
    const prepared = await safe.prepare(claim);
    await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => { state.dispatches[0].state = status; state.slots[0].status = status === "closed_unconfirmed" ? "unknown" : status; });
    const before = await repository.snapshot();
    await expect(store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it("preserves rejected slot costs and linked unresolved lookups until both settle", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected"; state.slots[0].status = "rejected";
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "unknown", reserved: 500, confirmed: 0 });
    });
    const expiry = new Date(at.getTime() + 86400000);
    let before = await repository.snapshot();
    await expect(store.markExpired(claim.id, claim.claimToken!, expiry)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
    await repository.transaction(async (state) => { state.slots[0].reserved = 0; state.slots[0].confirmed = 0; state.slots[0].costState = "settled"; });
    before = await repository.snapshot();
    await expect(store.markExpired(claim.id, claim.claimToken!, expiry)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
    await repository.transaction(async (state) => { state.lookups[0].status = "resolved"; state.lookups[0].reserved = 0; state.lookups[0].confirmed = 500; });
    await expect(store.markExpired(claim.id, "stale", expiry)).rejects.toThrow();
    const result = await store.markExpired(claim.id, claim.claimToken!, expiry);
    expect(result).toMatchObject({ status: "skipped", lastErrorCode: "event_expired" });
    const after = await repository.snapshot();
    expect(after.slots).toEqual(before.slots);
    expect(after.lookups[0]).toMatchObject({ status: "resolved", reserved: 0, confirmed: 500 });
  });
  it("rolls back expiry when audit commit fails and fences concurrent transitions", async () => {
    const { store, repository } = await fixture({}, (state) => { if (state.audits.some((audit) => audit.eventType === "outbox_skipped")) throw new Error("audit failed"); });
    const [claim] = await store.claimDue(1, at); const before = await repository.snapshot();
    const expiry = new Date(at.getTime() + 86400000);
    const attempts = await Promise.allSettled([store.markExpired(claim.id, claim.claimToken!, expiry), store.markExpired(claim.id, claim.claimToken!, expiry)]);
    expect(attempts.every((item) => item.status === "rejected")).toBe(true);
    expect(await repository.snapshot()).toEqual(before);
  });
  it("applies the blocked boundary without issuing a send", async () => {
    const { store, repository, input, safe } = await fixture({ code: "S_UNKNOWN" });
    await repository.transaction(async (state) => { state.runtime!.blocked = true; });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const prior = new Date(at.getTime() + 86400000 - 1);
      await processOutboxBatch(store, { provider: null, now: prior, safe: { ...safe, clock: () => prior } });
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing" });
      const expiry = new Date(at.getTime() + 86400000);
      const claimed = await store.findByDedupeKey(input.dedupeKey);
      await store.markExpired(claimed!.id, claimed!.claimToken!, expiry);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "skipped", lastErrorCode: "event_expired" });
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("blocked expired worker retains unresolved reservation and never sends", async () => {
    const { store, repository, safe, input } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.runtime!.blocked = true; state.dispatches[0].state = "rejected"; state.slots[0].status = "rejected";
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "unknown", reserved: 500, confirmed: 0 });
      Object.assign(state.outboxes[0], { status: "pending", claimToken: null, leaseExpiresAt: null });
    });
    const before = await repository.snapshot(); const expiry = new Date(at.getTime() + 86400000);
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const result = await processOutboxBatch(store, { provider: null, now: expiry, safe: { ...safe, clock: () => expiry } });
      expect(result.outcomes).toMatchObject([{ status: "failed", reason: "invalid_transition" }]);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0, lastErrorCode: null });
      const after = await repository.snapshot();
      expect(after.slots).toEqual(before.slots); expect(after.lookups).toEqual(before.lookups);
      expect(after.audits.filter((audit) => audit.eventType === "outbox_skipped")).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it.each(["open_unknown", "awaiting_final", "awaiting_cost", "closed_unconfirmed"])("Prisma expiry refuses unresolved dispatch %s", async (dispatchState) => {
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview" }];
      if (sql.includes('"NotificationOutbox"')) return [{ occurredAt: at }];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: dispatchState, auditSequence: 2 }];
      if (sql.includes('"NotificationCostReservation"')) return [];
      throw new Error("Unexpected query");
    });
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markExpired("outbox", "claim", new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("Prisma expiry rejects a linked unknown lookup without writing", async () => {
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview" }];
      if (sql.includes('"NotificationOutbox"')) return [{ occurredAt: at }];
      if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: "rejected", auditSequence: 2 }];
      if (sql.includes('"NotificationCostReservation"') && sql.includes("<> 'SEND_SLOT'")) return [{ id: "lookup", entryKind: "LOOKUP_COST", status: "unknown", costState: "reserved_unknown", reservedMilliKrw: 500n, confirmedMilliKrw: null, sourceSlotId: "slot" }];
      if (sql.includes('"NotificationCostReservation"')) return [{ id: "slot", entryKind: "SEND_SLOT", status: "rejected", costState: "settled", reservedMilliKrw: 0n, confirmedMilliKrw: 0n }];
      throw new Error("Unexpected query");
    });
    const execute = vi.fn(async () => 1);
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: query, $executeRaw: execute }) };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markExpired("outbox", "claim", new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("Prisma expiry rolls its transition back when the audit insert fails", async () => {
    const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
    let saved = { ...input, id: "outbox", status: "processing", attemptCount: 0, claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 86460000), lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, createdAt: at, updatedAt: at };
    const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const candidate = { ...saved };
      const tx = {
        $queryRaw: async (parts: TemplateStringsArray) => { const sql = parts.join("?"); if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview" }]; if (sql.includes('"NotificationOutbox"')) return [candidate]; if (sql.includes('"NotificationDispatch"')) return []; throw new Error("Unexpected query"); },
        $executeRaw: async () => { throw new Error("audit failed"); },
        notificationOutbox: { findUnique: async () => ({ ...candidate }), updateMany: async ({ data }: { data: Partial<typeof candidate> }) => { Object.assign(candidate, data); return { count: 1 }; } },
      };
      const result = await work(tx); saved = candidate; return result;
    } };
    await expect(new PrismaOutboxStore(db as unknown as OutboxDbClient).markExpired("outbox", "claim", new Date(at.getTime() + 86400000))).rejects.toThrow("audit failed");
    expect(saved).toMatchObject({ status: "processing", claimToken: "claim", attemptCount: 0, lastErrorCode: null });
  });

});

describe("G2 cost symmetry reproduction", () => {
  it("synthetic resolved lookup with null confirmed cost blocks skip", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "resolved", reserved: 0, confirmed: null });
    });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it.each([
    ["positive confirmed cost", { reserved: 0, confirmed: 500 }],
    ["purged cost summary", { reserved: null, confirmed: null, costSummaryPurgedAt: at, contribution: "folded_archive" as const }],
  ])("allows skip for a resolved lookup with %s", async (_label, cost) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: "resolved", ...cost });
    });
    const before = await repository.snapshot();
    expect(await store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).toMatchObject({ status: "skipped" });
    expect((await repository.snapshot()).lookups).toEqual(before.lookups);
  });
  it("synthetic unsettled rejected slot with zero reservation blocks skip", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: null });
    });
    const before = await repository.snapshot();
    await expect(store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at)).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
  it("synthetic incomplete linked correction blocks expiry", async () => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
    await repository.transaction(async (state) => {
      state.dispatches[0].state = "rejected";
      Object.assign(state.slots[0], { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
      state.corrections = [{ commandId: "correction", slotId: permit!.slotId, actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: null, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at }];
    });
    const before = await repository.snapshot();
    await expect(store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000))).rejects.toThrow();
    expect(await repository.snapshot()).toEqual(before);
  });
});

describe("G2 synthetic cost evidence matrix", () => {
  it.each(["skip", "expiry"] as const)("in-memory %s rejects unresolved NULL lookup, unsettled NULL lookup, and mixed evidence", async (transition) => {
    for (const scenario of ["unresolved-null", "unsettled-null", "mixed"] as const) {
      const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
      const [claim] = await store.claimDue(1, at);
      const prepared = await safe.prepare(claim);
      const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: at });
      await repository.transaction(async (state) => {
        state.dispatches[0].state = scenario === "mixed" ? "unknown" : "rejected";
        Object.assign(state.slots[0], scenario === "mixed" ? { status: "unknown", reserved: 15000 } : { status: "rejected", reserved: 0, confirmed: 0, costState: "settled" });
        state.lookups.push({ id: "lookup", slotId: permit!.slotId, month: "2026-10", status: scenario === "unsettled-null" ? "resolved" : "unknown", reserved: null, confirmed: null });
        if (scenario === "mixed") state.corrections = [{ commandId: "correction", slotId: permit!.slotId, actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: null, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at }];
      });
      const before = await repository.snapshot();
      await expect(transition === "skip" ? store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000))).rejects.toThrow();
      expect(await repository.snapshot()).toEqual(before);
    }
  });
  it.each(["skip", "expiry"] as const)("in-memory %s ignores a synthetic orphan correction", async (transition) => {
    const { store, repository, safe } = await fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, at); await safe.prepare(claim);
    await repository.transaction(async (state) => {
      state.corrections = [{ commandId: "orphan", slotId: "missing", actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: null, version: "v1", costRevision: 0, periodRevisions: {}, appliedAt: at }];
    });
    const before = await repository.snapshot();
    const result = transition === "skip" ? await store.markSkipped(claim.id, claim.claimToken!, "send_disabled", at) : await store.markExpired(claim.id, claim.claimToken!, new Date(at.getTime() + 86400000));
    expect(result.status).toBe("skipped");
    expect((await repository.snapshot()).corrections).toEqual(before.corrections);
  });
  it.each(["skip", "expiry"] as const)("Prisma %s checks synthetic NULL, mixed and purged correction evidence", async (transition) => {
    for (const scenario of ["unresolved-null", "unsettled-null", "mixed", "purged-correction"] as const) {
      const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
      const saved = { ...input, id: "outbox", status: "processing", attemptCount: 0, claimToken: "claim", leaseExpiresAt: new Date(at.getTime() + 60000), lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null, createdAt: at, updatedAt: at };
      const slot = { id: "slot", entryKind: "SEND_SLOT", status: scenario === "mixed" ? "unknown" : "rejected", costState: "settled", reservedMilliKrw: 0n, confirmedMilliKrw: 0n, adjustmentMilliKrw: null, costSummaryPurgedAt: null };
      // The unsettled NULL variant violates DB CHECK constraints; it probes fail-closed handling only.
      const lookup = { id: "lookup", entryKind: "LOOKUP_COST", status: scenario === "unsettled-null" ? "resolved" : "unknown", costState: scenario === "unsettled-null" ? "reserved" : "summary_purged", reservedMilliKrw: null, confirmedMilliKrw: null, adjustmentMilliKrw: null, costSummaryPurgedAt: scenario === "unsettled-null" ? null : at, sourceSlotId: "slot" };
      // Synthetic correction has a settled source, unlike the real application path requiring summary_purged.
      const correction = { id: "correction", entryKind: "COST_CORRECTION", status: scenario === "mixed" ? "proposed" : "applied", costState: scenario === "mixed" ? "proposed" : "summary_purged", reservedMilliKrw: null, confirmedMilliKrw: null, adjustmentMilliKrw: null, costSummaryPurgedAt: at, sourceSlotId: "slot", sourceCostId: "slot" };
      const query = vi.fn(async (parts: TemplateStringsArray) => {
        const sql = parts.join("?");
        if (sql.includes('"NotificationRuntimeConfig"')) return [{ environment: "preview", providerId: "solapi", blocked: false, activationEpoch: at }];
        if (sql.includes('"NotificationOutbox"')) return [saved];
        if (sql.includes('"NotificationDispatch"')) return [{ id: "dispatch", reconciliationState: scenario === "mixed" ? "open_unknown" : "rejected", auditSequence: 2 }];
        if (sql.includes("= 'SEND_SLOT'")) return [slot];
        if (sql.includes("<> 'SEND_SLOT'")) return scenario === "purged-correction" ? [correction] : scenario === "mixed" ? [lookup, correction] : [lookup];
        throw new Error("Unexpected query");
      });
      const execute = vi.fn(async () => 1);
      const tx = { $queryRaw: query, $executeRaw: execute, notificationOutbox: { findUnique: async () => ({ ...saved }), updateMany: async ({ data }: { data: Partial<typeof saved> }) => { Object.assign(saved, data); return { count: 1 }; } } };
      const db = { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx) };
      const store = new PrismaOutboxStore(db as unknown as OutboxDbClient);
      const action = transition === "skip" ? store.markSkipped("outbox", "claim", "send_disabled", at) : store.markExpired("outbox", "claim", new Date(at.getTime() + 86400000));
      if (scenario === "purged-correction") {
        expect(await action).toMatchObject({ status: "skipped" });
        expect(execute).toHaveBeenCalledTimes(2);
      } else {
        await expect(action).rejects.toThrow();
        expect(saved).toMatchObject({ status: "processing", claimToken: "claim" });
        expect(execute).not.toHaveBeenCalled();
      }
    }
  });
});
