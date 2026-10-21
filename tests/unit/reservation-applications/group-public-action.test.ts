import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";

const linkLookup = vi.fn();
const companionLookup = vi.fn();
const submitCore = vi.fn();
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
vi.mock("@/server/reservation-applications/groups", () => ({ submitApplicationGroupCore: (...args: unknown[]) => submitCore(...args) }));
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

const { submitApplicationGroup, submitApplicationGroupWithCompanion } = await import("@/app/(public)/apply/group/[token]/actions");

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
