import { describe, expect, it, vi } from "vitest";
import type { ApplicationAvailabilityContext } from "@/lib/reservation-applications/availability";
import { ApplicationClosedError, ApplicationRateLimitedError } from "@/lib/reservation-applications/errors";
import type { ReservationApplicationSubmission } from "@/lib/validation/reservation-application";
import {
  APPLICATION_RATE_LIMIT,
  submitReservationApplicationCore,
} from "@/server/reservation-applications/submit";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const TOKEN = "t".repeat(32);
const context: ApplicationAvailabilityContext = {
  now: NOW,
  environmentAllowed: true,
  configReady: true,
  consentReady: true,
};
const data: ReservationApplicationSubmission = {
  childName: "테스트아이",
  childBirthDate: "2019-05-01",
  childGender: "FEMALE",
  guardianName: "테스트보호자",
  guardianPhone: "010-0000-0000",
  guardianRelationship: "OTHER_LEGAL_GUARDIAN",
  requestNote: undefined,
  programTerms: true,
  privacyConsent: true,
  legalGuardianConfirmation: true,
  photoShareConsent: false,
  photoMarketingConsent: false,
  refundTerms: true,
};
const openLink = {
  isActive: true,
  classScheduleId: "class-1",
  classSchedule: { status: "SCHEDULED", startsAt: new Date("2026-10-05T01:00:00.000Z") },
};

function createClient(options?: { link?: unknown; recentCount?: number }) {
  const findUnique = vi.fn(async () => (options && "link" in options ? options.link : openLink));
  const count = vi.fn(async () => options?.recentCount ?? 0);
  const create = vi.fn(async () => ({ id: "application-1" }));
  return {
    client: { reservationApplicationLink: { findUnique }, reservationApplication: { count, create } } as never,
    findUnique,
    count,
    create,
  };
}

describe("submitReservationApplicationCore", () => {
  it("stores one application for the class resolved from the token", async () => {
    const { client, create, findUnique } = createClient();

    await expect(
      submitReservationApplicationCore(client, { token: TOKEN, data, consentVersion: "v-test", context }),
    ).resolves.toEqual({ id: "application-1" });

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { token: TOKEN } }));
    expect(create).toHaveBeenCalledWith({
      data: {
        classScheduleId: "class-1",
        childName: "테스트아이",
        childBirthDate: new Date("2019-05-01"),
        childGender: "FEMALE",
        guardianName: "테스트보호자",
        guardianPhone: "010-0000-0000",
        guardianRelationship: "OTHER_LEGAL_GUARDIAN",
        requestNote: null,
        programTermsAcknowledged: true,
        privacyConsentAgreed: true,
        legalGuardianConfirmed: true,
        refundTermsAcknowledged: true,
        photoShareConsentAgreed: false,
        photoMarketingConsentAgreed: false,
        consentVersion: "v-test",
        submittedAt: NOW,
      },
      select: { id: true },
    });
  });

  it("rejects malformed tokens without a lookup", async () => {
    const { client, findUnique, create } = createClient();

    await expect(
      submitReservationApplicationCore(client, { token: "bad", data, consentVersion: "v-test", context }),
    ).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["missing link", null],
    ["stopped link", { ...openLink, isActive: false }],
    ["cancelled class", { ...openLink, classSchedule: { ...openLink.classSchedule, status: "CANCELLED" } }],
    ["started class", { ...openLink, classSchedule: { ...openLink.classSchedule, startsAt: NOW } }],
  ])("rejects a %s at submit time", async (_label, link) => {
    const { client, create } = createClient({ link });

    await expect(
      submitReservationApplicationCore(client, { token: TOKEN, data, consentVersion: "v-test", context }),
    ).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects submissions when the runtime is not ready", async () => {
    const { client, create } = createClient();

    await expect(
      submitReservationApplicationCore(client, {
        token: TOKEN,
        data,
        consentVersion: "v-test",
        context: { ...context, environmentAllowed: false },
      }),
    ).rejects.toBeInstanceOf(ApplicationClosedError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rate limits each class link within the window", async () => {
    const { client, count, create } = createClient({ recentCount: APPLICATION_RATE_LIMIT.maxPerClass });

    await expect(
      submitReservationApplicationCore(client, { token: TOKEN, data, consentVersion: "v-test", context }),
    ).rejects.toBeInstanceOf(ApplicationRateLimitedError);
    expect(count).toHaveBeenCalledWith({
      where: {
        classScheduleId: "class-1",
        submittedAt: { gte: new Date(NOW.getTime() - APPLICATION_RATE_LIMIT.windowMs) },
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
