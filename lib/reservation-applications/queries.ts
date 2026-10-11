import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { rankChildCandidates, type ApplicationChildCandidate, type ChildCandidateRow } from "./candidates";
import { findDuplicateApplicationIds } from "./duplicates";
import {
  APPLICATION_LIST_PAGE_SIZE,
  buildApplicationListOrderBy,
  buildApplicationListWhere,
  type ApplicationListStatus,
} from "./list";
import { loadConfirmedCustomerFacts } from "./last-reserved-class";
import { normalizePersonName, toPhoneDigits } from "./normalize";
import {
  computeApplicationRetention,
  computeConfirmedCustomerRetention,
  type ApplicationRetention,
} from "./retention";

/**
 * ADMIN 전용 예약 신청 조회(ADR-053). 호출하는 page/action 이 requireAdminPrincipal() 을 먼저 통과해야 한다.
 * 목록에는 요청사항·생년월일을 싣지 않고 상세에서만 조회한다(최소 노출).
 */

const APPLICATION_LIST_SELECT = {
  id: true,
  submissionId: true,
  status: true,
  childName: true,
  submittedAt: true,
  depositConfirmedAt: true,
  classScheduleId: true,
  classSchedule: {
    select: { id: true, startsAt: true, endsAt: true, program: { select: { name: true } } },
  },
} as const satisfies Prisma.ReservationApplicationSelect;

type ApplicationListRecord = Prisma.ReservationApplicationGetPayload<{ select: typeof APPLICATION_LIST_SELECT }>;

export type ApplicationListRow = ApplicationListRecord & { isPossibleDuplicate: boolean };

async function findDuplicateIdsForClasses(classScheduleIds: string[]): Promise<Set<string>> {
  const uniqueIds = [...new Set(classScheduleIds)];
  if (uniqueIds.length === 0) return new Set();
  const related = await prisma.reservationApplication.findMany({
    where: {
      classScheduleId: { in: uniqueIds },
      status: { in: ["SUBMITTED", "CONFIRMED"] },
      personalDataPurgedAt: null,
      OR: [
        { submissionId: null },
        { submission: { is: { personalDataPurgedAt: null } } },
      ],
    },
    select: {
      id: true,
      classScheduleId: true,
      childName: true,
      guardianPhone: true,
      status: true,
      submission: { select: { guardianPhone: true } },
    },
  });
  return findDuplicateApplicationIds(
    related.flatMap((row) =>
      row.childName && (row.guardianPhone ?? row.submission?.guardianPhone)
        ? [{ ...row, childName: row.childName, guardianPhone: row.guardianPhone ?? row.submission!.guardianPhone! }]
        : [],
    ),
  );
}

export async function listReservationApplications({
  status,
  page,
}: {
  status: ApplicationListStatus;
  page: number;
}) {
  const where = buildApplicationListWhere(status);
  const [records, total] = await Promise.all([
    prisma.reservationApplication.findMany({
      where,
      select: APPLICATION_LIST_SELECT,
      orderBy: buildApplicationListOrderBy(status),
      skip: (page - 1) * APPLICATION_LIST_PAGE_SIZE,
      take: APPLICATION_LIST_PAGE_SIZE,
    }),
    prisma.reservationApplication.count({ where }),
  ]);
  const duplicateIds = await findDuplicateIdsForClasses(records.map((record) => record.classScheduleId));

  const applications: ApplicationListRow[] = records.map((record) => ({
    ...record,
    isPossibleDuplicate: duplicateIds.has(record.id),
  }));

  return {
    applications,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / APPLICATION_LIST_PAGE_SIZE)),
  };
}

export async function countPendingReservationApplications(): Promise<number> {
  return prisma.reservationApplication.count({ where: { status: "SUBMITTED" } });
}

