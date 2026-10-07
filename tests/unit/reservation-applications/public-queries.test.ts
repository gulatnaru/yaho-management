import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationAvailabilityContext } from "@/lib/reservation-applications/availability";

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservationApplicationLink: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const {
  loadPublicApplicationView,
  PUBLIC_APPLICATION_CLASS_SELECT,
  PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT,
} = await import("@/lib/reservation-applications/public-queries");

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
}

/** 어느 공개 조회에도 들어가면 안 되는 필드(가격·정원·예약·선생님·메모·보험·안전·토큰·개인정보) */
const ALWAYS_FORBIDDEN = [
  "defaultPrice",
  "capacity",
  "reservations",
  "_count",
  "teachers",
  "memo",
  "insured",
  "insurer",
  "insurancePolicyNo",
  "safetyMemo",
  "cancelDetail",
  "token",
  "applications",
  "id",
  "classScheduleId",
  "consentVersion",
  "guardianRelationship",
  "personalDataPurgedAt",
  "programTermsAcknowledged",
  "legalGuardianConfirmed",
  "refundTermsAcknowledged",
  "retention",
];

/** 닫힌 링크 판정 전에는 조회하면 안 되는 클래스 표시 정보 */
const DISPLAY_FIELDS = ["endsAt", "location", "program", "name", "description", "targetAgeMin", "targetAgeMax"];

const NOW = new Date("2026-10-01T00:00:00.000Z");
const FUTURE = new Date("2026-10-05T01:00:00.000Z");
const PAST = new Date("2026-09-30T23:00:00.000Z");
const TOKEN = "a".repeat(32);
const readyContext: ApplicationAvailabilityContext = {
  now: NOW,
  environmentAllowed: true,
  configReady: true,
  consentReady: true,
};
const displayClass = {
  startsAt: FUTURE,
  endsAt: new Date("2026-10-05T03:00:00.000Z"),
  location: "장소_테스트",
  program: { name: "프로그램_테스트", description: "설명_테스트", targetAgeMin: 5, targetAgeMax: 9 },
};

describe("public application link selects", () => {
  it("reads only isActive, class status and start time to decide whether a link is open", () => {
    expect(PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT).toEqual({
      isActive: true,
      classSchedule: { select: { status: true, startsAt: true } },
    });
    const keys = collectKeys(PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT);
    for (const forbidden of [...ALWAYS_FORBIDDEN, ...DISPLAY_FIELDS]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("reads only the class display fields for an open link", () => {
    expect(PUBLIC_APPLICATION_CLASS_SELECT).toEqual({
      startsAt: true,
      endsAt: true,
      location: true,
      program: { select: { name: true, description: true, targetAgeMin: true, targetAgeMax: true } },
    });
    const keys = collectKeys(PUBLIC_APPLICATION_CLASS_SELECT);
    for (const forbidden of [...ALWAYS_FORBIDDEN, "status", "isActive"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("loadPublicApplicationView", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findFirstMock.mockReset();
  });

  it("does not query the database for malformed tokens", async () => {
    await expect(loadPublicApplicationView("short-token", readyContext)).resolves.toEqual({ open: false });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Preview or unsupported environment", { environmentAllowed: false }],
    ["missing deposit/channel configuration", { configReady: false }],
    ["consent text not ready", { consentReady: false }],
  ] as const)("does not query the database when the runtime is not ready (%s)", async (_label, override) => {
    await expect(loadPublicApplicationView(TOKEN, { ...readyContext, ...override })).resolves.toEqual({ open: false });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing link", null],
    ["stopped link", { isActive: false, classSchedule: { status: "SCHEDULED", startsAt: FUTURE } }],
    ["cancelled class", { isActive: true, classSchedule: { status: "CANCELLED", startsAt: FUTURE } }],
    ["started class", { isActive: true, classSchedule: { status: "SCHEDULED", startsAt: PAST } }],
    ["class starting now", { isActive: true, classSchedule: { status: "SCHEDULED", startsAt: NOW } }],
  ] as const)(
    "returns a closed view from the minimal lookup only and never loads display fields (%s)",
    async (_label, availability) => {
      findUniqueMock.mockResolvedValue(availability);

      const view = await loadPublicApplicationView(TOKEN, readyContext);

      expect(view).toEqual({ open: false });
      expect(collectKeys(view)).toEqual(["open"]);
      expect(findUniqueMock).toHaveBeenCalledTimes(1);
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { token: TOKEN },
        select: PUBLIC_APPLICATION_LINK_AVAILABILITY_SELECT,
      });
      expect(findFirstMock).not.toHaveBeenCalled();
    },
  );

  it("loads display fields only after the link is judged open, re-checking the open conditions", async () => {
    findUniqueMock.mockResolvedValue({ isActive: true, classSchedule: { status: "SCHEDULED", startsAt: FUTURE } });
    findFirstMock.mockResolvedValue({ classSchedule: displayClass });

    await expect(loadPublicApplicationView(TOKEN, readyContext)).resolves.toEqual({
      open: true,
      classSchedule: displayClass,
    });

    expect(findUniqueMock.mock.invocationCallOrder[0]).toBeLessThan(findFirstMock.mock.invocationCallOrder[0]!);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        token: TOKEN,
        isActive: true,
        classSchedule: { status: "SCHEDULED", startsAt: { gt: NOW } },
      },
      select: { classSchedule: { select: PUBLIC_APPLICATION_CLASS_SELECT } },
    });
  });

  it("stays closed if the link closes between the two lookups", async () => {
    findUniqueMock.mockResolvedValue({ isActive: true, classSchedule: { status: "SCHEDULED", startsAt: FUTURE } });
    findFirstMock.mockResolvedValue(null);

    await expect(loadPublicApplicationView(TOKEN, readyContext)).resolves.toEqual({ open: false });
  });
});

describe("public application page", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../../app/(public)/apply/[token]/page.tsx", import.meta.url)),
    "utf8",
  );

  it("uses the legacy loader before a scoped upgraded-link lookup and returns the closed notice before legacy class data", () => {
    expect(page).toContain("loadPublicApplicationView(");
    expect(page).toContain("hashApplicationCapabilityToken(token)");
    expect(page).toContain("group: { is: { isActive: true");
    const openCheck = page.indexOf("if (!view.open)");
    const closedReturn = page.indexOf("return <ApplicationClosedNotice />");
    const classAccess = page.indexOf("const { classSchedule } = view;");
    expect(openCheck).toBeGreaterThan(0);
    expect(closedReturn).toBeGreaterThan(openCheck);
    expect(classAccess).toBeGreaterThan(closedReturn);
  });
});
