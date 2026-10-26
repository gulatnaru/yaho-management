import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationProvider } from "@/lib/kakao/notify";
import { buildDedupeKey } from "@/lib/kakao/notify";
import { emitReservationEvent } from "@/lib/kakao/events";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";
import { ApplicationAlreadySubmittedError, ApplicationPriceChangedError, ApplicationPriceReviewExpiredError } from "@/server/reservation-applications/price-review";
import { recheckApplicationGroupPrices, submitApplicationGroup, submitApplicationGroupWithCompanion } from "@/app/(public)/apply/group/[token]/actions";
import { privateProbes, RecordingNotificationProvider } from "./events-fixture";

const mocks = vi.hoisted(() => ({
  provider: null as NotificationProvider | null,
  submit: vi.fn(),
  recheck: vi.fn(),
  available: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
}));

// Actual actions and emit helper run; every DB-bound dependency is replaced.
// These tests prove placement after the core promise resolves, not DB commit
// semantics. The real groups.ts transaction boundary is verified by inspection.
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  reservationApplicationLink: { findFirst: mocks.available },
  companionInvite: { findFirst: mocks.available },
} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
  headers: async () => { throw new Error("Preview access is outside this synthetic unit test"); },
}));
vi.mock("@/server/reservation-applications/groups", () => ({ submitApplicationGroupCore: mocks.submit, recheckApplicationGroupPricesCore: mocks.recheck }));
vi.mock("@/server/reservation-applications/settings", () => ({ getReservationApplicationSettings: async () => ({}), isReservationApplicationSettingsReady: () => true }));
vi.mock("@/server/reservation-applications/devices", () => ({ APPLICATION_DEVICE_TTL_MS: 1000 }));
vi.mock("@/lib/reservation-applications/completion", () => ({ COMPLETION_COOKIE_NAME: "synthetic-completion-cookie", COMPLETION_TTL_MS: 1000 }));
vi.mock("@/lib/reservation-applications/token", () => ({
  generateApplicationCapabilityToken: () => "SYNTHETIC_CAPABILITY_TOKEN",
  hashApplicationCapabilityToken: () => "synthetic-hash",
}));
vi.mock("@/lib/e2e/phase20-lease", () => ({ PHASE20_PREVIEW_HEADER: "synthetic-preview-header", hasActivePhase20PreviewLease: vi.fn(), parseAndVerifySignedPreviewRun: vi.fn() }));
vi.mock("@/lib/e2e/preview-manual-session", () => ({ resolvePreviewApplyAccess: vi.fn() }));
vi.mock("@/server/reservation-applications/price-review", () => ({
  ApplicationPriceReviewExpiredError: class extends Error { constructor(readonly priceReview?: unknown) { super(); } },
  ApplicationPriceChangedError: class extends Error { constructor(readonly priceReview: unknown) { super(); } },
  ApplicationAlreadySubmittedError: class extends Error {},
}));
vi.mock("@/lib/kakao/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kakao/notify")>();
  return { ...actual, LogNotificationProvider: class implements NotificationProvider {
    async send(input: Parameters<NotificationProvider["send"]>[0]) {
      if (!mocks.provider) throw new Error("Recording provider not attached");
      return mocks.provider.send(input);
    }
  } };
});
vi.mock("@/lib/kakao/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kakao/events")>();
  return { ...actual, emitReservationEvent: vi.fn(actual.emitReservationEvent) };
});

function formData(overrides: Record<string, unknown> = {}): FormData {
  const form = new FormData();
  form.set("payload", JSON.stringify({
    reviewedPriceProof: "synthetic-review-proof",
    consentVersion: APPLICATION_CONSENT_CONTENT.version,
    guardianName: privateProbes[1], guardianPhone: privateProbes[2], guardianRelationship: "MOTHER",
    declaredPayerName: "SYNTHETIC_PAYER_NAME",
    children: [{
      classScheduleId: "synthetic-class", childName: privateProbes[0], childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
      programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
      photoShareConsent: false, photoMarketingConsent: false,
    }],
    ...overrides,
  }));
  return form;
}

