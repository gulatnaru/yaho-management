import { Prisma, type PrismaClient } from "@prisma/client";

type RawQueryClient = Pick<PrismaClient, "$queryRaw">;

/**
 * 마지막 예약 수업일(보관기간 기준, ADR-056)에 넣는 "유효한 예약" 조건. r = Reservation, c = ClassSchedule.
 * - 예정 예약을 포함한다.
 * - 수업 전에 취소된 예약(CANCELLED 이고 출결 기록 없음 — ADR-027 로 종료 후 RESERVED 취소는 불가)은 제외한다.
 * - 취소된 클래스(ClassSchedule CANCELLED)의 예약은 제외한다.
 * - NO_SHOW 와 출결 후 취소된 예약(ADR-033)은 예약 이력이 있으므로 포함한다.
 */
export const VALID_RESERVATION_CONDITION = Prisma.sql`
  c."status" <> 'CANCELLED'::"ClassStatus"
  AND (r."status" <> 'CANCELLED'::"ReservationStatus" OR r."attendance" IS NOT NULL)
`;

/** 5년 보관 대상 확정 고객(아이)의 보관기간 판정 재료. */
export type ConfirmedCustomerFacts = {
  id: string;
  name: string;
  /** 유효한 예약 중 가장 늦은 클래스 시작 시각. 유효한 예약이 없으면 null */
  lastReservedClassAt: Date | null;
  /** 이 아이로 확정된 예약 신청의 대상 클래스 중 가장 늦은 시작 시각(유효한 예약이 없을 때의 기준) */
  latestConfirmedClassAt: Date;
  /** 아직 끝나지 않은 예정 클래스(SCHEDULED)에 RESERVED 예약이 있는지 */
  hasUpcomingReservation: boolean;
};

/**
 * 5년 보관 대상 확정 고객의 판정 재료를 한 번의 조회로 읽는다(ADR-057, 범위는 ADR-058).
 * 대상: 아직 비식별화되지 않았고, Phase 18 예약 신청(ReservationApplication)으로 신청해 CONFIRMED 된 이력이 있는 아이.
 * 관리자가 직접 등록했거나 기존 예약만 있는 아이는 포함하지 않는다(기존 고객 전체의 보관정책은 별도 Phase).
 *
 * @param input.childIds 이 아이들만 본다(잠금 후 재확인·상세 화면용).
 * @param input.basisBefore 기준 시각(COALESCE(마지막 유효 예약, 최근 확정 신청 클래스))이 이 값보다 이른 아이만 본다(후보 축소).
 *   정확한 만료 판정은 호출자가 KST 달력 기준으로 다시 한다.
 * @param input.limit 기준 시각이 이른 순서로 최대 개수.
 * @param input.includePurged 상세 화면처럼 이미 비식별화된 아이의 기준일도 보여줘야 할 때만 true.
 */
export async function loadConfirmedCustomerFacts(
  client: RawQueryClient,
  input: {
    now: Date;
    childIds?: string[];
    basisBefore?: Date;
    limit?: number;
    includePurged?: boolean;
  },
): Promise<ConfirmedCustomerFacts[]> {
  const childIds = input.childIds ? [...new Set(input.childIds)] : undefined;
  if (childIds && childIds.length === 0) return [];

  const childFilter = childIds ? Prisma.sql`AND a."childId" IN (${Prisma.join(childIds)})` : Prisma.empty;
  const purgedFilter = input.includePurged ? Prisma.empty : Prisma.sql`AND ch."personalDataPurgedAt" IS NULL`;
  const basisFilter = input.basisBefore
    ? Prisma.sql`AND COALESCE(reserved."lastReservedClassAt", confirmed."latestConfirmedClassAt") < ${input.basisBefore}`
    : Prisma.empty;
  // 숫자 파라미터의 전송 타입과 무관하게 LIMIT 이 정수를 받도록 명시적으로 변환한다.
  const limitClause = input.limit !== undefined ? Prisma.sql`LIMIT ${Math.trunc(input.limit)}::int` : Prisma.empty;

  return client.$queryRaw<ConfirmedCustomerFacts[]>(Prisma.sql`
    WITH confirmed AS (
      SELECT a."childId" AS "childId", MAX(c."startsAt") AS "latestConfirmedClassAt"
      FROM "ReservationApplication" a
      JOIN "ClassSchedule" c ON c."id" = a."classScheduleId"
      WHERE a."status" = 'CONFIRMED'::"ReservationApplicationStatus"
        AND a."childId" IS NOT NULL
        ${childFilter}
      GROUP BY a."childId"
    )
    SELECT
      ch."id" AS "id",
      ch."name" AS "name",
      reserved."lastReservedClassAt" AS "lastReservedClassAt",
      confirmed."latestConfirmedClassAt" AS "latestConfirmedClassAt",
      reserved."hasUpcomingReservation" AS "hasUpcomingReservation"
    FROM confirmed
    JOIN "Child" ch ON ch."id" = confirmed."childId"
    CROSS JOIN LATERAL (
      SELECT
        MAX(c."startsAt") AS "lastReservedClassAt",
        COALESCE(
          BOOL_OR(
            r."status" = 'RESERVED'::"ReservationStatus"
            AND c."status" = 'SCHEDULED'::"ClassStatus"
            AND c."endsAt" >= ${input.now}
          ),
          false
        ) AS "hasUpcomingReservation"
      FROM "Reservation" r
      JOIN "ClassSchedule" c ON c."id" = r."classScheduleId"
      WHERE r."childId" = ch."id"
        AND ${VALID_RESERVATION_CONDITION}
    ) reserved
    WHERE true
      ${purgedFilter}
      ${basisFilter}
    ORDER BY COALESCE(reserved."lastReservedClassAt", confirmed."latestConfirmedClassAt") ASC, ch."id" ASC
    ${limitClause}
  `);
}
