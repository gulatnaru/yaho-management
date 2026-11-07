import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { dispatchContextSchema, realDispatchContextSchema } from "@/lib/kakao/send-contract";
import { REAL_POLICY } from "@/lib/kakao/send-config";
import { formatSubmittedAt } from "@/lib/kakao/template";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { SolapiAdapter, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { recordLateResult } from "@/server/kakao/late-result";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";
import { createP5Fixture, p5At } from "./p5-fixture";

const at = new Date("2026-10-28T00:00:00Z");
const key = randomBytes(32);
const quote = { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const;
const mockPolicy = { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null } as const;
const mockContext = dispatchContextSchema.parse({
  event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`,
  recipientId: "r1", recipientVersion: "v1", submittedAt: at,
  templateId: "mock_application_received_v1", templateVersion: "g2-v1",
  variables: { 접수시각: formatSubmittedAt(at) },
});
const realContext = realDispatchContextSchema.parse({
  event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`,
  recipientId: "r1", recipientVersion: "v1", submittedAt: at,
  templateId: "real-template-v1", templateVersion: "g4-v1",
  variables: { 접수시각: formatSubmittedAt(at) },
});

async function fixture() {
  const state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
  const repository = new InMemoryDispatchRepository(state);
  const store = new InMemoryOutboxStore(repository);
  const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", at);
  await store.enqueue(input);
  return { store, repository, input };
}

function throwingTransport(): { transport: SolapiTransport; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () => { throw new Error("transport must not be called"); });
  return { transport: { fetch }, fetch };
}

function realAdapter(transport: SolapiTransport) {
  return new SolapiAdapter({ transport, apiKey: "test-api-key", apiSecret: "test-api-secret", pfId: "KA01PF1234567890abcdef", templateId: "real-template-v1", to: "01012345678", timeoutMs: 10_000 });
}

describe("worker real provider", () => {
  it("rejects a mock context with a SolapiAdapter without calling the provider", async () => {
    const { store, repository, input } = await fixture();
    const { transport, fetch } = throwingTransport();
    const safe = {
      repository,
      provider: realAdapter(transport),
      clock: () => at,
      prepare: async () => ({ dispatchId: "d1", context: mockContext, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: mockPolicy, quote, recipientKey: { key, keyVersion: "k1", synthetic: true as const } }),
    };
    const result = await processOutboxBatch(store, { provider: null, now: at, safe });
    expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
    expect((await repository.snapshot()).slots).toHaveLength(0);
  });
  it("rejects a real context with a MockProvider without calling the provider", async () => {
    const { store, repository, input } = await fixture();
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const safe = {
        repository,
        provider: new MockProvider({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` }),
        clock: () => at,
        prepare: async () => ({ dispatchId: "d1", context: realContext, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: REAL_POLICY, quote, recipientKey: { key, keyVersion: "k1" } }),
      };
      const result = await processOutboxBatch(store, { provider: null, now: at, safe });
      expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
      expect(spy).not.toHaveBeenCalled();
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
      expect((await repository.snapshot()).slots).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
  it("treats prepare-null as failed/store_error with no provider call and no row state change", async () => {
    const { store, repository, input } = await fixture();
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const safe = {
        repository,
        provider: new MockProvider({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` }),
        clock: () => at,
        prepare: async () => null,
      };
      const result = await processOutboxBatch(store, { provider: null, now: at, safe });
      expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
      expect(spy).not.toHaveBeenCalled();
      // The claim itself stands (processing + token + lease); nothing else changed.
      const row = await store.findByDedupeKey(input.dedupeKey);
      expect(row).toMatchObject({ status: "processing", attemptCount: 0 });
      expect(row!.claimToken).not.toBeNull();
      expect(row!.leaseExpiresAt).not.toBeNull();
      const state = await repository.snapshot();
      expect(state.slots).toHaveLength(0);
      expect(state.audits.some((audit) => audit.eventType === "permit_issued")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
  it("sends the mock path through the polymorphic provider call with identical outcomes", async () => {
    const ref = `g2ref_${"a".repeat(32)}`;
    const { store, repository, input, safe } = await createP5Fixture({ code: "S_ACCEPTED", ref });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const result = await processOutboxBatch(store, { provider: null, now: p5At, safe });
      expect(result.outcomes).toMatchObject([{ status: "sent", rowStatus: "sent" }]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await store.findByDedupeKey(input.dedupeKey)).toMatchObject({ status: "sent", providerRef: ref });
      expect((await repository.snapshot()).slots).toMatchObject([{ status: "accepted", providerRef: ref }]);
    } finally {
      spy.mockRestore();
    }
  });
  it("keeps recordLateResult provider-agnostic: it records a late result for a mock-issued permit without consulting any provider", async () => {
    // PLAN §1 step 4.5 describes a provider check inside recordLateResult,
    // but no such check exists in the code (grep-verified): recordLateResult
    // takes only repository/permit/result/time and validates the permit and
    // result schemas. This test pins that provider-agnostic behavior instead
    // of asserting a check that is not there.
    const ref = `g2ref_${"c".repeat(32)}`;
    const { store, repository, safe } = await createP5Fixture({ code: "S_UNKNOWN" });
    const [claim] = await store.claimDue(1, p5At);
    const prepared = await safe.prepare(claim);
    const permit = await acquireDispatchPermit(repository, { ...prepared, claimToken: claim.claimToken!, now: p5At });
    expect(permit).not.toBeNull();
    await store.markFailed(claim.id, claim.claimToken!, "provider_result_unknown", null);
    await recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, p5At);
    const state = await repository.snapshot();
    expect(state.slots).toMatchObject([{ status: "accepted", providerRef: ref }]);
    expect(state.dispatches[0]).toMatchObject({ state: "accepted" });
  });
});
