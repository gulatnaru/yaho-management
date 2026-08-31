import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { mergeRevenueFacts } from "@/server/revenue/aggregate";
import type {
  OperationFact,
  PaymentFact,
  RefundFact,
  RevenueQueryFilters,
  RevenueRefundState,
} from "@/server/revenue/types";

type OperationFilters = Pick<
  RevenueQueryFilters,
  "startUtc" | "endExclusiveUtc" | "programId" | "classScheduleId"
>;
type FinancialFilters = RevenueQueryFilters;

function scopeSql(filters: Pick<RevenueQueryFilters, "programId" | "classScheduleId">) {
  return Prisma.sql`
    ${filters.programId ? Prisma.sql`AND cs."programId" = ${filters.programId}` : Prisma.empty}
    ${filters.classScheduleId ? Prisma.sql`AND cs."id" = ${filters.classScheduleId}` : Prisma.empty}
  `;
}

function refundStateSql(refundState?: RevenueRefundState) {
  if (refundState === "NONE") return Prisma.sql`AND pi."refundedAmount" = 0`;
  if (refundState === "PARTIAL") {
    return Prisma.sql`AND pi."refundedAmount" > 0 AND pi."refundedAmount" < pi."paidAmount"`;
  }
  if (refundState === "FULL") return Prisma.sql`AND pi."refundedAmount" = pi."paidAmount"`;
  return Prisma.empty;
}

export function buildOperationFactsQuery(filters: OperationFilters) {
  return Prisma.sql`
    SELECT
      cs."id" AS "classScheduleId",
      p."id" AS "programId",
      p."name" AS "programName",
      cs."startsAt" AS "startsAt",
      COUNT(r."id") FILTER (
        WHERE r."id" IS NOT NULL
          AND (r."status" <> 'CANCELLED' OR r."attendance" IS NOT NULL)
      ) AS "reservationCount",
      COUNT(r."id") FILTER (WHERE r."status" = 'CANCELLED') AS "cancellationCount",
      COUNT(r."id") FILTER (WHERE r."attendance" = 'PRESENT') AS "participantCount"
    FROM "ClassSchedule" cs
    JOIN "Program" p ON p."id" = cs."programId"
    LEFT JOIN "Reservation" r ON r."classScheduleId" = cs."id"
    WHERE cs."startsAt" >= ${filters.startUtc}
      AND cs."startsAt" < ${filters.endExclusiveUtc}
      ${scopeSql(filters)}
    GROUP BY cs."id", p."id", p."name", cs."startsAt"
  `;
}

export function buildPaymentFactsQuery(filters: FinancialFilters) {
  return Prisma.sql`
    SELECT
      cs."id" AS "classScheduleId",
      p."id" AS "programId",
      p."name" AS "programName",
      cs."startsAt" AS "startsAt",
      COALESCE(SUM(pi."amount"), 0) AS "amount",
      COALESCE(SUM(pi."discountAmount"), 0) AS "discountAmount",
      COALESCE(SUM(pi."paidAmount"), 0) AS "paidAmount"
    FROM "PaymentItem" pi
    JOIN "Payment" pay ON pay."id" = pi."paymentId"
    JOIN "Reservation" r ON r."id" = pi."reservationId"
    JOIN "ClassSchedule" cs ON cs."id" = r."classScheduleId"
    JOIN "Program" p ON p."id" = cs."programId"
    WHERE pay."paidAt" >= ${filters.startUtc}
      AND pay."paidAt" < ${filters.endExclusiveUtc}
      AND pay."status" IN ('PAID', 'PARTIAL_REFUNDED', 'REFUNDED')
      ${scopeSql(filters)}
      ${filters.paymentMethod ? Prisma.sql`AND pay."method" = ${filters.paymentMethod}::"PaymentMethod"` : Prisma.empty}
      ${refundStateSql(filters.refundState)}
    GROUP BY cs."id", p."id", p."name", cs."startsAt"
  `;
}

export function buildRefundFactsQuery(filters: FinancialFilters) {
  return Prisma.sql`
    SELECT
      cs."id" AS "classScheduleId",
      p."id" AS "programId",
      p."name" AS "programName",
      cs."startsAt" AS "startsAt",
      COALESCE(SUM(ref."amount"), 0) AS "refundedAmount"
    FROM "Refund" ref
    JOIN "PaymentItem" pi ON pi."id" = ref."paymentItemId"
    JOIN "Payment" pay ON pay."id" = pi."paymentId"
    JOIN "Reservation" r ON r."id" = pi."reservationId"
    JOIN "ClassSchedule" cs ON cs."id" = r."classScheduleId"
    JOIN "Program" p ON p."id" = cs."programId"
    WHERE ref."refundedAt" >= ${filters.startUtc}
      AND ref."refundedAt" < ${filters.endExclusiveUtc}
      AND ref."status" = 'COMPLETED'
      ${scopeSql(filters)}
      ${filters.paymentMethod ? Prisma.sql`AND pay."method" = ${filters.paymentMethod}::"PaymentMethod"` : Prisma.empty}
      ${refundStateSql(filters.refundState)}
    GROUP BY cs."id", p."id", p."name", cs."startsAt"
  `;
}

export async function getRevenueReport(filters: RevenueQueryFilters) {
  // ADR-040: 각 fact를 독립 집계한 뒤 애플리케이션에서 병합한다.
  // PaymentItem과 Refund를 한 JOIN으로 합치면 Refund 행 수만큼 결제금액이 중복 합산된다.
  const [operations, payments, refunds] = await Promise.all([
    prisma.$queryRaw<OperationFact[]>(buildOperationFactsQuery(filters)),
    prisma.$queryRaw<PaymentFact[]>(buildPaymentFactsQuery(filters)),
    prisma.$queryRaw<RefundFact[]>(buildRefundFactsQuery(filters)),
  ]);

  return mergeRevenueFacts({ operations, payments, refunds });
}

export async function listRevenueProgramOptions() {
  return prisma.program.findMany({
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
