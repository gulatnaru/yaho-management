import { describe, expect, it } from "vitest";
import { evaluateSendGate, isExplicitSendDisabled, REAL_POLICY, realPolicySchema } from "@/lib/kakao/send-config";
import { DAY_REQUEST_MAX, MONTH_MESSAGE_MAX, MONTH_REQUEST_MAX, MONTH_TOTAL_MAX, REAL_QUOTE, SEND_MAX } from "@/server/kakao/budget";

const config = { mode: "live", enabled: true, provider: "solapi", environment: "preview" };
const runtime = { blocked: false, environment: "preview", provider: "solapi", activationEpoch: new Date("2026-10-28T00:00:00Z") };
const mockPolicy = { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null };
const occurredAt = new Date("2026-10-28T00:00:00Z");

describe("realPolicySchema", () => {
  it("parses REAL_POLICY and rejects the mock policy", () => {
    expect(realPolicySchema.safeParse(REAL_POLICY).success).toBe(true);
    expect(realPolicySchema.parse(REAL_POLICY)).toEqual(REAL_POLICY);
    expect(realPolicySchema.safeParse(mockPolicy).success).toBe(false);
  });
  it.each([
    { mode: "single_synthetic_only" },
    { mode: "live" },
    { activeEnvironment: "production" },
    { otherEnvironmentActive: true },
    { arrangement: "unresolved" },
    { previewAllocation: null },
    { previewAllocation: { ...REAL_POLICY.previewAllocation, dayRequestMax: 21 } },
    { previewAllocation: { ...REAL_POLICY.previewAllocation, monthRequestMax: 201 } },
    { previewAllocation: { ...REAL_POLICY.previewAllocation, monthMessageMilliKrw: 3_000_001 } },
    { previewAllocation: { ...REAL_POLICY.previewAllocation, monthTotalMilliKrw: 5_000_001 } },
    { previewAllocation: { ...REAL_POLICY.previewAllocation, extra: 1 } },
    { productionAllocation: {} },
    { extra: true },
  ])("fails closed: %s", (change) => {
    expect(realPolicySchema.safeParse({ ...REAL_POLICY, ...change }).success).toBe(false);
  });
});

describe("evaluateSendGate with the mock/real policy union", () => {
  it("still allows the mock policy and allows REAL_POLICY with matching runtime", () => {
    expect(evaluateSendGate({ config, runtime, policy: mockPolicy, occurredAt })).toEqual({ allowed: true, reason: "allowed" });
    expect(evaluateSendGate({ config, runtime, policy: REAL_POLICY, occurredAt })).toEqual({ allowed: true, reason: "allowed" });
  });
  it("rejects the real policy when the runtime is blocked", () => {
    expect(evaluateSendGate({ config, runtime: { ...runtime, blocked: true }, policy: REAL_POLICY, occurredAt })).toEqual({ allowed: false, reason: "blocked" });
  });
  it("rejects the real policy before activation and when sending is disabled", () => {
    expect(evaluateSendGate({ config, runtime, policy: REAL_POLICY, occurredAt: new Date("2026-10-27T23:59:59Z") })).toEqual({ allowed: false, reason: "before_activation" });
    expect(evaluateSendGate({ config: { ...config, mode: "dry-run" }, runtime, policy: REAL_POLICY, occurredAt })).toEqual({ allowed: false, reason: "send_disabled" });
    expect(evaluateSendGate({ config, runtime, policy: { ...REAL_POLICY, mode: "single_synthetic_only" }, occurredAt })).toEqual({ allowed: false, reason: "invalid_config" });
  });
});

describe("isExplicitSendDisabled with the mock/real policy union", () => {
  it("treats dry-run or disabled config as explicitly disabled under either policy", () => {
    expect(isExplicitSendDisabled({ ...config, mode: "dry-run" }, REAL_POLICY)).toBe(true);
    expect(isExplicitSendDisabled({ ...config, enabled: false }, REAL_POLICY)).toBe(true);
    expect(isExplicitSendDisabled({ ...config, mode: "dry-run" }, mockPolicy)).toBe(true);
    expect(isExplicitSendDisabled(config, REAL_POLICY)).toBe(false);
    expect(isExplicitSendDisabled(config, mockPolicy)).toBe(false);
  });
  it("returns false for an unparseable policy", () => {
    expect(isExplicitSendDisabled({ ...config, mode: "dry-run" }, { ...REAL_POLICY, mode: "live" })).toBe(false);
  });
});

describe("REAL_POLICY and REAL_QUOTE literals match the G1 budget constants", () => {
  it("reuses the approved allocation limits", () => {
    expect(REAL_POLICY.previewAllocation.dayRequestMax).toBe(DAY_REQUEST_MAX);
    expect(REAL_POLICY.previewAllocation.monthRequestMax).toBe(MONTH_REQUEST_MAX);
    expect(REAL_POLICY.previewAllocation.monthMessageMilliKrw).toBe(MONTH_MESSAGE_MAX);
    expect(REAL_POLICY.previewAllocation.monthTotalMilliKrw).toBe(MONTH_TOTAL_MAX);
    expect(REAL_POLICY.previewAllocation).toEqual({ dayRequestMax: 20, monthRequestMax: 200, monthMessageMilliKrw: 3_000_000, monthTotalMilliKrw: 5_000_000 });
    expect(REAL_POLICY.productionAllocation).toBeNull();
  });
  it("reuses the approved quote amounts", () => {
    expect(REAL_QUOTE).toEqual({ send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true });
    expect(REAL_QUOTE.send).toBe(SEND_MAX);
    expect(REAL_QUOTE.lookup).toBe(500);
  });
});
