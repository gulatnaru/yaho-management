import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    child: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { listChildren, getChildDetail } = await import("@/lib/children/queries");

describe("listChildren", () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
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
