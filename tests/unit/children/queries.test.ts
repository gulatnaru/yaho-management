import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);
const reservationFindManyMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    child: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    reservation: {
      findMany: (...args: unknown[]) => reservationFindManyMock(...args),
    },
  },
}));

const { listChildren, getChildDetail } = await import("@/lib/children/queries");

describe("listChildren", () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
    reservationFindManyMock.mockReset();
    reservationFindManyMock.mockResolvedValue([]);
  });

  it("never selects or includes ChildSafetyInfo", async () => {
    await listChildren({ status: "all" });

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.include).toBeUndefined();
    expect(JSON.stringify(callArgs)).not.toContain("safetyInfo");
  });

  it("paginates 20 per page ordered by name", async () => {
    await listChildren({ status: "all", page: 2 });

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.take).toBe(20);
    expect(callArgs.skip).toBe(20);
    expect(callArgs.orderBy).toEqual({ name: "asc" });
  });

  it("defaults to page 1 when page is omitted or invalid", async () => {
    await listChildren({ status: "all" });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);

    findManyMock.mockClear();
    await listChildren({ status: "all", page: 0 });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);
  });

  it("does not query next reservation dates when the page has no children (avoids an empty IN query)", async () => {
    findManyMock.mockResolvedValueOnce([]);

    await listChildren({ status: "all" });

    expect(reservationFindManyMock).not.toHaveBeenCalled();
  });

  it("batches a single reservation query for all children on the page instead of N+1", async () => {
    findManyMock.mockResolvedValueOnce([
      { id: "child-1", name: "A" },
      { id: "child-2", name: "B" },
    ]);

    await listChildren({ status: "all" });

    expect(reservationFindManyMock).toHaveBeenCalledTimes(1);
    const callArgs = reservationFindManyMock.mock.calls[0][0];
    expect(callArgs.where.childId).toEqual({ in: ["child-1", "child-2"] });
    expect(callArgs.where.status).toBe("RESERVED");
  });

  it("attaches each child's nearest future RESERVED reservation date, formatted as KST", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "child-1", name: "A" }]);
    reservationFindManyMock.mockResolvedValueOnce([
      { childId: "child-1", classSchedule: { startsAt: new Date("2026-09-10T01:00:00Z") } }, // 2026-09-10 10:00 KST
      { childId: "child-1", classSchedule: { startsAt: new Date("2026-09-20T01:00:00Z") } },
    ]);

    const { children } = await listChildren({ status: "all" });

    expect(children[0].nextReservationDate).toBe("2026-09-10");
  });

  it("sets nextReservationDate to null when a child has no upcoming RESERVED reservation", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "child-1", name: "A" }]);
    reservationFindManyMock.mockResolvedValueOnce([]);

    const { children } = await listChildren({ status: "all" });

    expect(children[0].nextReservationDate).toBeNull();
  });
});

describe("getChildDetail", () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
  });

  it("never includes ChildSafetyInfo", async () => {
    findUniqueMock.mockResolvedValueOnce({ id: "child-1" });

    await getChildDetail("child-1");

    const callArgs = findUniqueMock.mock.calls[0][0];
    expect(JSON.stringify(callArgs)).not.toContain("safetyInfo");
  });

  it("returns null when the child does not exist", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await getChildDetail("missing");

    expect(result).toBeNull();
  });
});
