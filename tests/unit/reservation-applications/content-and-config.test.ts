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
  it("defines the three application consents with the required flags", () => {
    expect(APPLICATION_CONSENT_CONTENT.items.map((item) => [item.key, item.required])).toEqual([
      ["privacyConsent", true],
      ["photoShareConsent", true],
      ["photoMarketingConsent", false],
    ]);
  });

  it("blocks Production while the text is a placeholder and allows it once finalized", () => {
    expect(isConsentContentReady("production", { isPlaceholder: true })).toBe(false);
    expect(isConsentContentReady("production", { isPlaceholder: false })).toBe(true);
    expect(isConsentContentReady(undefined, { isPlaceholder: true })).toBe(true);
    expect(isConsentContentReady("preview", { isPlaceholder: true })).toBe(true);
  });
});
