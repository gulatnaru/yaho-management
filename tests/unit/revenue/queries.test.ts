import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawMock, programFindManyMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  programFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    program: { findMany: programFindManyMock },
  },
}));

import {
  buildOperationFactsQuery,
  buildPaymentFactsQuery,
  buildRefundFactsQuery,
  getRevenueReport,
} from "@/server/revenue/queries";

const baseFilters = {
  dateFrom: "2026-08-01",
  dateTo: "2026-08-31",
  startUtc: new Date("2026-07-31T15:00:00.000Z"),
  endExclusiveUtc: new Date("2026-08-31T15:00:00.000Z"),
  programId: "program-1",
};

function sqlText(query: { strings: string[] }) {
  return query.strings.join(" ").replace(/\s+/g, " ");
}

describe("revenue fact queries", () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    programFindManyMock.mockReset();
  });

  it("keeps payment method and refund-state filters out of the operation query", () => {
    const operation = sqlText(buildOperationFactsQuery(baseFilters));
    const payment = sqlText(
      buildPaymentFactsQuery({ ...baseFilters, paymentMethod: "CARD", refundState: "PARTIAL" }),
    );

    expect(operation).toContain('cs."startsAt" >=');
    expect(operation).toContain('r."attendance" = \'PRESENT\'');
    expect(operation).not.toContain('pay."method"');
    expect(operation).not.toContain('pi."refundedAmount"');
    expect(payment).toContain('pay."paidAt" >=');
    expect(payment).toContain('pay."method" =');
    expect(payment).toContain('pi."refundedAmount" > 0');
  });

  it("uses refund processing time and COMPLETED refunds only", () => {
    const refund = sqlText(buildRefundFactsQuery({ ...baseFilters, refundState: "FULL" }));

    expect(refund).toContain('ref."refundedAt" >=');
    expect(refund).toContain('ref."status" = \'COMPLETED\'');
    expect(refund).toContain('pi."refundedAmount" = pi."paidAmount"');
    expect(refund).not.toContain('pay."status" IN');
  });

  it("runs the three facts independently and merges their results", async () => {
    queryRawMock
      .mockResolvedValueOnce([
        {
          classScheduleId: "class-1",
          programId: "program-1",
          programName: "숲 체험",
          startsAt: new Date("2026-08-10T00:00:00.000Z"),
          reservationCount: 1n,
          cancellationCount: 0n,
          participantCount: 1n,
        },
      ])
      .mockResolvedValueOnce([
        {
          classScheduleId: "class-1",
          programId: "program-1",
          programName: "숲 체험",
          startsAt: new Date("2026-08-10T00:00:00.000Z"),
          amount: 50_000n,
          discountAmount: 5_000n,
          paidAmount: 45_000n,
        },
      ])
      .mockResolvedValueOnce([
        {
          classScheduleId: "class-1",
          programId: "program-1",
          programName: "숲 체험",
          startsAt: new Date("2026-08-10T00:00:00.000Z"),
          refundedAmount: 10_000n,
        },
      ]);

    const report = await getRevenueReport({ ...baseFilters, paymentMethod: "CARD", refundState: "PARTIAL" });

    expect(queryRawMock).toHaveBeenCalledTimes(3);
    expect(report.summary).toMatchObject({
      reservationCount: 1,
      participantCount: 1,
      amount: 50_000,
      paidAmount: 45_000,
      refundedAmount: 10_000,
      netRevenue: 35_000,
    });
  });
});
