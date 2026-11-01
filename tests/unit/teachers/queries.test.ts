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

const { listTeachers, getTeacherDetail, getTeacherDetailForPrincipal } = await import("@/lib/teachers/queries");

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

  it("does not query another Teacher for a TEACHER principal", async () => {
    const result = await getTeacherDetailForPrincipal("teacher-2", {
      userId: "user-1",
      name: "선생님",
      email: "teacher@yaho.test",
      role: "TEACHER",
      teacherId: "teacher-1",
      authVersion: 1,
      mustChangePassword: false,
    });

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("does not query an existing teacher for STAFF", async () => {
    findUniqueMock.mockResolvedValueOnce({ id: "teacher-1", name: "선생님", phone: "010", memo: "운영 메모", isActive: true });
    await expect(getTeacherDetailForPrincipal("teacher-1", {
      userId: "staff", name: "직원", email: "staff@yaho.test", role: "STAFF", teacherId: null, authVersion: 1, mustChangePassword: false,
    })).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
    findUniqueMock.mockReset();
  });

  it.each(["ADMIN", "MANAGER", "SUPER_ADMIN", "TEACHER"] as const)("preserves %s teacher detail lookup", async (role) => {
    const teacher = { id: "teacher-1", name: "선생님", phone: "010", memo: "운영 메모", isActive: true };
    findUniqueMock.mockResolvedValueOnce(teacher);
    const base = { userId: "user", name: "사용자", email: "user@yaho.test", authVersion: 1, mustChangePassword: false };
    const principal = role === "TEACHER" ? { ...base, role, teacherId: "teacher-1" } : { ...base, role, teacherId: null };
    await expect(getTeacherDetailForPrincipal("teacher-1", principal)).resolves.toEqual(teacher);
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: "teacher-1" } });
  });
});
