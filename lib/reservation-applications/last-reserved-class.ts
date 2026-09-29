import { Prisma, type PrismaClient } from "@prisma/client";

type RawQueryClient = Pick<PrismaClient, "$queryRaw">;

/**
 * 아이별 마지막 예약 수업일(보관기간 기준, ADR-056).
 * - 예약(Reservation)의 클래스 시작 시각 중 가장 늦은 값을 쓴다(예정 예약 포함).
 * - 수업 전에 취소된 예약(CANCELLED 이고 출결 기록 없음 — ADR-027 로 종료 후 RESERVED 취소는 불가)은 제외한다.
 * - 취소된 클래스(ClassSchedule CANCELLED)의 예약은 제외한다.
 * - NO_SHOW 와 출결 후 취소된 예약(ADR-033)은 예약 이력이 있으므로 포함한다.
 */
export async function getLastReservedClassDateByChildIds(
  client: RawQueryClient,
  childIds: string[],
): Promise<Map<string, Date>> {
  const uniqueIds = [...new Set(childIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await client.$queryRaw<Array<{ childId: string; lastReservedClassAt: Date | null }>>(Prisma.sql`
    SELECT r."childId" AS "childId", MAX(c."startsAt") AS "lastReservedClassAt"
    FROM "Reservation" r
    JOIN "ClassSchedule" c ON c."id" = r."classScheduleId"
    WHERE r."childId" IN (${Prisma.join(uniqueIds)})
      AND c."status" <> 'CANCELLED'::"ClassStatus"
      AND (r."status" <> 'CANCELLED'::"ReservationStatus" OR r."attendance" IS NOT NULL)
    GROUP BY r."childId"
  `);

  const map = new Map<string, Date>();
  for (const row of rows) {
    if (row.lastReservedClassAt) map.set(row.childId, row.lastReservedClassAt);
  }
  return map;
}
