import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    program: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { listPrograms, getProgramDetail } = await import("@/lib/programs/queries");

describe("listPrograms", () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
  });

  it("paginates 20 per page ordered by name", async () => {
    await listPrograms({ status: "all", page: 2 });

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.take).toBe(20);
    expect(callArgs.skip).toBe(20);
    expect(callArgs.orderBy).toEqual({ name: "asc" });
  });

  it("defaults to page 1 when page is omitted or invalid", async () => {
    await listPrograms({ status: "all" });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);

    findManyMock.mockClear();
    await listPrograms({ status: "all", page: 0 });
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);
  });
});

describe("getProgramDetail", () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
  });

  it("returns null when the program does not exist", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await getProgramDetail("missing");

    expect(result).toBeNull();
  });
});
