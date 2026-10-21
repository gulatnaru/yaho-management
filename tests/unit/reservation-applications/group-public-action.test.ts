import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";

const linkLookup = vi.fn();
const companionLookup = vi.fn();
const submitCore = vi.fn();
const recheckCore = vi.fn();
const cookieSet = vi.fn();
const consentReady = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: {
  reservationApplicationLink: { findFirst: (...args: unknown[]) => linkLookup(...args) },
  companionInvite: { findFirst: (...args: unknown[]) => companionLookup(...args) },
} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: cookieSet }), headers: vi.fn() }));
vi.mock("@/lib/reservation-applications/consent-content", async (original) => ({
  ...await original<typeof import("@/lib/reservation-applications/consent-content")>(),
  isConsentContentReady: () => consentReady(),
}));
vi.mock("@/server/reservation-applications/groups", () => ({ submitApplicationGroupCore: (...args: unknown[]) => submitCore(...args), recheckApplicationGroupPricesCore: (...args: unknown[]) => recheckCore(...args) }));
vi.mock("@/server/reservation-applications/settings", () => ({
  getReservationApplicationSettings: vi.fn().mockResolvedValue({}),
  isReservationApplicationSettingsReady: () => true,
}));
vi.mock("@/lib/e2e/phase20-lease", () => ({
  PHASE20_PREVIEW_HEADER: "x-test-preview",
  parseAndVerifySignedPreviewRun: vi.fn(),
  hasActivePhase20PreviewLease: vi.fn(),
}));
vi.mock("@/lib/e2e/preview-manual-session", () => ({ resolvePreviewApplyAccess: vi.fn() }));

const { submitApplicationGroup, submitApplicationGroupWithCompanion, recheckApplicationGroupPrices } = await import("@/app/(public)/apply/group/[token]/actions");

const { ApplicationPriceReviewExpiredError, ApplicationAlreadySubmittedError } = await import("@/server/reservation-applications/price-review");
const { ApplicationClosedError } = await import("@/lib/reservation-applications/errors");

const requiredConsents = {
  programTerms: "프로그램 안전 및 이용사항을 확인해주세요",
  privacyConsent: "개인정보 수집·이용에 동의해주세요",
  legalGuardianConfirmation: "법정대리인 확인에 동의해주세요",
  refundTerms: "취소 및 환불규정을 확인해주세요",
} as const;

function child(overrides: Record<string, unknown> = {}) {
  return {
    classScheduleId: "synthetic-class-1", childName: "합성 아이", childBirthDate: "2019-05-01", childGender: "FEMALE",
    requestNote: "합성 요청사항", programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
    photoShareConsent: false, photoMarketingConsent: false, ...overrides,
  };
}

function form(children = [child()]) {
  const data = new FormData();
  data.set("payload", JSON.stringify({
    reviewedPriceProof: "signed-review", consentVersion: APPLICATION_CONSENT_CONTENT.version, guardianName: "합성 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자", children,
  }));
  return data;
}

