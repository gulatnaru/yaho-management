import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawMock, classFindManyMock, reservationCountMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  classFindManyMock: vi.fn(),
  reservationCountMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    classSchedule: { findMany: classFindManyMock },
    reservation: { count: reservationCountMock },
  },
}));

import {
  buildMonthlyCalendarQuery,
  buildTodayPaymentsQuery,
  buildTodayRefundsQuery,
  getDashboardClasses,
  getMonthlyCalendarMetrics,
  getTodayCancellationCount,
  getTodayFinancialMetrics,
} from "@/server/dashboard/queries";

const range = {
  startUtc: new Date("2026-08-31T15:00:00.000Z"),
  endExclusiveUtc: new Date("2026-09-30T15:00:00.000Z"),
};

function sqlText(query: { strings: string[] }) {
  return query.strings.join(" ").replace(/\s+/g, " ");
}

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe("dashboard queries", () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    classFindManyMock.mockReset();
    reservationCountMock.mockReset();
  });

  it("aggregates KST dates, excludes cancelled classes, and avoids class duplication", async () => {
    const sql = sqlText(buildMonthlyCalendarQuery(range));
    expect(sql).toContain("COUNT(DISTINCT cs.\"id\")");
    expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'");
    expect(sql).toContain("cs.\"status\" <> 'CANCELLED'");
    expect(sql).toContain("'RESERVED', 'COMPLETED', 'NO_SHOW'");
    expect(sql).toContain("r.\"status\" = 'CANCELLED' AND r.\"attendance\" IS NOT NULL");

    queryRawMock.mockResolvedValueOnce([
      { date: "2026-09-01", classCount: 2n, operationReservationCount: 5n },
    ]);
    await expect(getMonthlyCalendarMetrics(range)).resolves.toEqual([
      { date: "2026-09-01", classCount: 2, operationReservationCount: 5 },
    ]);
  });

  it("selects only the class-list data and applies the operation reservation predicate", async () => {
    classFindManyMock.mockResolvedValueOnce([]);
    await getDashboardClasses(range);

    const args = classFindManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      startsAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
      status: { not: "CANCELLED" },
    });
    expect(args.select.reservations.where.OR).toEqual([
      { status: { in: ["RESERVED", "COMPLETED", "NO_SHOW"] } },
      { status: "CANCELLED", attendance: { not: null } },
    ]);
    const keys = collectKeys(args.select);
    for (const forbidden of [
      "safetyInfo",
      "guardianName",
      "guardianPhone",
      "phone",
      "memo",
      "allergies",
      "emergencyContactPhone",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("keeps operation and current reserved counts separate", async () => {
    classFindManyMock.mockResolvedValueOnce([
      {
        id: "class-1",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-09-01T01:00:00.000Z"),
        location: "숲",
        capacity: 8,
        program: { id: "program-1", name: "숲 체험" },
        teachers: [],
        reservations: [
          { id: "r1", status: "RESERVED", attendance: null, child: { id: "c1", name: "가" } },
          { id: "r2", status: "COMPLETED", attendance: "PRESENT", child: { id: "c2", name: "나" } },
          { id: "r3", status: "CANCELLED", attendance: "ABSENT", child: { id: "c3", name: "다" } },
        ],
      },
    ]);

    const [result] = await getDashboardClasses(range);
    expect(result).toMatchObject({ operationReservationCount: 3, reservedCount: 1, remainingSeats: 7 });
  });

  it("counts cancellation activity only by cancelledAt", async () => {
    reservationCountMock.mockResolvedValueOnce(4);
    await expect(getTodayCancellationCount(range)).resolves.toBe(4);

    const args = reservationCountMock.mock.calls[0][0];
    expect(args.where).toEqual({ cancelledAt: { gte: range.startUtc, lt: range.endExclusiveUtc } });
    expect(args.where).not.toHaveProperty("classSchedule");
  });

  it("uses ADR-040 transaction dates and completed refunds independently", async () => {
    const paymentSql = sqlText(buildTodayPaymentsQuery(range));
    const refundSql = sqlText(buildTodayRefundsQuery(range));
    expect(paymentSql).toContain('pay."paidAt" >=');
    expect(paymentSql).toContain("'PAID', 'PARTIAL_REFUNDED', 'REFUNDED'");
    expect(refundSql).toContain('ref."refundedAt" >=');
    expect(refundSql).toContain("ref.\"status\" = 'COMPLETED'");
    expect(refundSql).not.toContain('pay."paidAt"');

    queryRawMock.mockResolvedValueOnce([{ amount: 10_000n }]).mockResolvedValueOnce([{ amount: 30_000n }]);
    await expect(getTodayFinancialMetrics(range)).resolves.toEqual({
      paidAmount: 10_000,
      refundedAmount: 30_000,
      netRevenue: -20_000,
    });
  });
});
