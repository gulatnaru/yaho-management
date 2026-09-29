import { Prisma, type PrismaClient } from "@prisma/client";

type RawQueryClient = Pick<PrismaClient, "$queryRaw">;

/**
 * 아이별 마지막 프로그램 이용일(보관기간 기준, ADR-055).
 * "이용"은 기존 운영 예약 기준(ADR-040/042)을 재사용한다 — 수업 전에 출결 없이 취소된 예약과
 * 취소된 클래스의 예약은 제외하고, RESERVED/COMPLETED/NO_SHOW 와 출결 후 취소된 예약을 포함한다.
 */
export async function getLastProgramUseByChildIds(
  client: RawQueryClient,
  childIds: string[],
): Promise<Map<string, Date>> {
  const uniqueIds = [...new Set(childIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await client.$queryRaw<Array<{ childId: string; lastUseAt: Date | null }>>(Prisma.sql`
    SELECT r."childId" AS "childId", MAX(c."startsAt") AS "lastUseAt"
    FROM "Reservation" r
    JOIN "ClassSchedule" c ON c."id" = r."classScheduleId"
    WHERE r."childId" IN (${Prisma.join(uniqueIds)})
      AND c."status" <> 'CANCELLED'::"ClassStatus"
      AND (r."status" <> 'CANCELLED'::"ReservationStatus" OR r."attendance" IS NOT NULL)
    GROUP BY r."childId"
  `);

  const map = new Map<string, Date>();
  for (const row of rows) {
    if (row.lastUseAt) map.set(row.childId, row.lastUseAt);
  }
  return map;
}
