import { describe, expect, it } from "vitest";
import { mergeRevenueFacts } from "@/server/revenue/aggregate";

const classContext = {
  classScheduleId: "class-1",
  programId: "program-1",
  programName: "숲 체험",
  startsAt: new Date("2026-07-10T00:00:00.000Z"),
};

describe("mergeRevenueFacts", () => {
  it("merges independent facts without multiplying a payment by multiple refunds", () => {
    const report = mergeRevenueFacts({
      operations: [{ ...classContext, reservationCount: 2n, cancellationCount: 1n, participantCount: 1n }],
      payments: [{ ...classContext, amount: 100_000n, discountAmount: 10_000n, paidAmount: 90_000n }],
      refunds: [
        { ...classContext, refundedAmount: 20_000n },
        { ...classContext, refundedAmount: 10_000n },
      ],
    });

    expect(report.summary).toEqual({
      reservationCount: 2,
      cancellationCount: 1,
      participantCount: 1,
      amount: 100_000,
      discountAmount: 10_000,
      paidAmount: 90_000,
      refundedAmount: 30_000,
      netRevenue: 60_000,
    });
  });

  it("allows negative net revenue when a later-period refund has no payment fact in the period", () => {
    const report = mergeRevenueFacts({
      operations: [],
      payments: [],
      refunds: [{ ...classContext, refundedAmount: 90_000n }],
    });

    expect(report.summary.paidAmount).toBe(0);
    expect(report.summary.refundedAmount).toBe(90_000);
    expect(report.summary.netRevenue).toBe(-90_000);
  });

  it("builds program and summary totals from the merged class rows", () => {
    const secondClass = {
      ...classContext,
      classScheduleId: "class-2",
      startsAt: new Date("2026-07-20T00:00:00.000Z"),
    };
    const report = mergeRevenueFacts({
      operations: [
        { ...classContext, reservationCount: 1, cancellationCount: 0, participantCount: 1 },
        { ...secondClass, reservationCount: 3, cancellationCount: 1, participantCount: 2 },
      ],
      payments: [
        { ...classContext, amount: 10_000, discountAmount: 0, paidAmount: 10_000 },
        { ...secondClass, amount: 20_000, discountAmount: 2_000, paidAmount: 18_000 },
      ],
      refunds: [],
    });

    expect(report.programs).toHaveLength(1);
    expect(report.programs[0]).toMatchObject({
      classCount: 2,
      reservationCount: 4,
      participantCount: 3,
      amount: 30_000,
      discountAmount: 2_000,
      paidAmount: 28_000,
    });
    expect(report.summary).toEqual({
      reservationCount: report.programs[0].reservationCount,
      cancellationCount: report.programs[0].cancellationCount,
      participantCount: report.programs[0].participantCount,
      amount: report.programs[0].amount,
      discountAmount: report.programs[0].discountAmount,
      paidAmount: report.programs[0].paidAmount,
      refundedAmount: report.programs[0].refundedAmount,
      netRevenue: report.programs[0].netRevenue,
    });
  });
});
