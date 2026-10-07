import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_CLOSED_MESSAGE,
  APPLICATION_RETRY_MESSAGE,
} from "@/lib/reservation-applications/constants";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { ApplicationClosedError, ApplicationRateLimitedError } from "@/lib/reservation-applications/errors";

const submitCoreMock = vi.fn();
const redirectMock = vi.fn((destination: string) => {
  throw new Error(`REDIRECT:${destination}`);
});

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ redirect: (destination: string) => redirectMock(destination) }));
vi.mock("@/server/reservation-applications/submit", () => ({
  submitReservationApplicationCore: (...args: unknown[]) => submitCoreMock(...args),
}));
vi.mock("@/lib/reservation-applications/runtime", () => ({
  buildLegacyApplicationAvailabilityContext: vi.fn().mockResolvedValue({ configReady: true, consentReady: true, environmentAllowed: true }),
}));

const { submitReservationApplication } = await import("@/app/(public)/apply/[token]/actions");

const TOKEN = "t".repeat(32);
// 합성 테스트 데이터(실제 개인정보 아님). 로그에 이 값이 남는지 검사한다.
const CHILD_NAME = "테스트아이";
const GUARDIAN_PHONE = "010-0000-0000";

function formData(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    childName: CHILD_NAME,
    childBirthDate: "2019-05-01",
    childGender: "MALE",
    guardianName: "테스트보호자",
    guardianPhone: GUARDIAN_PHONE,
    guardianRelationship: "FATHER",
    requestNote: "",
    programTerms: "on",
    privacyConsent: "on",
    legalGuardianConfirmation: "on",
    photoShareConsent: null,
    photoMarketingConsent: null,
    refundTerms: "on",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) data.set(key, value);
  }
  return data;
}

describe("submitReservationApplication (public action)", () => {
  beforeEach(() => {
    submitCoreMock.mockReset();
    redirectMock.mockClear();
  });

  it("drops bot submissions that fill the hidden field", async () => {
    const state = await submitReservationApplication(TOKEN, {}, formData({ website: "https://spam.example" }));

    expect(state.formError).toBe(APPLICATION_RETRY_MESSAGE);
    expect(submitCoreMock).not.toHaveBeenCalled();
  });

  it("returns field errors and keeps the typed values, including consent checkboxes", async () => {
    const state = await submitReservationApplication(
      TOKEN,
      {},
      formData({
        guardianPhone: "abc",
        guardianRelationship: null,
        legalGuardianConfirmation: null,
        refundTerms: null,
        photoShareConsent: "on",
        photoMarketingConsent: "on",
      }),
    );

    expect(state.errors?.guardianPhone?.[0]).toBeDefined();
    expect(state.errors?.guardianRelationship?.[0]).toBe("아이와의 관계를 선택해주세요");
    expect(state.errors?.legalGuardianConfirmation?.[0]).toBe("법정대리인 확인에 동의해주세요");
    expect(state.errors?.refundTerms?.[0]).toBe("취소 및 환불규정을 확인해주세요");
    expect(state.errors?.photoShareConsent).toBeUndefined();
    expect(state.submitted).toBeUndefined();
    expect(state.values).toMatchObject({
      childName: CHILD_NAME,
      guardianPhone: "abc",
      programTerms: true,
      privacyConsent: true,
      legalGuardianConfirmation: false,
      photoShareConsent: true,
      photoMarketingConsent: true,
      refundTerms: false,
    });
    expect(submitCoreMock).not.toHaveBeenCalled();
  });

  it("shows the generic closed message when the link closed after the page loaded", async () => {
    submitCoreMock.mockRejectedValueOnce(new ApplicationClosedError());

    const state = await submitReservationApplication(TOKEN, {}, formData());

    expect(state.formError).toBe(APPLICATION_CLOSED_MESSAGE);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("asks the guardian to retry later when rate limited", async () => {
    submitCoreMock.mockRejectedValueOnce(new ApplicationRateLimitedError());

    const state = await submitReservationApplication(TOKEN, {}, formData());

    expect(state.formError).toBe(APPLICATION_RETRY_MESSAGE);
  });

  it.each<[string, () => void]>([
    ["closed link", () => submitCoreMock.mockRejectedValueOnce(new ApplicationClosedError())],
    ["rate limit", () => submitCoreMock.mockRejectedValueOnce(new ApplicationRateLimitedError())],
    ["save failure", () => submitCoreMock.mockRejectedValueOnce(new Error("insert failed"))],
  ])("keeps the typed values and does not mark success on a %s", async (_label, arrange) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();

    const state = await submitReservationApplication(
      TOKEN,
      {},
      formData({ requestNote: "합성 요청사항", photoMarketingConsent: "on" }),
    );

    expect(state.submitted).toBeUndefined();
    expect(state.formError).toEqual(expect.any(String));
    expect(state.values).toEqual({
      childName: CHILD_NAME,
      childBirthDate: "2019-05-01",
      childGender: "MALE",
      guardianName: "테스트보호자",
      guardianPhone: GUARDIAN_PHONE,
      guardianRelationship: "FATHER",
      requestNote: "합성 요청사항",
      programTerms: true,
      privacyConsent: true,
      legalGuardianConfirmation: true,
      photoShareConsent: false,
      photoMarketingConsent: true,
      refundTerms: true,
    });
    expect(redirectMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs unexpected failures without personal data", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    submitCoreMock.mockRejectedValueOnce(new Error(`insert failed for ${CHILD_NAME} ${GUARDIAN_PHONE}`));

    const state = await submitReservationApplication(TOKEN, {}, formData());

    expect(state.formError).toBe("신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(CHILD_NAME);
    expect(logged).not.toContain(GUARDIAN_PHONE);
    consoleError.mockRestore();
  });

  it("saves through the core and returns only a non-sensitive success state instead of redirecting", async () => {
    submitCoreMock.mockResolvedValueOnce({ id: "application-1" });

    const state = await submitReservationApplication(TOKEN, {}, formData({ requestNote: "합성 요청사항" }));

    // 성공 상태는 Server Action 응답(RSC)으로 브라우저에 전달되므로 입력값·개인정보·신청 id 를 담지 않는다.
    expect(state).toEqual({ submitted: true });
    const serialized = JSON.stringify(state);
    for (const personal of [CHILD_NAME, GUARDIAN_PHONE, "테스트보호자", "2019-05-01", "합성 요청사항", "application-1"]) {
      expect(serialized).not.toContain(personal);
    }
    // 클라이언트 전환(redirect)은 이전 신청 페이지 payload 를 완료 화면 문서에 남기므로 쓰지 않는다.
    expect(redirectMock).not.toHaveBeenCalled();

    expect(submitCoreMock).toHaveBeenCalledTimes(1);
    const [, input] = submitCoreMock.mock.calls[0] as [unknown, { token: string; consentVersion: string; data: unknown }];
    expect(input.token).toBe(TOKEN);
    expect(typeof input.consentVersion).toBe("string");
    expect(input.consentVersion).toBe(APPLICATION_CONSENT_CONTENT.version);
    expect(input.data).toMatchObject({
      childName: CHILD_NAME,
      guardianRelationship: "FATHER",
      programTerms: true,
      privacyConsent: true,
      legalGuardianConfirmation: true,
      photoShareConsent: false,
      photoMarketingConsent: false,
      refundTerms: true,
    });
  });
});
