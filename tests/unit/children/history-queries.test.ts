import { beforeEach, describe, expect, it, vi } from "vitest";

const groupByMock = vi.fn();
const countMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: {
      groupBy: (...args: unknown[]) => groupByMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const {
  buildChildPastHistoryWhere,
  buildChildUpcomingWhere,
  getChildHistorySummary,
  listChildPastHistory,
  listChildUpcomingReservations,
} = await import("@/server/children/history");

const NOW = new Date("2026-09-11T03:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  groupByMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  findManyMock.mockResolvedValue([]);
});

describe("child history queries", () => {
  it("counts overlapping reservation, attendance, cancellation, and upcoming axes", async () => {
    groupByMock.mockResolvedValue([
      { status: "RESERVED", attendance: null, _count: { _all: 3 } },
      { status: "COMPLETED", attendance: "PRESENT", _count: { _all: 2 } },
      { status: "NO_SHOW", attendance: "ABSENT", _count: { _all: 1 } },
      { status: "CANCELLED", attendance: "PRESENT", _count: { _all: 1 } },
      { status: "CANCELLED", attendance: "ABSENT", _count: { _all: 1 } },
      { status: "CANCELLED", attendance: null, _count: { _all: 1 } },
    ]);
    countMock.mockResolvedValue(2);

    await expect(getChildHistorySummary("child-1", NOW)).resolves.toEqual({
      totalReservations: 9,
      presentCount: 3,
      absentCount: 2,
      cancelledCount: 3,
      upcomingCount: 2,
    });

    expect(groupByMock).toHaveBeenCalledWith({
      by: ["status", "attendance"],
      where: { childId: "child-1" },
      _count: { _all: true },
    });
    expect(countMock).toHaveBeenCalledWith({
      where: buildChildUpcomingWhere("child-1", NOW),
    });
  });

  it("defines upcoming with RESERVED, SCHEDULED, and an inclusive endsAt boundary", () => {
    expect(buildChildUpcomingWhere("child-1", NOW)).toEqual({
      childId: "child-1",
      status: "RESERVED",
      classSchedule: { status: "SCHEDULED", endsAt: { gte: NOW } },
    });
  });

  it("defines past history explicitly, including cancelled classes and ended RESERVED rows", () => {
    expect(buildChildPastHistoryWhere("child-1", NOW)).toEqual({
      childId: "child-1",
      OR: [
        { status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
        { classSchedule: { status: "CANCELLED" } },
        { status: "RESERVED", classSchedule: { endsAt: { lt: NOW } } },
      ],
    });
  });

  it("loads every upcoming row in deterministic nearest-first order with a minimal select", async () => {
    await listChildUpcomingReservations("child-1", NOW);

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0];
    expect(call.where).toEqual(buildChildUpcomingWhere("child-1", NOW));
    expect(call.orderBy).toEqual([
      { classSchedule: { startsAt: "asc" } },
      { id: "asc" },
    ]);
    expect(call).not.toHaveProperty("take");
    expect(call.select.paymentItem).toEqual({
      select: { payment: { select: { status: true } } },
    });
    const serialized = JSON.stringify(call.select);
    for (const forbidden of [
      "safetyInfo",
      "guardianName",
      "guardianPhone",
      "consent",
      "paidAmount",
      "discountAmount",
      "refundedAmount",
      "refunds",
      "cancelReason",
      "cancelDetail",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    [1, 10],
    [2, 20],
    [3, 30],
  ])("loads cumulative history page %s with take %s", async (page, take) => {
    countMock.mockResolvedValue(31);
    findManyMock.mockResolvedValue(Array.from({ length: take }, (_, index) => ({ id: `r-${index}` })));

    const result = await listChildPastHistory("child-1", NOW, page);

    const call = findManyMock.mock.calls[0][0];
    expect(call.where).toEqual(buildChildPastHistoryWhere("child-1", NOW));
    expect(call.orderBy).toEqual([
      { classSchedule: { startsAt: "desc" } },
      { id: "desc" },
    ]);
    expect(call.take).toBe(take);
    expect(result).toEqual(
      expect.objectContaining({ total: 31, page, pageSize: 10, hasMore: true }),
    );
  });

  it("hides more when every past row is visible and defensively normalizes an invalid page", async () => {
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([{ id: "r-1" }]);

    const result = await listChildPastHistory("child-1", NOW, 0);

    expect(findManyMock.mock.calls[0][0].take).toBe(10);
    expect(result).toEqual(
      expect.objectContaining({ page: 1, total: 1, hasMore: false }),
    );
  });
});
