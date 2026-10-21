import { describe, expect, it } from "vitest";
import { APPLICATION_STEPS, addChildDraft, consentScope, createChildDraft, emptyConfirmations, errorChildIndex, errorStep, expectedAmount, fieldElementId, reconcileAssignments, removeChildDraft, submissionChildren } from "@/lib/reservation-applications/application-draft";

describe("guardian memory-only draft", () => {
  it("defines exactly three input steps, with completion outside the wizard", () => {
    expect(APPLICATION_STEPS).toEqual(["클래스 선택", "보호자·자녀 정보", "동의·최종 확인"]);
  });
  it("starts unchecked with one child, enforces 1..10 bounds and rejects duplicate keys", () => {
    const first = [createChildDraft("a")];
    expect(removeChildDraft(first, "a")).toBe(first);
    expect(addChildDraft(first, createChildDraft("a"))).toBe(first);
    const ten = Array.from({ length: 10 }, (_, index) => createChildDraft(String(index)));
    expect(addChildDraft(ten, createChildDraft("eleven"))).toBe(ten);
    expect(Object.values(emptyConfirmations())).toEqual([false, false, false, false]);
    expect(first[0]).toMatchObject({ photoShareConsent: false, photoMarketingConsent: false });
  });
  it("middle-child removal retains other identities, inputs, assignments and optional choices", () => {
    const siblings = [createChildDraft("a", "x"), createChildDraft("b", "y"), { ...createChildDraft("c", "x"), childName: "합성 아이", photoMarketingConsent: true, requestNote: "합성 요청" }];
    const result = removeChildDraft(siblings, "b");
    expect(result.map((child) => child.draftId)).toEqual(["a", "c"]);
    expect(result[1]).toBe(siblings[2]);
    expect(fieldElementId("children.1.childName", result)).toBe("application-c-childName");
  });
  it("removed candidates invalidate only affected assignments, without auto reassignment", () => {
    const first = { ...createChildDraft("a", "x"), childName: "합성 자녀", photoShareConsent: true };
    const second = createChildDraft("b", "y");
    const result = reconcileAssignments([first, second], ["y"]);
    expect(result[0]).toEqual({ ...first, classScheduleId: "" });
    expect(result[1]).toBe(second);
  });
  it("totals actual children rather than candidate classes, and never turns missing prices into zero", () => {
    const prices = new Map([["x", 60_000], ["y", 40_000], ["unassigned", 99_000], ["legacy", null]]);
    const children = [createChildDraft("a", "x"), createChildDraft("b", "x"), createChildDraft("c", "y")];
    expect(expectedAmount(children, prices)).toBe(160_000);
    expect(expectedAmount([createChildDraft("d")], prices)).toBeNull();
    expect(expectedAmount([createChildDraft("d", "legacy")], prices)).toBeNull();
  });
  it("new child, removed child and new assignment all change required consent scope; optional consent remains independent", () => {
    const a = { ...createChildDraft("a", "x"), photoShareConsent: true };
    const b = createChildDraft("b", "x");
    expect(consentScope([a])).not.toBe(consentScope([a, b]));
    expect(consentScope([a, b])).not.toBe(consentScope([b]));
    expect(consentScope([a])).not.toBe(consentScope([{ ...a, classScheduleId: "y" }]));
    const required = { programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true };
    expect(submissionChildren([a, b], required)).toEqual([
      expect.objectContaining({ photoShareConsent: true, photoMarketingConsent: false, ...required }),
      expect.objectContaining({ photoShareConsent: false, photoMarketingConsent: false, ...required }),
    ]);
    expect(submissionChildren([a], required)[0]).not.toHaveProperty("draftId");
  });
  it("maps cross-step errors to bounded child identities and shared confirmation controls", () => {
    const children = [createChildDraft("stable")];
    expect(errorStep("classes")).toBe(1);
    expect(errorStep("guardianPhone")).toBe(2);
    expect(errorStep("children.0.childBirthDate")).toBe(2);
    expect(errorStep("children.0.privacyConsent")).toBe(3);
    expect(errorStep("reviewedPriceProof")).toBe(3);
    expect(errorChildIndex("children.10.childName")).toBeUndefined();
    expect(errorChildIndex("children.9.childName")).toBe(9);
    expect(fieldElementId("children.0.privacyConsent", children)).toBe("application-privacyConsent");
  });
});