function attachedProvider(failure?: Error): RecordingNotificationProvider {
  const provider = new RecordingNotificationProvider(failure);
  mocks.provider = provider;
  return provider;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in this unit test"); }));
  mocks.submit.mockReset().mockResolvedValue({ submissionId: "synthetic-submission-id", applicationIds: ["synthetic-application-id"] });
  mocks.recheck.mockReset().mockResolvedValue({ proof: "synthetic-price-proof", prices: [{ classScheduleId: "synthetic-class", amount: 123 }] });
  mocks.available.mockReset().mockResolvedValue({ group: { syntheticRunId: null } });
  mocks.cookieGet.mockReset().mockReturnValue(undefined);
  mocks.cookieSet.mockReset();
  attachedProvider();
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("received event placement in real server action with synthetic core mocks", () => {
  it.each(["group", "companion"] as const)("returns original %s success with exactly one admin received event", async (route) => {
    const provider = attachedProvider();
    const result = route === "group"
      ? await submitApplicationGroup("synthetic-group-token", {}, formData())
      : await submitApplicationGroupWithCompanion(undefined, "synthetic-companion-token", {}, formData());
    expect(result).toEqual({ submitted: true });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(emitReservationEvent).toHaveBeenCalledTimes(1);
    const record = await vi.mocked(emitReservationEvent).mock.results[0].value;
    expect(record).toMatchObject({ kind: "application.received", entityId: "synthetic-submission-id", audience: "admin", result: { status: "skipped" }, dedupeKey: buildDedupeKey("application.received", "synthetic-submission-id", "created") });
    expect(provider.attempts).toHaveLength(1);
    expect(provider.attempts[0].title).toBe("새 예약 신청이 접수되었습니다");
    const serialized = JSON.stringify({ record, payload: provider.attempts });
    for (const probe of [...privateProbes, "SYNTHETIC_PAYER_NAME", "synthetic-group-token", "synthetic-companion-token", "synthetic-review-proof"]) expect(serialized).not.toContain(probe);
    expect(serialized.toLowerCase()).not.toContain("http");
  });

  it("does not emit before the core resolves or before the original cookie writes finish", async () => {
    const provider = attachedProvider();
    let release: (value: { submissionId: string; applicationIds: string[] }) => void = () => { throw new Error("Core not started"); };
    mocks.submit.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    mocks.cookieSet.mockImplementation(() => { expect(provider.attempts).toEqual([]); });
    const operation = submitApplicationGroup("synthetic-group-token", {}, formData());
    // Await the finite async guards/cookies so the core stub is reached.
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(provider.attempts).toEqual([]);
    expect(emitReservationEvent).not.toHaveBeenCalled();
    release({ submissionId: "synthetic-submission-id", applicationIds: [] });
    expect(await operation).toEqual({ submitted: true });
    expect(provider.attempts).toHaveLength(1);
  });

  it("emits nothing on replay and preserves its original early success return", async () => {
    const provider = attachedProvider();
    mocks.submit.mockResolvedValue({ submissionId: "synthetic-submission-id", applicationIds: [], replayed: true });
    expect(await submitApplicationGroup("synthetic-group-token", {}, formData())).toEqual({ submitted: true });
    expect(provider.attempts).toEqual([]);
    expect(emitReservationEvent).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it.each([
    () => new ApplicationClosedError(),
    () => new ApplicationAlreadySubmittedError(),
    () => new ApplicationPriceChangedError({ proof: "synthetic-replacement-proof", prices: [] }),
    () => new ApplicationPriceReviewExpiredError({ proof: "synthetic-replacement-proof", prices: [] }),
    () => new Error("synthetic-core-error"),
  ])("emits nothing for a core failure and preserves the error result", async (makeError) => {
    const provider = attachedProvider();
    mocks.submit.mockRejectedValue(makeError());
    const first = await submitApplicationGroup("synthetic-group-token", {}, formData());
    expect(first.submitted).toBeUndefined();
    expect(first.error).toEqual(expect.any(String));
    expect(provider.attempts).toEqual([]);
    expect(emitReservationEvent).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("emits nothing for malformed, honeypot, invalid, unavailable or stale-consent inputs", async () => {
    const provider = attachedProvider();
    const malformed = new FormData(); malformed.set("payload", "not-json");
    const honeypot = formData(); honeypot.set("website", "synthetic-bot");
    const invalid = formData({ children: [] });
    const stale = formData({ consentVersion: "synthetic-stale-consent-version" });
    for (const form of [malformed, honeypot, invalid, stale]) {
      expect((await submitApplicationGroup("synthetic-group-token", {}, form)).error).toEqual(expect.any(String));
    }
    mocks.available.mockRejectedValue(new Error("synthetic-read-error"));
    expect((await submitApplicationGroup("synthetic-group-token", {}, formData())).closed).toBe(true);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(provider.attempts).toEqual([]);
    expect(emitReservationEvent).not.toHaveBeenCalled();
  });

  it("preserves the same reservation result and cookies with a working or throwing provider", async () => {
    const working = attachedProvider();
    const first = await submitApplicationGroup("synthetic-group-token", {}, formData());
    const firstCookies = [...mocks.cookieSet.mock.calls];
    const throwing = attachedProvider(new Error(privateProbes.join(" ")));
    mocks.cookieSet.mockClear();
    const second = await submitApplicationGroup("synthetic-group-token", {}, formData());
    expect(second).toEqual(first);
    expect(mocks.cookieSet.mock.calls).toEqual(firstCookies);
    expect(working.attempts).toHaveLength(1);
    expect(throwing.attempts).toHaveLength(1);
    const record = await vi.mocked(emitReservationEvent).mock.results[1].value;
    expect(record.result).toEqual({ status: "failed", reason: "provider-error" });
  });

  it("a real read-only price recheck with the same recording provider attached emits nothing", async () => {
    const provider = attachedProvider();
    const result = await recheckApplicationGroupPrices("synthetic-group-token", undefined, { classScheduleIds: ["synthetic-class"] });
    expect(result).toEqual({ priceReview: { proof: "synthetic-price-proof", prices: [{ classScheduleId: "synthetic-class", amount: 123 }] }, priceReviewExpired: undefined });
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(provider.attempts).toEqual([]);
    expect(emitReservationEvent).not.toHaveBeenCalled();
  });
});
