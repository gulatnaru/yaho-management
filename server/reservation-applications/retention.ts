import { Prisma, type PrismaClient, type ReservationApplicationStatus } from "@prisma/client";
import { PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";
import {
  loadConfirmedCustomerFacts,
  type ConfirmedCustomerFacts,
} from "@/lib/reservation-applications/last-reserved-class";
import {
  computeApplicationRetention,
  computeConfirmedCustomerRetention,
  CONFIRMED_CUSTOMER_CANDIDATE_MIN_AGE_DAYS,
  isPurgeableStatus,
  isRetentionExpired,
  retentionCandidateCutoff,
  UNCONFIRMED_APPLICATION_CANDIDATE_MIN_AGE_DAYS,
  type ApplicationRetention,
} from "@/lib/reservation-applications/retention";

/**
 * 한 번 실행에서 다루는 최대 개수(ADR-058). 파기는 한 트랜잭션이라 대상이 많으면 시간이 길어지므로 나눠서 실행한다.
 * 남은 대상이 있으면 hasMore 로 알리고 ADMIN 이 다시 실행한다. 화면 목록도 같은 개수까지만 보여준다.
 */
export const APPLICATION_PURGE_BATCH_SIZE = 500;
export const CHILD_PURGE_BATCH_SIZE = 100;

/** 파기 트랜잭션 시간 제한. 예약 트랜잭션(20초)보다 길게 두되, 잠금 대기가 끝없이 이어지지 않게 한다. */
export const PERSONAL_DATA_PURGE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

type RetentionScanClient = Pick<PrismaClient, "$queryRaw" | "reservationApplication">;

export type RetentionCandidate = {
  id: string;
  status: ReservationApplicationStatus;
  childName: string | null;
  classStartsAt: Date;
  retention: ApplicationRetention;
};

export type RetentionScan = {
  /** 보관기간(수업일+1년)이 지나 지금 파기할 수 있는 반려·취소 신청 */
  purgeable: RetentionCandidate[];
  /** 보관기간이 지났지만 처리 대기라 먼저 반려·취소해야 하는 신청 */
  expiredPending: RetentionCandidate[];
  /** 한 번에 다루는 개수를 넘는 대상이 더 있다 */
  hasMore: boolean;
};

export type ChildRetentionCandidate = {
  id: string;
  name: string;
  retention: ApplicationRetention;
};

export type ChildRetentionScan = {
  candidates: ChildRetentionCandidate[];
  hasMore: boolean;
};

export type PersonalDataRetentionScan = RetentionScan & {
  /** 마지막 예약 수업일로부터 5년이 지나 비식별화할 확정 고객(Phase 18 확정 신청 이력이 있는 아이) */
  purgeableChildren: ChildRetentionCandidate[];
};

export type PersonalDataPurgeResult = {
  purgedApplicationCount: number;
  purgedChildCount: number;
  /** 이번 실행의 개수 제한 때문에 남은 대상이 있다. 다시 실행하면 이어서 파기한다. */
  hasMore: boolean;
};

async function findExpiredApplications(
  client: RetentionScanClient,
  now: Date,
  input: { statuses: ReservationApplicationStatus[]; limit: number },
): Promise<{ candidates: RetentionCandidate[]; hasMore: boolean }> {
  // 확정 신청은 여기서 다루지 않는다 — 확정 고객(아이)과 함께 5년 기준으로 파기한다.
  const applications = await client.reservationApplication.findMany({
    where: {
      personalDataPurgedAt: null,
      status: { in: input.statuses },
      classSchedule: {
        startsAt: { lt: retentionCandidateCutoff(now, UNCONFIRMED_APPLICATION_CANDIDATE_MIN_AGE_DAYS) },
      },
    },
    select: {
      id: true,
      status: true,
      childName: true,
      classSchedule: { select: { startsAt: true } },
    },
    orderBy: [{ classSchedule: { startsAt: "asc" } }, { id: "asc" }],
    take: input.limit + 1,
  });

  const candidates: RetentionCandidate[] = [];
  for (const application of applications.slice(0, input.limit)) {
    const retention = computeApplicationRetention({
      status: application.status,
      classStartsAt: application.classSchedule.startsAt,
      lastReservedClassAt: null,
    });
    if (!isRetentionExpired(retention, now)) continue;
    candidates.push({
      id: application.id,
      status: application.status,
      childName: application.childName,
      classStartsAt: application.classSchedule.startsAt,
      retention,
    });
  }
  return { candidates, hasMore: applications.length > input.limit };
}

/**
 * 아직 파기되지 않은 확정 전 신청 중 수업일로부터 1년이 지난 것을 찾는다. 조회만 하며 DB 를 바꾸지 않는다.
 * 후보는 DB 에서 수업 시각으로 먼저 좁히고(인덱스 사용), KST 달력 기준으로 다시 판정한다.
 */
export async function scanApplicationRetention(
  client: RetentionScanClient,
  now: Date,
  options: { limit?: number } = {},
): Promise<RetentionScan> {
  const limit = options.limit ?? APPLICATION_PURGE_BATCH_SIZE;
  // 인터랙티브 트랜잭션 안에서도 쓰이므로 순서대로 조회한다.
  const purgeable = await findExpiredApplications(client, now, { statuses: ["REJECTED", "CANCELLED"], limit });
  const pending = await findExpiredApplications(client, now, { statuses: ["SUBMITTED"], limit });
  return {
    purgeable: purgeable.candidates,
    expiredPending: pending.candidates,
    hasMore: purgeable.hasMore || pending.hasMore,
  };
}

function toExpiredChildCandidate(facts: ConfirmedCustomerFacts, now: Date): ChildRetentionCandidate | null {
  // 예정 예약이 있으면 마지막 예약 수업일이 미래라 만료될 수 없지만, "미래 예약이 있는 파기된 아이"는
  // 어떤 경우에도 만들지 않도록 따로 한 번 더 막는다.
  if (facts.hasUpcomingReservation) return null;
  const retention = computeConfirmedCustomerRetention({
    lastReservedClassAt: facts.lastReservedClassAt,
    fallbackClassAt: facts.latestConfirmedClassAt,
  });
  if (!retention || !isRetentionExpired(retention, now)) return null;
  return { id: facts.id, name: facts.name, retention };
}

/**
 * 확정 고객(아이)의 보관기간 만료 여부(ADR-057, 범위 ADR-058). 조회만 하며 DB 를 바꾸지 않는다.
 * 대상: 아직 비식별화되지 않았고 Phase 18 예약 신청으로 CONFIRMED 된 이력이 있는 아이.
 *   Phase 18 신청 이력이 없는 기존 아이, 관리자가 직접 등록한 아이, 기존 예약만 있는 아이는 대상이 아니다.
 * 기준일: 마지막 유효 예약 수업일(last-reserved-class.ts). 없으면 가장 늦은 확정 신청의 대상 클래스 날짜.
 */
export async function scanChildRetention(
  client: Pick<PrismaClient, "$queryRaw">,
  now: Date,
  options: { limit?: number } = {},
): Promise<ChildRetentionScan> {
  const limit = options.limit ?? CHILD_PURGE_BATCH_SIZE;
  const facts = await loadConfirmedCustomerFacts(client, {
    now,
    basisBefore: retentionCandidateCutoff(now, CONFIRMED_CUSTOMER_CANDIDATE_MIN_AGE_DAYS),
    limit: limit + 1,
  });
  const candidates = facts
    .slice(0, limit)
    .flatMap((row) => {
      const candidate = toExpiredChildCandidate(row, now);
      return candidate ? [candidate] : [];
    });
  return { candidates, hasMore: facts.length > limit };
}

export async function scanPersonalDataRetention(
  client: RetentionScanClient,
  now: Date,
): Promise<PersonalDataRetentionScan> {
  // 인터랙티브 트랜잭션 안에서도 쓰이므로 순서대로 조회한다.
  const applications = await scanApplicationRetention(client, now);
  const children = await scanChildRetention(client, now);
  return {
    purgeable: applications.purgeable,
    expiredPending: applications.expiredPending,
    purgeableChildren: children.candidates,
    hasMore: applications.hasMore || children.hasMore,
  };
}

const PURGED_APPLICATION_FIELDS = {
  childName: null,
  childBirthDate: null,
  childGender: null,
  guardianName: null,
  guardianPhone: null,
  guardianRelationship: null,
  requestNote: null,
  // 반려·취소 사유는 운영자가 쓴 자유 입력이라 개인정보가 들어갈 수 있다(ADR-058). 확정 신청은 원래 NULL 이다.
  resolutionNote: null,
} as const;

/**
 * 이미 열린 트랜잭션 안에서 보관기간이 지난 개인정보를 파기한다(ADR-055~058). 동시성 검증(E2E)도 이 함수를 쓴다.
 * - 반려·취소 신청(수업일+1년): 아이·보호자 항목, 아이와의 관계, 요청사항, 반려·취소 사유를 지운다
 *   (신청 행·상태·처리 기록·동의 여부·문구 버전은 남긴다). 상태가 바뀌지 않는 종료 상태만 대상이다.
 * - 확정 고객(마지막 예약 수업일+5년, Phase 18 확정 신청 이력이 있는 아이만):
 *   1) 후보를 좁혀 읽고 2) Child 행을 id 순서로 FOR UPDATE 잠근 뒤 3) 새 문장으로 마지막 예약 수업일·예정 예약·만료를 다시 확인하고
 *   4) 여전히 만료이고 예정 예약이 없는 아이만 파기한다. 최초 조회 결과만으로는 파기하지 않는다.
 *   파기: ChildConsent·ChildSafetyInfo·Relationship 삭제, 예약 자유 입력(memo·cancelDetail) 삭제, 그 아이의 확정 신청 사본 파기,
 *   Child 제자리 비식별화. Child·Reservation·출결·Payment·PaymentItem·Refund 행은 삭제하지 않는다
 *   (RESTRICT FK 와 매출·환불 무결성 — cascade delete 금지). 거래기록은 법령 기준으로 별도 보존한다.
 * ChildConsent 삭제는 append-only 원칙(ADR-008)의 유일한 예외인 "보유기간 만료 파기"다.
 *
 * 잠금: 예약 생성·예약 신청 확정·동의 기록·안전정보 저장·예약 취소는 Child 행을 FOR SHARE 로 잠근다(lib/children/lock.ts).
 * 이 함수는 ClassSchedule 을 잠그지 않고 Child → 딸린 행 순서로만 잠그므로 순환 대기가 생기지 않는다.
 */
export async function purgeExpiredPersonalDataInTransaction(
  tx: Prisma.TransactionClient,
  input: { actorUserId: string; now: Date },
): Promise<PersonalDataPurgeResult> {
  const purgedMark = { personalDataPurgedAt: input.now, personalDataPurgedById: input.actorUserId };

  let purgedApplicationCount = 0;
  const applications = await findExpiredApplications(tx, input.now, {
    statuses: ["REJECTED", "CANCELLED"],
    limit: APPLICATION_PURGE_BATCH_SIZE,
  });
  const applicationIds = applications.candidates
    .filter((candidate) => isPurgeableStatus(candidate.status))
    .map((candidate) => candidate.id);
  if (applicationIds.length > 0) {
    const result = await tx.reservationApplication.updateMany({
      where: { id: { in: applicationIds }, personalDataPurgedAt: null, status: { in: ["REJECTED", "CANCELLED"] } },
      data: { ...PURGED_APPLICATION_FIELDS, ...purgedMark },
    });
    purgedApplicationCount += result.count;
  }

  let purgedChildCount = 0;
  const children = await scanChildRetention(tx, input.now, { limit: CHILD_PURGE_BATCH_SIZE });
  const candidateIds = children.candidates.map((candidate) => candidate.id).sort();
  if (candidateIds.length > 0) {
    // 2) 잠금. 이미 다른 파기가 처리한 행은 잠금을 기다린 뒤 WHERE 를 다시 평가해 빠진다.
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "Child"
      WHERE "id" IN (${Prisma.join(candidateIds)}) AND "personalDataPurgedAt" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `);
    // 3) 재확인. READ COMMITTED 에서 새 문장은 잠금을 얻기 전에 커밋된 예약(예: 방금 만든 미래 예약)을 본다.
    const rechecked =
      locked.length > 0
        ? await loadConfirmedCustomerFacts(tx, { now: input.now, childIds: locked.map((row) => row.id) })
        : [];
    const childIds = rechecked
      .flatMap((facts) => (toExpiredChildCandidate(facts, input.now) ? [facts.id] : []))
      .sort();

    if (childIds.length > 0) {
      const inChildIds = { in: childIds };
      await tx.childConsent.deleteMany({ where: { childId: inChildIds } });
      await tx.childSafetyInfo.deleteMany({ where: { childId: inChildIds } });
      await tx.relationship.deleteMany({
        where: { OR: [{ childAId: inChildIds }, { childBId: inChildIds }] },
      });
      await tx.reservation.updateMany({
        where: { childId: inChildIds },
        data: { memo: null, cancelDetail: null },
      });
      // 확정 고객의 신청 사본도 함께 지운다(아이가 연결된 신청은 CONFIRMED 뿐이다 — CHECK).
      const confirmedApplications = await tx.reservationApplication.updateMany({
        where: { childId: inChildIds, personalDataPurgedAt: null, status: "CONFIRMED" },
        data: { ...PURGED_APPLICATION_FIELDS, ...purgedMark },
      });
      purgedApplicationCount += confirmedApplications.count;
      const purgedChildren = await tx.child.updateMany({
        where: { id: inChildIds, personalDataPurgedAt: null },
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
      purgedChildCount = purgedChildren.count;
    }
  }

  return {
    purgedApplicationCount,
    purgedChildCount,
    hasMore: applications.hasMore || children.hasMore,
  };
}

/** ADMIN 이 직접 실행하는 파기 경로. 자동 배치는 없다. 한 트랜잭션에서 모두 하거나 아무것도 하지 않는다. */
export async function purgeExpiredPersonalDataCore(
  client: Pick<PrismaClient, "$transaction">,
  input: { actorUserId: string; now: Date },
): Promise<PersonalDataPurgeResult> {
  return client.$transaction(
    (tx) => purgeExpiredPersonalDataInTransaction(tx, input),
    PERSONAL_DATA_PURGE_TRANSACTION_OPTIONS,
  );
}
