import { describe, expect, it } from "vitest";
import { mapApplicationFieldErrors, mapLegacyApplicationFieldErrors } from "@/lib/reservation-applications/field-errors";

describe("public field error allowlist", () => {
  it("maps guardian and bounded child paths to fixed messages", () => {
    expect(mapApplicationFieldErrors([{ path: ["guardianName"] }, { path: ["children", 0, "childName"] }, { path: ["children", 9, "privacyConsent"] }, { path: ["reviewedPriceProof"] }])).toEqual({ guardianName: "보호자 이름을 입력해주세요", "children.0.childName": "아이 이름을 입력해주세요", "children.9.privacyConsent": "개인정보 수집·이용에 동의해주세요", reviewedPriceProof: "최신 신청 금액을 다시 확인해주세요" });
  });
  it("drops internal, forged, deep and out-of-range paths", () => {
    expect(mapApplicationFieldErrors([{ path: ["token"] }, { path: ["children", -1, "childName"] }, { path: ["children", 10, "childName"] }, { path: ["children", 0.5, "childName"] }, { path: ["children", "0", "childName"] }, { path: ["children", 0, "childName", "secret"] }, { path: ["children", 0, "photoShareConsent"] }, { path: ["children", 0, "photoMarketingConsent"] }, { path: ["__proto__"] }])).toEqual({});
  });
  it("uses the same fixed allowlist for flat legacy fields without disclosing optional non-consent as errors", () => {
    expect(mapLegacyApplicationFieldErrors([{ path: ["childName"] }, { path: ["guardianPhone"] }, { path: ["programTerms"] }, { path: ["photoShareConsent"] }, { path: ["token"] }])).toEqual({ childName: "아이 이름을 입력해주세요", guardianPhone: "전화번호 형식을 확인해주세요", programTerms: "프로그램 안전 및 이용사항을 확인해주세요" });
  });
  it("never passes supplied validator messages or input through", () => {
    const issue = { path: ["guardianPhone"], message: "PRIVATE VALUE / database table / raw token" };
    const result = mapApplicationFieldErrors([issue]);
    expect(result).toEqual({ guardianPhone: "전화번호 형식을 확인해주세요" });
    expect(JSON.stringify(result)).not.toContain(issue.message);
  });
});
