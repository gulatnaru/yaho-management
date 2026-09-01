import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type {
  DashboardCalendarDayMetric,
  DashboardClassDetail,
  DashboardFinancialMetrics,
} from "@/server/dashboard/types";
import { toSafeInteger } from "@/server/revenue/aggregate";

type AggregateValue = number | bigint | string | null;

interface MonthlyCalendarFact {
  date: string;
  classCount: AggregateValue;
  operationReservationCount: AggregateValue;
}

interface AmountFact {
  amount: AggregateValue;
}

interface DateRange {
  startUtc: Date;
  endExclusiveUtc: Date;
}

export function buildMonthlyCalendarQuery(range: DateRange) {
  return Prisma.sql`
    SELECT
      TO_CHAR(cs."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "date",
      COUNT(DISTINCT cs."id") AS "classCount",
      COUNT(r."id") FILTER (
        WHERE r."status" IN ('RESERVED', 'COMPLETED', 'NO_SHOW')
          OR (r."status" = 'CANCELLED' AND r."attendance" IS NOT NULL)
      ) AS "operationReservationCount"
    FROM "ClassSchedule" cs
    LEFT JOIN "Reservation" r ON r."classScheduleId" = cs."id"
    WHERE cs."startsAt" >= ${range.startUtc}
      AND cs."startsAt" < ${range.endExclusiveUtc}
      AND cs."status" <> 'CANCELLED'
    GROUP BY TO_CHAR(cs."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
    ORDER BY "date" ASC
  `;
}

export async function getMonthlyCalendarMetrics(range: DateRange): Promise<DashboardCalendarDayMetric[]> {
  const facts = await prisma.$queryRaw<MonthlyCalendarFact[]>(buildMonthlyCalendarQuery(range));
  return facts.map((fact) => ({
    date: fact.date,
    classCount: toSafeInteger(fact.classCount),
    operationReservationCount: toSafeInteger(fact.operationReservationCount),
  }));
}

export async function getDashboardClasses(range: DateRange): Promise<DashboardClassDetail[]> {
  const classes = await prisma.classSchedule.findMany({
    where: {
      startsAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      location: true,
      capacity: true,
      program: { select: { id: true, name: true } },
      teachers: {
        select: { teacher: { select: { id: true, name: true } } },
        orderBy: { teacher: { name: "asc" } },
      },
      reservations: {
        where: {
          OR: [
            { status: { in: ["RESERVED", "COMPLETED", "NO_SHOW"] } },
            { status: "CANCELLED", attendance: { not: null } },
          ],
        },
        select: {
          id: true,
          status: true,
          attendance: true,
          child: { select: { id: true, name: true } },
        },
        orderBy: [{ reservedAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });

  return classes.map((classSchedule) => {
    const reservedCount = classSchedule.reservations.filter((reservation) => reservation.status === "RESERVED").length;
    return {
      id: classSchedule.id,
      startsAt: classSchedule.startsAt,
      endsAt: classSchedule.endsAt,
      location: classSchedule.location,
      capacity: classSchedule.capacity,
      program: classSchedule.program,
      teachers: classSchedule.teachers.map(({ teacher }) => teacher),
      reservations: classSchedule.reservations,
      operationReservationCount: classSchedule.reservations.length,
      reservedCount,
      remainingSeats: Math.max(classSchedule.capacity - reservedCount, 0),
    };
  });
}

export async function getTodayCancellationCount(range: DateRange): Promise<number> {
  return prisma.reservation.count({
    where: { cancelledAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
  });
}

export function buildTodayPaymentsQuery(range: DateRange) {
  return Prisma.sql`
    SELECT COALESCE(SUM(pi."paidAmount"), 0) AS "amount"
    FROM "PaymentItem" pi
    JOIN "Payment" pay ON pay."id" = pi."paymentId"
    WHERE pay."paidAt" >= ${range.startUtc}
      AND pay."paidAt" < ${range.endExclusiveUtc}
      AND pay."status" IN ('PAID', 'PARTIAL_REFUNDED', 'REFUNDED')
  `;
}

export function buildTodayRefundsQuery(range: DateRange) {
  return Prisma.sql`
    SELECT COALESCE(SUM(ref."amount"), 0) AS "amount"
    FROM "Refund" ref
    WHERE ref."refundedAt" >= ${range.startUtc}
      AND ref."refundedAt" < ${range.endExclusiveUtc}
      AND ref."status" = 'COMPLETED'
  `;
}

export async function getTodayFinancialMetrics(range: DateRange): Promise<DashboardFinancialMetrics> {
  const [paymentFacts, refundFacts] = await Promise.all([
    prisma.$queryRaw<AmountFact[]>(buildTodayPaymentsQuery(range)),
    prisma.$queryRaw<AmountFact[]>(buildTodayRefundsQuery(range)),
  ]);
  const paidAmount = toSafeInteger(paymentFacts[0]?.amount ?? null);
  const refundedAmount = toSafeInteger(refundFacts[0]?.amount ?? null);
  return { paidAmount, refundedAmount, netRevenue: paidAmount - refundedAmount };
}
