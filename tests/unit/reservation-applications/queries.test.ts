import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationFindMany = vi.fn();
const applicationFindUnique = vi.fn();
const applicationCount = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservationApplication: {
      findMany: (...args: unknown[]) => applicationFindMany(...args),
      findUnique: (...args: unknown[]) => applicationFindUnique(...args),
      count: (...args: unknown[]) => applicationCount(...args),
    },
  },
}));

const { getReservationApplicationDetail, listReservationApplications } = await import("@/lib/reservation-applications/queries");

const listRecord = (id: string) => ({
  id,
  submissionId: "submission-" + id,
  status: "SUBMITTED" as const,
  childName: "아이",
  submittedAt: new Date("2026-10-01T00:00:00Z"),
  depositConfirmedAt: null,
  classScheduleId: "class-1",
  classSchedule: { id: "class-1", startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: new Date("2026-11-01T01:00:00Z"), program: { name: "프로그램" } },
});

describe("reservation application duplicate queries", () => {
  beforeEach(() => {
    applicationFindMany.mockReset();
    applicationFindUnique.mockReset();
    applicationCount.mockReset();
  });

  it("matches Phase 20 parent guardian phones while retaining legacy phones and excluding different or purged facts", async () => {
    applicationFindMany
      .mockResolvedValueOnce([listRecord("new-a"), listRecord("new-b"), listRecord("legacy")])
      .mockResolvedValueOnce([
        { id: "new-a", classScheduleId: "class-1", childName: "아이", guardianPhone: null, status: "SUBMITTED", submission: { guardianPhone: "010-1234-5678" } },
        { id: "new-b", classScheduleId: "class-1", childName: "아이", guardianPhone: null, status: "CONFIRMED", submission: { guardianPhone: "01012345678" } },
        { id: "legacy", classScheduleId: "class-1", childName: "아이", guardianPhone: "010-1234-5678", status: "SUBMITTED", submission: null },
        { id: "other-phone", classScheduleId: "class-1", childName: "아이", guardianPhone: null, status: "SUBMITTED", submission: { guardianPhone: "010-9999-9999" } },
        { id: "other-class", classScheduleId: "class-2", childName: "아이", guardianPhone: null, status: "SUBMITTED", submission: { guardianPhone: "010-1234-5678" } },
      ]);
    applicationCount.mockResolvedValue(3);

    const result = await listReservationApplications({ status: "SUBMITTED", page: 1 });

    expect(result.applications.map((row) => [row.id, row.isPossibleDuplicate])).toEqual([
      ["new-a", true],
      ["new-b", true],
      ["legacy", true],
    ]);
    const duplicateQuery = applicationFindMany.mock.calls[1]![0];
    expect(duplicateQuery.where).toMatchObject({
      personalDataPurgedAt: null,
      OR: [{ submissionId: null }, { submission: { is: { personalDataPurgedAt: null } } }],
    });
    expect(duplicateQuery.select.submission).toEqual({ select: { guardianPhone: true } });
  });

  it("marks the detail duplicate from its parent guardian phone without exposing that parent fact in the list DTO", async () => {
    applicationFindUnique.mockResolvedValue({
      ...listRecord("detail-new"),
      childBirthDate: new Date("2020-01-01T00:00:00Z"), childGender: "UNSPECIFIED", guardianName: null, guardianPhone: null,
      requestNote: null, privacyConsentAgreed: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false,
      consentVersion: "v1", resolvedAt: null, resolutionNote: null, childId: null, reservationId: null,
      guardianRelationship: null, programTermsAcknowledged: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true,
      personalDataPurgedAt: null, depositConfirmedBy: null, resolvedBy: null, personalDataPurgedBy: null,
      submission: { id: "submission-detail", guardianName: "보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER", declaredPayerName: "입금자" },
      child: null,
    });
    applicationFindMany.mockResolvedValue([
      { id: "detail-new", classScheduleId: "class-1", childName: "아이", guardianPhone: null, status: "SUBMITTED", submission: { guardianPhone: "010-1234-5678" } },
      { id: "detail-legacy", classScheduleId: "class-1", childName: "아이", guardianPhone: "01012345678", status: "SUBMITTED", submission: null },
    ]);

    const detail = await getReservationApplicationDetail("detail-new");

    expect(detail?.isPossibleDuplicate).toBe(true);
    const duplicateQuery = applicationFindMany.mock.calls[0]![0];
    expect(duplicateQuery.where.OR).toEqual([{ submissionId: null }, { submission: { is: { personalDataPurgedAt: null } } }]);
    expect(duplicateQuery.select.submission).toEqual({ select: { guardianPhone: true } });
  });
});