describe("group application consent validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "development");
    consentReady.mockReturnValue(true);
    linkLookup.mockResolvedValue(null);
    companionLookup.mockResolvedValue(null);
    submitCore.mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const [key, message] of Object.entries(requiredConsents)) {
    it.each([false, undefined])(`shows the specific error for ${key} = %s without saving`, async (value) => {
      const state = await submitApplicationGroup("test-token", {}, form([child({ [key]: value })]));
      expect(state).toEqual({ error: "아이별 필수 확인·동의 항목을 확인해주세요.", consentErrors: { 0: { [key]: message } }, fieldErrors: { [`children.0.${key}`]: message } });
      expect(linkLookup).not.toHaveBeenCalled();
      expect(submitCore).not.toHaveBeenCalled();
      expect(cookieSet).not.toHaveBeenCalled();
    });
  }

  it("returns all missing required consents for each child with safe messages only", async () => {
    const missing = { programTerms: undefined, privacyConsent: undefined, legalGuardianConfirmation: undefined, refundTerms: undefined };
    const state = await submitApplicationGroup("test-token", {}, form([child(missing), child(missing)]));
    expect(state.consentErrors).toEqual({ 0: requiredConsents, 1: requiredConsents });
    expect(Object.keys(state).sort()).toEqual(["consentErrors", "error", "fieldErrors"]);
    expect(submitCore).not.toHaveBeenCalled();
  });

  it("associates an invalid second child's consent with that child on companion submissions", async () => {
    const state = await submitApplicationGroupWithCompanion(undefined, "companion-token", {}, form([child(), child({ privacyConsent: "untrusted-value" })]));
    expect(state.consentErrors).toEqual({ 1: { privacyConsent: requiredConsents.privacyConsent } });
    expect(JSON.stringify(state)).not.toContain("untrusted-value");
    expect(companionLookup).not.toHaveBeenCalled();
    expect(submitCore).not.toHaveBeenCalled();
  });

  it("accepts optional photo consents left unchecked and allows a corrected resubmission", async () => {
    const invalid = await submitApplicationGroup("test-token", {}, form([child({ privacyConsent: false })]));
    const corrected = await submitApplicationGroup("test-token", invalid, form());
    expect(corrected).toEqual({ submitted: true });
    expect(submitCore).toHaveBeenCalledTimes(1);
    expect(submitCore.mock.calls[0]?.[1]).toMatchObject({
      consentVersion: APPLICATION_CONSENT_CONTENT.version,
      data: { children: [child()] },
    });
    expect(cookieSet).toHaveBeenCalledTimes(2);
  });

  it.each([40000, 65000])("expired proof returns recoverable current price %i without closed or any new cookie", async (amount) => {
    const priceReview = { proof: "same-operation-renewed", prices: [{ classScheduleId: "synthetic-class-1", amount }] };
    submitCore.mockRejectedValue(new ApplicationPriceReviewExpiredError(priceReview));
    const state = await submitApplicationGroup("test-token", {}, form());
    expect(state).toMatchObject({ priceReviewExpired: true, priceReview });
    expect(state.error).toContain("확인 시간이 만료");
    expect(state.closed).toBeUndefined(); expect(state.resultUnknown).toBeUndefined(); expect(cookieSet).not.toHaveBeenCalled();
  });
  it("expired unchanged recheck exposes the explicit reconfirmation flag and the renewed review", async () => {
    const priceReview = { proof: "same-operation-renewed", prices: [{ classScheduleId: "synthetic-class-1", amount: 40000 }] };
    recheckCore.mockResolvedValue({ ...priceReview, priceReviewExpired: true });
    expect(await recheckApplicationGroupPrices("test-token", undefined, { classScheduleIds: ["synthetic-class-1"], reviewedPriceProof: "expired" })).toEqual({ priceReview, priceReviewExpired: true });
    expect(submitCore).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
  });
  it("an already-saved operation during recheck preserves result-check recovery and never returns prices or completion access", async () => {
    recheckCore.mockRejectedValue(new ApplicationAlreadySubmittedError());
    const state = await recheckApplicationGroupPrices("test-token", undefined, { classScheduleIds: ["synthetic-class-1"], reviewedPriceProof: "expired" });
    expect(state).toMatchObject({ resultUnknown: true }); expect(state.closed).toBeUndefined(); expect(state.priceReview).toBeUndefined(); expect(cookieSet).not.toHaveBeenCalled();
  });
  it("an expired saved-operation submit keeps the existing result-check response or authorized replay", async () => {
    submitCore.mockRejectedValueOnce(new ApplicationAlreadySubmittedError()).mockResolvedValueOnce({ replayed: true });
    const unknown = await submitApplicationGroup("test-token", {}, form());
    expect(unknown).toMatchObject({ resultUnknown: true }); expect(unknown.closed).toBeUndefined(); expect(unknown.priceReview).toBeUndefined();
    expect(await submitApplicationGroup("test-token", {}, form())).toEqual({ submitted: true }); expect(cookieSet).not.toHaveBeenCalled();
  });
  it.each(["invalid signature", "scope mismatch", "revoked link"])("%s during recovery gives only a generic closed response", async () => {
    submitCore.mockRejectedValue(new ApplicationClosedError()); recheckCore.mockRejectedValue(new ApplicationClosedError());
    const submitted = await submitApplicationGroup("test-token", {}, form());
    const rechecked = await recheckApplicationGroupPrices("test-token", undefined, { classScheduleIds: ["synthetic-class-1"], reviewedPriceProof: "untrusted" });
    for (const state of [submitted, rechecked]) expect(state).toEqual({ closed: true, error: "현재 신청을 받을 수 없습니다." });
    expect(JSON.stringify([submitted, rechecked])).not.toMatch(/합성|amount|proof|prices/); expect(cookieSet).not.toHaveBeenCalled();
  });
  it("unavailable public permission rejects recheck before reading current prices", async () => {
    consentReady.mockReturnValue(false);
    expect(await recheckApplicationGroupPrices("test-token", undefined, { classScheduleIds: ["synthetic-class-1"], reviewedPriceProof: "expired" })).toEqual({ closed: true, error: "현재 신청을 받을 수 없습니다." });
    expect(recheckCore).not.toHaveBeenCalled(); expect(cookieSet).not.toHaveBeenCalled();
  });

  it.each(["honeypot", "unready consent content"])("keeps %s failures generic before returning field errors", async (gate) => {
    const data = form([child({ privacyConsent: false })]);
    if (gate === "honeypot") data.set("website", "https://spam.example");
    else consentReady.mockReturnValue(false);
    expect(await submitApplicationGroup("test-token", {}, data)).toEqual({ error: "입력 내용을 다시 확인해주세요." });
    expect(linkLookup).not.toHaveBeenCalled();
    expect(submitCore).not.toHaveBeenCalled();
  });

  it("keeps malformed payload and unrelated validation errors generic", async () => {
    const malformed = new FormData();
    malformed.set("payload", "{");
    expect(await submitApplicationGroup("test-token", {}, malformed)).toEqual({ error: "입력 내용을 다시 확인해주세요." });
    expect(await submitApplicationGroup("test-token", {}, form([child({ childName: "" })]))).toMatchObject({ error: "입력 내용을 다시 확인해주세요.", fieldErrors: { "children.0.childName": "아이 이름을 입력해주세요" } });
    expect(submitCore).not.toHaveBeenCalled();
  });
});
