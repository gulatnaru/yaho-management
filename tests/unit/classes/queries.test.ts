import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn().mockResolvedValue([]);
const countMock = vi.fn().mockResolvedValue(0);
const findUniqueMock = vi.fn().mockResolvedValue(null);
const findFirstMock = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classSchedule: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const { listClasses, getClassDetail, getClassDetailForPrincipal } = await import("@/lib/classes/queries");

const adminPrincipal = {
  userId: "admin-1",
  name: "관리자",
  email: "admin@yaho.test",
  role: "ADMIN" as const,
  teacherId: null,
  authVersion: 1,
  mustChangePassword: false,
};

const teacherPrincipal = {
  userId: "teacher-user-1",
  name: "선생님",
  email: "teacher@yaho.test",
  role: "TEACHER" as const,
  teacherId: "teacher-1",
  authVersion: 1,
  mustChangePassword: false,
};

const FORBIDDEN_SAFETY_KEYS = ["insured", "insurer", "insurancePolicyNo", "safetyMemo"];

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe("listClasses", () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
  });

  it("paginates 20 per page ordered by startsAt ascending", async () => {
    await listClasses({ page: 2 }, adminPrincipal);

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.take).toBe(20);
    expect(callArgs.skip).toBe(20);
    expect(callArgs.orderBy).toEqual({ startsAt: "asc" });
  });

  it("defaults to page 1 when page is omitted or invalid", async () => {
    await listClasses({}, adminPrincipal);
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);

    findManyMock.mockClear();
    await listClasses({ page: 0 }, adminPrincipal);
    expect(findManyMock.mock.calls[0][0].skip).toBe(0);
  });

  it("never selects Phase 6 safety-info fields in the list query", async () => {
    await listClasses({}, adminPrincipal);

    const callArgs = findManyMock.mock.calls[0][0];
    const keys = collectKeys(callArgs.select);
    for (const field of FORBIDDEN_SAFETY_KEYS) expect(keys.has(field)).toBe(false);
  });

  it("selects capacity and counts RESERVED reservations only without an N+1 query", async () => {
    await listClasses({}, adminPrincipal);

    const callArgs = findManyMock.mock.calls[0][0];
    expect(callArgs.select.capacity).toBe(true);
    expect(callArgs.select._count).toEqual({
      select: { reservations: { where: { status: "RESERVED" } } },
    });
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("limits TEACHER lists to classes assigned through ClassTeacher", async () => {
    await listClasses({}, teacherPrincipal);

    expect(findManyMock.mock.calls[0][0].where).toEqual({
      AND: [{}, { teachers: { some: { teacherId: "teacher-1" } } }],
    });
    expect(countMock.mock.calls[0][0].where).toEqual({
      AND: [{}, { teachers: { some: { teacherId: "teacher-1" } } }],
    });
  });
});

describe("getClassDetail", () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    findFirstMock.mockClear();
  });

  it("returns null when the class does not exist", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await getClassDetail("missing");

    expect(result).toBeNull();
  });

  it("selects Phase 6 safety fields on the class detail", async () => {
    await getClassDetail("class-1");

    const callArgs = findUniqueMock.mock.calls[0][0];
    const keys = collectKeys(callArgs.select);
    for (const field of FORBIDDEN_SAFETY_KEYS) expect(keys.has(field)).toBe(true);
  });

  it("includes program, teachers, and cancelledBy relations", async () => {
    await getClassDetail("class-1");

    const callArgs = findUniqueMock.mock.calls[0][0];
    expect(callArgs.select.program).toBeDefined();
    expect(callArgs.select.teachers).toBeDefined();
    expect(callArgs.select.cancelledBy).toBeDefined();
  });

  it("uses assignment-scoped lookup for a TEACHER", async () => {
    await getClassDetailForPrincipal("class-1", teacherPrincipal);

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "class-1",
          teachers: { some: { teacherId: "teacher-1" } },
        },
      }),
    );
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
