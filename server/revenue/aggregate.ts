import type {
  OperationFact,
  PaymentFact,
  RefundFact,
  RevenueClassContext,
  RevenueClassRow,
  RevenueMetrics,
  RevenueProgramRow,
  RevenueReport,
} from "@/server/revenue/types";

export const EMPTY_REVENUE_METRICS: RevenueMetrics = {
  reservationCount: 0,
  cancellationCount: 0,
  participantCount: 0,
  amount: 0,
  discountAmount: 0,
  paidAmount: 0,
  refundedAmount: 0,
  netRevenue: 0,
};

function toNumber(value: number | bigint | string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("집계값이 안전한 정수 범위를 벗어났습니다.");
  return parsed;
}

function addMetrics(target: RevenueMetrics, source: RevenueMetrics): RevenueMetrics {
  return {
    reservationCount: target.reservationCount + source.reservationCount,
    cancellationCount: target.cancellationCount + source.cancellationCount,
    participantCount: target.participantCount + source.participantCount,
    amount: target.amount + source.amount,
    discountAmount: target.discountAmount + source.discountAmount,
    paidAmount: target.paidAmount + source.paidAmount,
    refundedAmount: target.refundedAmount + source.refundedAmount,
    netRevenue: target.netRevenue + source.netRevenue,
  };
}

function ensureClassRow(rows: Map<string, RevenueClassRow>, context: RevenueClassContext): RevenueClassRow {
  const existing = rows.get(context.classScheduleId);
  if (existing) return existing;

  const row: RevenueClassRow = { ...context, ...EMPTY_REVENUE_METRICS };
  rows.set(context.classScheduleId, row);
  return row;
}

export function mergeRevenueFacts(input: {
  operations: OperationFact[];
  payments: PaymentFact[];
  refunds: RefundFact[];
}): RevenueReport {
  const classRows = new Map<string, RevenueClassRow>();

  for (const fact of input.operations) {
    const row = ensureClassRow(classRows, fact);
    row.reservationCount += toNumber(fact.reservationCount);
    row.cancellationCount += toNumber(fact.cancellationCount);
    row.participantCount += toNumber(fact.participantCount);
  }

  for (const fact of input.payments) {
    const row = ensureClassRow(classRows, fact);
    row.amount += toNumber(fact.amount);
    row.discountAmount += toNumber(fact.discountAmount);
    row.paidAmount += toNumber(fact.paidAmount);
  }

  for (const fact of input.refunds) {
    const row = ensureClassRow(classRows, fact);
    row.refundedAmount += toNumber(fact.refundedAmount);
  }

  const classes = [...classRows.values()]
    .map((row) => ({ ...row, netRevenue: row.paidAmount - row.refundedAmount }))
    .sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime());
  const programRows = new Map<string, RevenueProgramRow>();
  let summary = { ...EMPTY_REVENUE_METRICS };

  for (const row of classes) {
    summary = addMetrics(summary, row);
    const existing = programRows.get(row.programId) ?? {
      programId: row.programId,
      programName: row.programName,
      classCount: 0,
      ...EMPTY_REVENUE_METRICS,
    };
    const totals = addMetrics(existing, row);
    programRows.set(row.programId, {
      ...totals,
      programId: row.programId,
      programName: row.programName,
      classCount: existing.classCount + 1,
    });
  }

  return {
    summary,
    programs: [...programRows.values()].sort((left, right) => left.programName.localeCompare(right.programName, "ko")),
    classes,
  };
}
