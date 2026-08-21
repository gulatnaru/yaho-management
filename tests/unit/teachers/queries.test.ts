import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    teacher: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { listTeachers, getTeacherDetail } = await import("@/lib/teachers/queries");

describe("listTeachers", () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
  });

  it("paginates 20 per page ordered by name", async () => {
    await listTeachers({ status: "all", page: 2 });

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.take).toBe(20);
    expect(callArgs.skip).toBe(20);
    expect(callArgs.orderBy).toEqual({ name: "asc" });
  });

  it("defaults to page 1 when page is omitted or invalid", async () => {
    await listTeachers({ status: "all" });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);

    findManyMock.mockClear();
    await listTeachers({ status: "all", page: 0 });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);
  });
});

describe("getTeacherDetail", () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
  });

  it("returns null when the teacher does not exist", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await getTeacherDetail("missing");

    expect(result).toBeNull();
  });
});
