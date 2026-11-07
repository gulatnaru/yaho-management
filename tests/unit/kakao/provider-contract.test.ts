import { describe, expect, it } from "vitest";
import { buildDedupeKey } from "@/lib/kakao/notify";
import { dispatchContextSchema, dispatchPermitSchema, normalizeProviderResult, providerRefSchema, renderedBodySchema, syntheticTemplateContentSchema, sendErrorCodeSchema, sendSkipCodeSchema } from "@/lib/kakao/send-contract";
import { MockProvider } from "@/lib/kakao/providers/mock";

const ref = `g2ref_${"a".repeat(32)}`;
const context = { event: "application.received", audience: "admin", dedupeKey: buildDedupeKey("application.received", "synthetic", "created"), recipientId: "recipient_1", recipientVersion: "v1", submittedAt: new Date("2026-10-28T00:00:00Z"), templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } };
const permit = { dispatchId: "dispatch_1", slotId: "slot_1", claimToken: "claim_1", providerId: "solapi", context };
describe("D-01 strict context", () => {
  it("binds the fixed template and initial instant to its sole KST variable", () => {
    expect(dispatchContextSchema.safeParse(context).success).toBe(true);
    for (const change of [{ submittedAt: new Date("invalid") }, { variables: {} }, { variables: { ...context.variables, extra: "x" } }, { variables: { 접수시각: "2026-10-28 00:00" } }, { templateVersion: "other" }, { buttons: [] }, { event: "application.changed" }]) expect(dispatchContextSchema.safeParse({ ...context, ...change }).success).toBe(false);
    expect(dispatchPermitSchema.safeParse({ ...permit, extra: "x" }).success).toBe(false);
    const body = "새 예약 신청이 접수되었습니다. 접수 시각: 2026-10-28 09:00. YAHO 관리자 화면에서 확인해주세요.";
    expect(syntheticTemplateContentSchema.safeParse({ context, body }).success).toBe(true);
    expect(syntheticTemplateContentSchema.safeParse({ context, body: `${body} extra` }).success).toBe(false);
    expect(syntheticTemplateContentSchema.safeParse({ context, body, buttons: [] }).success).toBe(false);
  });
  it("measures body length in Unicode code points", () => { expect(renderedBodySchema.safeParse("😀".repeat(1000)).success).toBe(true); expect(renderedBodySchema.safeParse("😀".repeat(1001)).success).toBe(false); expect(renderedBodySchema.safeParse("").success).toBe(false); });
});
describe("D-02 mock results", () => {
  it.each([ref.slice(0, -1), ref + "a", ref.toUpperCase(), ` ${ref}`, "group_ref", "g2ref_private"]) ("rejects invalid ref %s", (value) => { expect(providerRefSchema.safeParse(value).success).toBe(false); });
  it("requires strict message-level ref and converts invalid outcomes to unknown", () => {
    expect(providerRefSchema.safeParse(ref).success).toBe(true);
    for (const result of [{ status: "accepted", providerId: "solapi" }, { status: "accepted", providerId: "solapi", ref, groupRef: ref }, { status: "other" }, { status: "unknown", raw: "private" }]) expect(normalizeProviderResult(result)).toEqual({ status: "unknown" });
    expect(sendErrorCodeSchema.safeParse("provider_result_unknown").success).toBe(true); expect(sendErrorCodeSchema.safeParse("raw error").success).toBe(false);
    expect(sendSkipCodeSchema.safeParse("before_activation").success).toBe(true); expect(sendSkipCodeSchema.safeParse("private").success).toBe(false);
  });
  it.each([
    [{ code: "S_ACCEPTED", ref }, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }],
    [{ code: "S_PENDING", accepted: true, ref }, { status: "accepted", providerId: "solapi", ref, phase: "awaiting_final" }],
    [{ code: "S_PENDING", accepted: false }, { status: "unknown" }],
    [{ code: "S_REJECT_TEMP", nonBillableEvidence: true }, { status: "definite_rejection", retryable: true, nonBillableEvidence: true }],
    [{ code: "S_REJECT_PERM", nonBillableEvidence: false }, { status: "definite_rejection", retryable: false, nonBillableEvidence: false }],
    [{ code: "S_ACCEPTED" }, { status: "unknown" }], [{ code: "S_UNKNOWN" }, { status: "unknown" }], [{ code: "S_THROW" }, { status: "unknown" }], [{ code: "S_TIMEOUT" }, { status: "unknown" }], [{ code: "unrecognized" }, { status: "unknown" }],
  ])("classifies synthetic fixtures", async (fixture, result) => { expect(await new MockProvider(fixture).send(permit)).toEqual(result); });
  it("contains failures and rejects malformed permits", async () => {
    const provider = new MockProvider({ code: "S_THROW" });
    expect(await provider.send(permit)).toEqual({ status: "unknown" });
    expect(await new MockProvider({ code: "S_ACCEPTED", ref }).send({ ...permit, context: { ...context, buttons: [] } })).toEqual({ status: "unknown" });
  });
});