const APPLICATION_DETAIL_SELECT = {
  id: true,
  submissionId: true,
  status: true,
  childName: true,
  childBirthDate: true,
  childGender: true,
  guardianName: true,
  guardianPhone: true,
  requestNote: true,
  privacyConsentAgreed: true,
  photoShareConsentAgreed: true,
  photoMarketingConsentAgreed: true,
  consentVersion: true,
  submittedAt: true,
  depositConfirmedAt: true,
  resolvedAt: true,
  resolutionNote: true,
  classScheduleId: true,
  childId: true,
  reservationId: true,
  guardianRelationship: true,
  programTermsAcknowledged: true,
  legalGuardianConfirmed: true,
  refundTermsAcknowledged: true,
  personalDataPurgedAt: true,
  depositConfirmedBy: { select: { name: true } },
  resolvedBy: { select: { name: true } },
  personalDataPurgedBy: { select: { name: true } },
  submission: { select: { id: true, guardianName: true, guardianPhone: true, guardianRelationship: true, declaredPayerName: true } },
  child: { select: { id: true, name: true } },
  classSchedule: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      location: true,
      status: true,
      program: { select: { name: true } },
    },
  },
} as const satisfies Prisma.ReservationApplicationSelect;

export type ApplicationDetail = Prisma.ReservationApplicationGetPayload<{
  select: typeof APPLICATION_DETAIL_SELECT;
}> & { isPossibleDuplicate: boolean };

export async function getReservationApplicationDetail(id: string): Promise<ApplicationDetail | null> {
  const application = await prisma.reservationApplication.findUnique({
    where: { id },
    select: APPLICATION_DETAIL_SELECT,
  });
  if (!application) return null;
  const duplicateIds = await findDuplicateIdsForClasses([application.classScheduleId]);
  return { ...application, isPossibleDuplicate: duplicateIds.has(application.id) };
}

/**
 * 이름 또는 보호자 연락처(숫자 기준)가 같은 기존 아이. ChildSafetyInfo 는 조회하지 않는다.
 * 개인정보를 파기한 아이는 예약할 수 없으므로 후보에서 뺀다(ADR-058).
 */
export async function listChildCandidatesForApplication(application: {
  childName: string;
  guardianPhone: string;
}): Promise<ApplicationChildCandidate[]> {
  const name = normalizePersonName(application.childName);
  const phoneDigits = toPhoneDigits(application.guardianPhone);
  const phoneCondition =
    phoneDigits.length > 0
      ? Prisma.sql`OR regexp_replace(COALESCE("guardianPhone", ''), '[^0-9]', '', 'g') = ${phoneDigits}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<ChildCandidateRow[]>(Prisma.sql`
    SELECT "id", "name", "birthDate", "guardianName", "guardianPhone", "isActive"
    FROM "Child"
    WHERE "personalDataPurgedAt" IS NULL
      AND (btrim("name") = ${name} ${phoneCondition})
    ORDER BY "createdAt" DESC, "id" ASC
    LIMIT 20
  `);

  return rankChildCandidates(rows, application);
}

/**
 * 신청 상세의 개인정보 보관 만료일(ADR-055~058). 확정된 신청은 연결된 아이(확정 고객)의 기준을 따른다 —
 * 아이의 마지막 유효 예약 수업일, 없으면 그 아이로 확정된 신청 중 가장 늦은 클래스 날짜.
 * 이미 파기된 신청도 파기 당시와 같은 기준일을 보여주도록 비식별화된 아이까지 조회한다.
 */
export async function getApplicationRetention(application: {
  status: ApplicationDetail["status"];
  childId: string | null;
  classSchedule: { startsAt: Date };
}): Promise<ApplicationRetention> {
  if (application.status === "CONFIRMED" && application.childId) {
    const [facts] = await loadConfirmedCustomerFacts(prisma, {
      now: new Date(),
      childIds: [application.childId],
      includePurged: true,
    });
    const retention = computeConfirmedCustomerRetention({
      lastReservedClassAt: facts?.lastReservedClassAt ?? null,
      fallbackClassAt: facts?.latestConfirmedClassAt ?? application.classSchedule.startsAt,
    });
    if (retention) return retention;
  }
  return computeApplicationRetention({
    status: application.status,
    classStartsAt: application.classSchedule.startsAt,
    lastReservedClassAt: null,
  });
}

export async function getApplicationLinkForClass(classScheduleId: string) {
  return prisma.reservationApplicationLink.findFirst({
    where: { OR: [{ classScheduleId }, { group: { classes: { some: { classScheduleId } } } }] },
    select: { token: true, groupId: true, isActive: true, issuedAt: true, issuedBy: { select: { name: true } } },
  });
}
