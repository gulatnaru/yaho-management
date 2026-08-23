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

const { listActiveChildCandidates, listScheduledClassCandidatesWithCapacity } = await import(
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

describe("listScheduledClassCandidatesWithCapacity", () => {
  beforeEach(() => {
    classScheduleFindManyMock.mockReset();
  });

  it("queries only SCHEDULED classes and excludes classes that are already at capacity", async () => {
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
    ]);

    const result = await listScheduledClassCandidatesWithCapacity();

    expect(classScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "SCHEDULED" }, orderBy: { startsAt: "asc" } }),
    );
    expect(result).toEqual([
      {
        id: "class-open",
        startsAt: new Date("2026-09-05T01:00:00.000Z"),
        location: "실외 운동장",
        capacity: 8,
        reservedCount: 3,
        program: { id: "program-1", name: "발레 A반" },
      },
    ]);
  });

  // 취소되었거나 완료된 클래스는 where: { status: "SCHEDULED" } 로 이미 DB 쿼리에서 제외된다.
  // 여기서는 결과에 그런 상태값이 섞여 있어도(방어적으로) 정원 기준으로만 필터링되는지 확인한다.
  it("excludes classes with zero remaining capacity even when reservedCount equals capacity exactly", async () => {
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

    const result = await listScheduledClassCandidatesWithCapacity();

    expect(result).toEqual([]);
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

    const result = await listScheduledClassCandidatesWithCapacity();

    expect(result).toEqual([]);
  });
});
