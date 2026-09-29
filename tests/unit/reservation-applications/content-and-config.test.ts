import { describe, expect, it } from "vitest";
import { readPublicApplicationConfig } from "@/lib/reservation-applications/config";
import {
  APPLICATION_CONSENT_CONTENT,
  isConsentContentReady,
} from "@/lib/reservation-applications/consent-content";

const completeEnv = {
  RESERVATION_APPLICATION_BANK_NAME: " 테스트은행 ",
  RESERVATION_APPLICATION_BANK_ACCOUNT_NUMBER: "000-0000-0000",
  RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER: "테스트예금주",
  YAHO_BLOG_URL: "https://blog.example.test/yaho",
  YAHO_INSTAGRAM_URL: "https://instagram.example.test/yaho",
  YAHO_KAKAO_CHANNEL_URL: "https://kakao.example.test/yaho",
};

describe("public application configuration", () => {
  it("reads and trims every value", () => {
    expect(readPublicApplicationConfig(completeEnv)).toEqual({
      bankName: "테스트은행",
      bankAccountNumber: "000-0000-0000",
      bankAccountHolder: "테스트예금주",
      blogUrl: "https://blog.example.test/yaho",
      instagramUrl: "https://instagram.example.test/yaho",
      kakaoChannelUrl: "https://kakao.example.test/yaho",
    });
  });

  it("fails closed when any value is missing, blank or not https", () => {
    expect(readPublicApplicationConfig({})).toBeNull();
    expect(readPublicApplicationConfig({ ...completeEnv, RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER: " " })).toBeNull();
    expect(readPublicApplicationConfig({ ...completeEnv, YAHO_BLOG_URL: "http://blog.example.test/yaho" })).toBeNull();
    expect(readPublicApplicationConfig({ ...completeEnv, YAHO_KAKAO_CHANNEL_URL: "not a url" })).toBeNull();
  });
});

describe("consent content", () => {
  const items = APPLICATION_CONSENT_CONTENT.items;
  const text = (key: string) => items.find((item) => item.key === key)?.body.join("\n") ?? "";

  it("separates program terms and legal guardian confirmation from privacy consent", () => {
    expect(items.map((item) => [item.key, item.required])).toEqual([
      ["programTerms", true],
      ["privacyConsent", true],
      ["legalGuardianConfirmation", true],
      ["photoShareConsent", false],
      ["photoMarketingConsent", false],
      ["refundTerms", true],
    ]);
  });

  it("uses a dated version and finalized (non-placeholder) text", () => {
    expect(APPLICATION_CONSENT_CONTENT.version).toMatch(/^\d{4}-\d{2}-\d{2}(-r\d+)?$/);
    expect(APPLICATION_CONSENT_CONTENT.version).not.toBe("2026-09-30");
    expect(APPLICATION_CONSENT_CONTENT.isPlaceholder).toBe(false);
  });

  it("lists exactly the collected application fields and fixed retention periods", () => {
    const privacy = text("privacyConsent");
    for (const field of ["아동 이름", "아동 생년월일", "아동 성별", "보호자 이름", "보호자 연락처", "아이와의 관계", "예약 요청사항"]) {
      expect(privacy).toContain(field);
    }
    expect(privacy).toContain("해당 수업일로부터 1년");
    expect(privacy).toContain("마지막 예약 수업일로부터 3년");
    expect(privacy).not.toContain("프로그램 이용일");
    expect(privacy).toContain("동의를 거부할 권리");
    const allText = items.flatMap((item) => item.body).join("\n");
    for (const indefinite of ["존속하는 기간", "사업이 유지되는 동안", "이의를 제기하지", "법적 책임을 묻지"]) {
      expect(allText).not.toContain(indefinite);
    }
  });

  it("describes photo sharing as optional and limited to participating guardians", () => {
    const share = text("photoShareConsent");
    expect(share).toContain("해당 수업에 참여한 아동의 보호자");
    expect(share).toContain("동의하지 않아도 프로그램 참가에 제한이 없습니다");
    expect(share).toContain("삭제할 수 없을 수 있습니다");
    const marketing = text("photoMarketingConsent");
    expect(marketing).toContain("새로운 홍보물에 사용하지 않습니다");
    expect(marketing).toContain("삭제하거나 비공개 처리합니다");
    expect(marketing).toContain("인쇄물은 회수가 어려울 수 있습니다");
    expect(marketing).toContain("제3자가 이미 저장하거나 공유한");
    expect(marketing).toContain("홍보 목적이 종료되면 추가로 활용하지 않습니다");
  });

  it("states the class-date refund schedule without weekday rules, automatic refunds or rescheduling", () => {
    const refund = text("refundTerms");
    expect(refund).toContain("수업일 7일 전까지 취소: 전액 환불");
    expect(refund).toContain("수업일 6일 전부터 4일 전까지 취소: 실제 결제금액(할인 반영 후)의 50% 환불");
    expect(refund).toContain("수업일 3일 전부터 수업 당일까지 취소: 환불 불가");
    expect(refund).toContain("모집 인원 미달");
    expect(refund).toContain("우천 등을 이유로 개별 취소하는 경우: 환불 불가");
    for (const forbidden of ["화요일", "수요일", "일정 변경", "천재지변", "자동"]) {
      expect(refund).not.toContain(forbidden);
    }
  });

  it("keeps Production closed while any decision is pending, even with finalized text", () => {
    expect(isConsentContentReady("production", { isPlaceholder: true, pendingDecisions: [] })).toBe(false);
    expect(isConsentContentReady("production", { isPlaceholder: false, pendingDecisions: ["환불"] })).toBe(false);
    expect(isConsentContentReady("production", { isPlaceholder: false, pendingDecisions: [] })).toBe(true);
    expect(isConsentContentReady(undefined, { isPlaceholder: false, pendingDecisions: ["환불"] })).toBe(true);
    expect(isConsentContentReady("production")).toBe(APPLICATION_CONSENT_CONTENT.pendingDecisions.length === 0);
  });
});
