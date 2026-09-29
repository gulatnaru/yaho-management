import type { PrismaClient, ReservationApplicationStatus } from "@prisma/client";
import { PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";
import { getLastReservedClassDateByChildIds } from "@/lib/reservation-applications/last-reserved-class";
import {
  computeApplicationRetention,
  computeConfirmedCustomerRetention,
  isPurgeableStatus,
  isRetentionExpired,
  type ApplicationRetention,
} from "@/lib/reservation-applications/retention";

type RetentionScanClient = Pick<PrismaClient, "$queryRaw" | "reservationApplication" | "child">;

export type RetentionCandidate = {
  id: string;
  status: ReservationApplicationStatus;
  childName: string | null;
  classStartsAt: Date;
  retention: ApplicationRetention;
};

export type RetentionScan = {
  /** 보관기간이 지나 지금 파기할 수 있는 신청 */
  purgeable: RetentionCandidate[];
  /** 보관기간이 지났지만 처리 대기라 먼저 반려·취소해야 하는 신청 */
  expiredPending: RetentionCandidate[];
};

export type ChildRetentionCandidate = {
  id: string;
  name: string;
  retention: ApplicationRetention;
};

export type PersonalDataRetentionScan = RetentionScan & {
  /** 마지막 예약 수업일로부터 5년이 지나 비식별화할 확정 고객(아이) */
  purgeableChildren: ChildRetentionCandidate[];
};

/** 아직 파기되지 않은 신청 중 보관기간이 지난 것을 찾는다. 조회만 하며 DB 를 바꾸지 않는다. */
export async function scanApplicationRetention(client: RetentionScanClient, now: Date): Promise<RetentionScan> {
  const applications = await client.reservationApplication.findMany({
    where: { personalDataPurgedAt: null },
    select: {
      id: true,
      status: true,
      childId: true,
      childName: true,
      classSchedule: { select: { startsAt: true } },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });

  const confirmedChildIds = applications.flatMap((application) =>
    application.status === "CONFIRMED" && application.childId ? [application.childId] : [],
  );
  const lastReservedByChild = await getLastReservedClassDateByChildIds(client, confirmedChildIds);

  const scan: RetentionScan = { purgeable: [], expiredPending: [] };
  for (const application of applications) {
    const retention = computeApplicationRetention({
      status: application.status,
      classStartsAt: application.classSchedule.startsAt,
      lastReservedClassAt: application.childId ? (lastReservedByChild.get(application.childId) ?? null) : null,
    });
    if (!isRetentionExpired(retention, now)) continue;

    const candidate: RetentionCandidate = {
      id: application.id,
      status: application.status,
      childName: application.childName,
      classStartsAt: application.classSchedule.startsAt,
      retention,
    };
    if (isPurgeableStatus(application.status)) {
      scan.purgeable.push(candidate);
    } else {
      scan.expiredPending.push(candidate);
    }
  }
  return scan;
}

/**
 * 확정 고객(아이)의 보관기간 만료 여부(ADR-057). 조회만 하며 DB 를 바꾸지 않는다.
 * 대상: 아직 비식별화되지 않았고 예약이 있거나 확정된 신청이 있는 아이.
 * 기준일: 마지막 예약 수업일(last-reserved-class.ts). 유효한 예약이 없으면 가장 최근 확정 신청의 대상 클래스 날짜.
 * 둘 다 없는 아이(수업 전에 취소된 예약만 있는 아이 등)는 확정 고객 기준을 적용하지 않는다.
 */
export async function scanChildRetention(client: RetentionScanClient, now: Date): Promise<ChildRetentionCandidate[]> {
  const children = await client.child.findMany({
    where: {
      personalDataPurgedAt: null,
      OR: [{ reservations: { some: {} } }, { reservationApplications: { some: { status: "CONFIRMED" } } }],
    },
    select: {
      id: true,
      name: true,
      reservationApplications: {
        where: { status: "CONFIRMED" },
        select: { classSchedule: { select: { startsAt: true } } },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const lastReservedByChild = await getLastReservedClassDateByChildIds(
    client,
    children.map((child) => child.id),
  );

  const candidates: ChildRetentionCandidate[] = [];
  for (const child of children) {
    const latestConfirmedClassAt = child.reservationApplications.reduce<Date | null>(
      (latest, application) =>
        !latest || application.classSchedule.startsAt > latest ? application.classSchedule.startsAt : latest,
      null,
    );
    const retention = computeConfirmedCustomerRetention({
      lastReservedClassAt: lastReservedByChild.get(child.id) ?? null,
      fallbackClassAt: latestConfirmedClassAt,
    });
    if (!retention || !isRetentionExpired(retention, now)) continue;
    candidates.push({ id: child.id, name: child.name, retention });
  }
  return candidates;
}

export async function scanPersonalDataRetention(
  client: RetentionScanClient,
  now: Date,
): Promise<PersonalDataRetentionScan> {
  // 인터랙티브 트랜잭션 안에서도 쓰이므로 순서대로 조회한다.
  const applications = await scanApplicationRetention(client, now);
  const purgeableChildren = await scanChildRetention(client, now);
  return { ...applications, purgeableChildren };
}

const PURGED_APPLICATION_FIELDS = {
  childName: null,
  childBirthDate: null,
  childGender: null,
  guardianName: null,
  guardianPhone: null,
  guardianRelationship: null,
  requestNote: null,
} as const;

/**
 * 보관기간이 지난 개인정보를 파기한다(ADR-055~057). ADMIN 이 직접 실행하는 정리 경로이며 자동 배치는 없다.
 * 한 트랜잭션에서 다음을 모두 하거나 아무것도 하지 않는다.
 * - 신청: 아이·보호자 항목, 아이와의 관계, 요청사항을 지운다(신청 행·상태·처리 기록·동의 여부·문구 버전은 남긴다).
 * - 확정 고객(아이): ChildConsent·ChildSafetyInfo·Relationship 을 삭제하고, 예약 자유 입력(memo·cancelDetail)을 지우고,
 *   Child 를 제자리에서 비식별화한다. Child·Reservation·출결·Payment·PaymentItem·Refund 행은 삭제하지 않는다
 *   (RESTRICT FK 와 매출·환불 무결성 — cascade delete 금지). 거래기록은 법령 기준으로 별도 보존한다.
 * ChildConsent 삭제는 append-only 원칙(ADR-008)의 유일한 예외인 "보유기간 만료 파기"다.
 */
export async function purgeExpiredPersonalDataCore(
  client: Pick<PrismaClient, "$transaction">,
  input: { actorUserId: string; now: Date },
): Promise<{ purgedApplicationCount: number; purgedChildCount: number }> {
  return client.$transaction(async (tx) => {
    const scan = await scanPersonalDataRetention(tx, input.now);
    const purgedMark = { personalDataPurgedAt: input.now, personalDataPurgedById: input.actorUserId };

    let purgedApplicationCount = 0;
    const applicationIds = scan.purgeable.map((candidate) => candidate.id);
    if (applicationIds.length > 0) {
      const result = await tx.reservationApplication.updateMany({
        where: { id: { in: applicationIds }, personalDataPurgedAt: null, status: { not: "SUBMITTED" } },
        data: { ...PURGED_APPLICATION_FIELDS, ...purgedMark },
      });
      purgedApplicationCount += result.count;
    }

    let purgedChildCount = 0;
    const childIds = scan.purgeableChildren.map((candidate) => candidate.id);
    if (childIds.length > 0) {
      await tx.childConsent.deleteMany({ where: { childId: { in: childIds } } });
      await tx.childSafetyInfo.deleteMany({ where: { childId: { in: childIds } } });
      await tx.relationship.deleteMany({
        where: { OR: [{ childAId: { in: childIds } }, { childBId: { in: childIds } }] },
      });
      await tx.reservation.updateMany({
        where: { childId: { in: childIds } },
        data: { memo: null, cancelDetail: null },
      });
      // 확정 고객의 신청 사본도 함께 지운다(확정 신청은 처리 대기가 아니므로 CHECK 를 만족한다).
      const applications = await tx.reservationApplication.updateMany({
        where: { childId: { in: childIds }, personalDataPurgedAt: null, status: { not: "SUBMITTED" } },
        data: { ...PURGED_APPLICATION_FIELDS, ...purgedMark },
      });
      purgedApplicationCount += applications.count;
      const children = await tx.child.updateMany({
        where: { id: { in: childIds }, personalDataPurgedAt: null },
        data: {
          name: PURGED_PERSONAL_DATA_LABEL,
          birthDate: null,
          gender: "UNSPECIFIED",
          guardianName: null,
          guardianPhone: null,
          memo: null,
          isActive: false,
          ...purgedMark,
        },
      });
      purgedChildCount = children.count;
    }

    return { purgedApplicationCount, purgedChildCount };
  });
}
