import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);
const requireAdminPrincipalMock = vi.fn();
const requireOperationalPrincipalMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: (...args: unknown[]) => requireAdminPrincipalMock(...args),
  requireOperationalPrincipal: (...args: unknown[]) => requireOperationalPrincipalMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    program: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getProgramAdminDetail, getProgramOperationalDetail, listPrograms } = await import("@/lib/programs/queries");

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

describe("role-aware program detail", () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    requireAdminPrincipalMock.mockReset();
    requireAdminPrincipalMock.mockResolvedValue({ role: "ADMIN" });
    requireOperationalPrincipalMock.mockReset();
    requireOperationalPrincipalMock.mockResolvedValue({ role: "MANAGER" });
  });

  it("returns null when the program does not exist", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await getProgramAdminDetail("missing");

    expect(result).toBeNull();
  });

  it("excludes defaultPrice from the MANAGER projection", async () => {
    await getProgramOperationalDetail("program-1");

    const [[callArg]] = findUniqueMock.mock.calls;
    expect(callArg.select).not.toHaveProperty("defaultPrice");
    expect(callArg.select).toEqual(
      expect.objectContaining({ id: true, name: true, defaultDuration: true, status: true }),
    );
  });

  it("keeps defaultPrice in the ADMIN projection", async () => {
    await getProgramAdminDetail("program-1");

    const [[callArg]] = findUniqueMock.mock.calls;
    expect(callArg.select.defaultPrice).toBe(true);
  });
});
