import { describe, expect, it } from "vitest";
import { formatSubmittedAt, renderTemplate, externalReadiness } from "@/lib/kakao/template";
import { submissionSelect, resolveDispatchContext } from "@/server/kakao/context-resolver";

describe("P3 template and context", () => {
  it("selects only submission metadata and formats the original instant in KST", () => {
    expect(submissionSelect).toEqual({ id: true, submittedAt: true, personalDataPurgedAt: true });
    expect(formatSubmittedAt(new Date("2026-10-28T00:00:59Z"))).toBe("2026-10-28 09:00");
    expect(() => formatSubmittedAt(new Date(NaN))).toThrow();
    expect(externalReadiness).toEqual({ profile: "unknown", template: "unknown", ready: false });
  });
  it("renders only the fixed version and a single variable, with no buttons", () => {
    const input = { templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } };
    expect(renderTemplate(input)).toBe("새 예약 신청이 접수되었습니다. 접수 시각: 2026-10-28 09:00. YAHO 관리자 화면에서 확인해주세요.");
    for (const bad of [{ ...input, buttons: [] }, { ...input, templateVersion: "other" }, { ...input, variables: {} }, { ...input, variables: { ...input.variables, extra: "x" } }, { ...input, variables: { 접수시각: "x".repeat(1001) } }]) expect(() => renderTemplate(bad)).toThrow();
  });
  it("fails closed for unsupported or missing source", () => {
    expect(resolveDispatchContext({ request: {}, submission: null, registration: null, target: null })).toEqual({ ok: false, reason: "unsupported_event" });
    const request = { event: "application.received", audience: "admin", entityId: "s1", dedupeKey: `application.received:${"a".repeat(64)}`, recipient: { id: "r1", version: "v1", userId: "u1" } };
    expect(resolveDispatchContext({ request, submission: null, registration: null, target: null })).toEqual({ ok: false, reason: "entity_unavailable" });
    expect(resolveDispatchContext({ request, submission: { id: "s1", submittedAt: new Date(), personalDataPurgedAt: new Date() }, registration: null, target: null })).toEqual({ ok: false, reason: "entity_unavailable" });
  });
});
