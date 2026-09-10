import { beforeEach, describe, expect, it, vi } from "vitest";

const childFindManyMock = vi.fn();
const classScheduleFindManyMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    child: {
      findMany: (...args: unknown[]) => childFindManyMock(...args),
    },
    classSchedule: {
      findMany: (...args: unknown[]) => classScheduleFindManyMock(...args),
    },
  },
}));

const { listActiveChildCandidates, listScheduledClassCandidates } = await import(
  "@/lib/reservations/candidates"
);

describe("listActiveChildCandidates", () => {
  beforeEach(() => {
    childFindManyMock.mockReset();
  });

  it("only queries active children, ordered by name", async () => {
    childFindManyMock.mockResolvedValue([{ id: "child-1", name: "김철수" }]);

    const result = await listActiveChildCandidates();

    expect(result).toEqual([{ id: "child-1", name: "김철수" }]);
    expect(childFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { name: "asc" } }),
    );
  });
});

describe("listScheduledClassCandidates", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");

  beforeEach(() => {
    classScheduleFindManyMock.mockReset();
  });

  it("queries future SCHEDULED classes and includes available, full, and over-capacity candidates", async () => {
    classScheduleFindManyMock.mockResolvedValue([
      {
        id: "class-open",
        status: "SCHEDULED",
        startsAt: new Date("2026-09-05T01:00:00.000Z"),
        endsAt: new Date("2026-09-05T02:00:00.000Z"),
        location: "실외 운동장",
        capacity: 8,
        program: { id: "program-1", name: "발레 A반" },
        _count: { reservations: 3 },
      },
      {
        id: "class-full",
        status: "SCHEDULED",
        startsAt: new Date("2026-09-06T01:00:00.000Z"),
        endsAt: new Date("2026-09-06T02:00:00.000Z"),
        location: "실외 운동장",
        capacity: 2,
        program: { id: "program-1", name: "발레 A반" },
        _count: { reservations: 2 },
      },
      {
        id: "class-over",
        status: "SCHEDULED",
        startsAt: new Date("2026-09-07T01:00:00.000Z"),
        endsAt: new Date("2026-09-07T02:00:00.000Z"),
        location: "실외 운동장",
        capacity: 2,
        program: { id: "program-1", name: "발레 A반" },
        _count: { reservations: 3 },
      },
    ]);

    const result = await listScheduledClassCandidates(now);

    const [[callArg]] = classScheduleFindManyMock.mock.calls;
    expect(callArg.where).toEqual({ status: "SCHEDULED", endsAt: { gte: now } });
    expect(callArg.orderBy).toEqual({ startsAt: "asc" });
    expect(callArg.select._count).toEqual({
      select: { reservations: { where: { status: "RESERVED" } } },
    });
    expect(result.map((item) => [item.id, item.reservedCount])).toEqual([
      ["class-open", 3],
      ["class-full", 2],
      ["class-over", 3],
    ]);
  });

  // 취소되었거나 완료된 클래스는 where: { status: "SCHEDULED" } 로 이미 DB 쿼리에서 제외된다.
  // 여기서는 결과에 그런 상태값이 섞여 있어도(방어적으로) 정원 기준으로만 필터링되는지 확인한다.
  it("keeps a class with zero remaining capacity in the candidate list", async () => {
    classScheduleFindManyMock.mockResolvedValue([
      {
        id: "class-exact",
        status: "SCHEDULED",
        startsAt: new Date("2026-09-05T01:00:00.000Z"),
        endsAt: new Date("2026-09-05T02:00:00.000Z"),
        location: "실외 운동장",
        capacity: 1,
        program: { id: "program-1", name: "발레 A반" },
        _count: { reservations: 1 },
      },
    ]);

    const result = await listScheduledClassCandidates(now);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "class-exact", capacity: 1, reservedCount: 1 });
  });

  // ADR-026: DB status는 클래스가 끝나도 SCHEDULED로 남으므로, endsAt이 과거인(표시상 ENDED)
  // 클래스는 정원이 남아 있어도 후보에서 제외돼야 한다(재예약 차단의 전제 조건).
  it("excludes classes whose endsAt is already past even when capacity remains (display-ended)", async () => {
    classScheduleFindManyMock.mockResolvedValue([
      {
        id: "class-ended",
        status: "SCHEDULED",
        startsAt: new Date("2020-01-01T01:00:00.000Z"),
        endsAt: new Date("2020-01-01T02:00:00.000Z"),
        location: "실외 운동장",
        capacity: 8,
        program: { id: "program-1", name: "발레 A반" },
        _count: { reservations: 0 },
      },
    ]);

    const result = await listScheduledClassCandidates(now);

    expect(result).toEqual([]);
  });
});
