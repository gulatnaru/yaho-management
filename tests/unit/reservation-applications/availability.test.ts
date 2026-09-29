import { describe, expect, it } from "vitest";
import {
  canIssueApplicationLink,
  getApplicationLinkAdminState,
  isApplicationLinkOpen,
  isPublicApplicationEnvironment,
  type ApplicationAvailabilityContext,
} from "@/lib/reservation-applications/availability";
import { buildApplicationAvailabilityContext } from "@/lib/reservation-applications/runtime";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const context: ApplicationAvailabilityContext = {
  now: NOW,
  environmentAllowed: true,
  configReady: true,
  consentReady: true,
};
const futureClass = { status: "SCHEDULED" as const, startsAt: new Date("2026-10-02T01:00:00.000Z") };
const openLink = { isActive: true, classSchedule: futureClass };

const completeEnv = {
  RESERVATION_APPLICATION_BANK_NAME: "테스트은행",
  RESERVATION_APPLICATION_BANK_ACCOUNT_NUMBER: "000-0000-0000",
  RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER: "테스트예금주",
  YAHO_BLOG_URL: "https://blog.example.test/yaho",
  YAHO_INSTAGRAM_URL: "https://instagram.example.test/yaho",
  YAHO_KAKAO_CHANNEL_URL: "https://kakao.example.test/yaho",
};

describe("public application environment", () => {
  it("allows Production and local runs, but never Preview", () => {
    expect(isPublicApplicationEnvironment(undefined)).toBe(true);
    expect(isPublicApplicationEnvironment("production")).toBe(true);
    expect(isPublicApplicationEnvironment("preview")).toBe(false);
    expect(isPublicApplicationEnvironment("development")).toBe(false);
  });
});

describe("isApplicationLinkOpen", () => {
  it("accepts an active link for a scheduled class that has not started", () => {
    expect(isApplicationLinkOpen(openLink, context)).toBe(true);
  });

  it("closes for missing, stopped, cancelled or started classes", () => {
    expect(isApplicationLinkOpen(null, context)).toBe(false);
    expect(isApplicationLinkOpen({ ...openLink, isActive: false }, context)).toBe(false);
    expect(
      isApplicationLinkOpen({ isActive: true, classSchedule: { ...futureClass, status: "CANCELLED" } }, context),
    ).toBe(false);
    expect(isApplicationLinkOpen({ isActive: true, classSchedule: { ...futureClass, startsAt: NOW } }, context)).toBe(
      false,
    );
  });

  it("closes when the runtime is not ready", () => {
    expect(isApplicationLinkOpen(openLink, { ...context, environmentAllowed: false })).toBe(false);
    expect(isApplicationLinkOpen(openLink, { ...context, configReady: false })).toBe(false);
    expect(isApplicationLinkOpen(openLink, { ...context, consentReady: false })).toBe(false);
  });
});

describe("admin link state", () => {
  it("reports class closure before link state", () => {
    expect(getApplicationLinkAdminState(null, { ...futureClass, status: "CANCELLED" }, context)).toBe(
      "CLASS_CANCELLED",
    );
    expect(getApplicationLinkAdminState({ isActive: true }, { ...futureClass, startsAt: NOW }, context)).toBe(
      "CLASS_STARTED",
    );
  });

  it("distinguishes none, stopped, open and runtime problems", () => {
    expect(getApplicationLinkAdminState(null, futureClass, context)).toBe("NONE");
    expect(getApplicationLinkAdminState({ isActive: false }, futureClass, context)).toBe("STOPPED");
    expect(getApplicationLinkAdminState({ isActive: true }, futureClass, context)).toBe("OPEN");
    expect(getApplicationLinkAdminState({ isActive: true }, futureClass, { ...context, configReady: false })).toBe(
      "RUNTIME_NOT_READY",
    );
  });

  it("only issues links for scheduled classes that have not started", () => {
    expect(canIssueApplicationLink(futureClass, NOW)).toBe(true);
    expect(canIssueApplicationLink({ ...futureClass, status: "CANCELLED" }, NOW)).toBe(false);
    expect(canIssueApplicationLink({ ...futureClass, startsAt: NOW }, NOW)).toBe(false);
  });
});

describe("buildApplicationAvailabilityContext", () => {
  it("is ready locally with complete configuration", () => {
    expect(buildApplicationAvailabilityContext(NOW, completeEnv)).toEqual({
      now: NOW,
      environmentAllowed: true,
      configReady: true,
      consentReady: true,
    });
  });

  it("opens Production once the finalized consent text has no pending decisions and config is complete", () => {
    const productionContext = buildApplicationAvailabilityContext(NOW, { ...completeEnv, VERCEL_ENV: "production" });
    expect(productionContext).toEqual({ now: NOW, environmentAllowed: true, configReady: true, consentReady: true });
  });

  it("keeps Production closed without the deposit/channel configuration", () => {
    expect(buildApplicationAvailabilityContext(NOW, { VERCEL_ENV: "production" }).configReady).toBe(false);
  });

  it("closes Preview and incomplete configuration", () => {
    expect(buildApplicationAvailabilityContext(NOW, { ...completeEnv, VERCEL_ENV: "preview" }).environmentAllowed).toBe(
      false,
    );
    expect(buildApplicationAvailabilityContext(NOW, {}).configReady).toBe(false);
  });
});
