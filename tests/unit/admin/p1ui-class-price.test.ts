/**
 * P1-UI U-01/U-02 — 수업 신청 최종 금액: SUPER_ADMIN은 ADMIN과 동일하게
 * 금액을 제출·저장할 수 있고, MANAGER는 거부되며, 가드 거부는 쓰기 전에 막힌다.
 * 화면 표시와 서버 검증은 동일한 isAdminOrSuperAdmin 판정을 공유한다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAdmin, isAdminOrSuperAdmin } from "@/lib/auth/roles";

const classRequireMock = vi.fn();
const classCreateMock = vi.fn();
const classUpdateManyMock = vi.fn();
const classFindUniqueMock = vi.fn();
const classTeacherCreateManyMock = vi.fn();
const classTeacherFindManyMock = vi.fn();
const classTeacherDeleteManyMock = vi.fn();
const classProgramFindUniqueMock = vi.fn();
const classTeacherCountMock = vi.fn();
const classQueryRawMock = vi.fn();
const classTransactionMock = vi.fn();

const classTxMock = {
  $queryRaw: (...args: unknown[]) => classQueryRawMock(...args),
  classSchedule: {
    findUnique: async () => ({ updatedAt: new Date(0) }),
    create: (...args: unknown[]) => classCreateMock(...args),
    updateMany: (...args: unknown[]) => classUpdateManyMock(...args),
  },
  classTeacher: {
    createMany: (...args: unknown[]) => classTeacherCreateManyMock(...args),
    findMany: (...args: unknown[]) => classTeacherFindManyMock(...args),
    deleteMany: (...args: unknown[]) => classTeacherDeleteManyMock(...args),
  },
  program: { findUnique: (...args: unknown[]) => classProgramFindUniqueMock(...args) },
  teacher: { count: (...args: unknown[]) => classTeacherCountMock(...args) },
};

vi.mock("@/lib/auth/authorization", () => ({
  requireOperationalPrincipal: async (...args: unknown[]) => {
    const session = await classRequireMock(...args);
    return session?.user ? { ...session.user, userId: session.user.id } : session;
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classSchedule: {
      findUnique: (...args: unknown[]) => classFindUniqueMock(...args),
    },
    program: { findUnique: (...args: unknown[]) => classProgramFindUniqueMock(...args) },
    teacher: { count: (...args: unknown[]) => classTeacherCountMock(...args) },
    $transaction: (...args: unknown[]) => classTransactionMock(...args),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const { createClass, updateClass } = await import("@/app/(admin)/classes/actions");

function classFormData(overrides: Record<string, string | string[]> = {}) {
  const formData = new FormData();
  const base: Record<string, string | string[]> = {
    programId: "program-1",
    date: "2026-09-05",
    startTime: "09:00",
    endTime: "11:00",
    location: "실외 운동장",
    capacity: "8",
    teacherIds: ["teacher-1"],
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    if (Array.isArray(value)) {
      for (const v of value) formData.append(key, v);
    } else {
      formData.set(key, value);
    }
  }
  return formData;
}

describe("isAdminOrSuperAdmin parity predicate", () => {
  it.each([
    ["SUPER_ADMIN", true],
    ["ADMIN", true],
    ["MANAGER", false],
    ["TEACHER", false],
    ["STAFF", false],
  ])("role %s -> %s", (role, expected) => {
    expect(isAdminOrSuperAdmin({ role: role as "ADMIN" })).toBe(expected);
  });

  it("does not change isAdmin: SUPER_ADMIN is not ADMIN", () => {
    expect(isAdmin({ role: "SUPER_ADMIN" })).toBe(false);
    expect(isAdmin({ role: "ADMIN" })).toBe(true);
  });

  it("returns false for undefined principal", () => {
    expect(isAdminOrSuperAdmin(undefined)).toBe(false);
  });
});

describe("U-01/U-02 class application price (server validation)", () => {
  beforeEach(() => {
    classRequireMock.mockReset();
    classCreateMock.mockReset();
    classCreateMock.mockResolvedValue({ id: "class-1" });
    classUpdateManyMock.mockReset();
    classUpdateManyMock.mockResolvedValue({ count: 1 });
    classFindUniqueMock.mockReset();
    classFindUniqueMock.mockResolvedValue({ status: "SCHEDULED", endsAt: new Date("2099-01-01T00:00:00Z") });
    classProgramFindUniqueMock.mockReset();
    classProgramFindUniqueMock.mockResolvedValue({ status: "ACTIVE" });
    classTeacherCountMock.mockReset();
    classTeacherCountMock.mockResolvedValue(1);
    classTransactionMock.mockReset();
    classTransactionMock.mockImplementation(async (fn: (tx: typeof classTxMock) => Promise<unknown>) => fn(classTxMock));
    classTeacherFindManyMock.mockReset();
    classTeacherFindManyMock.mockResolvedValue([{ teacherId: "teacher-1" }]);
    classTeacherCreateManyMock.mockReset();
    classTeacherDeleteManyMock.mockReset();
  });

  it("SUPER_ADMIN create with a price persists it (U-02)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "SUPER_ADMIN" } });

    await expect(createClass({}, classFormData({ applicationPrice: "30000" }))).rejects.toThrow("REDIRECT");

    expect(classCreateMock).toHaveBeenCalledTimes(1);
    expect(classCreateMock.mock.calls[0]![0].data.applicationPrice).toBe(30_000);
  });

  it("ADMIN create with a price persists it unchanged (U-02 regression)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "ADMIN" } });

    await expect(createClass({}, classFormData({ applicationPrice: "30000" }))).rejects.toThrow("REDIRECT");

    expect(classCreateMock.mock.calls[0]![0].data.applicationPrice).toBe(30_000);
  });

  it("SUPER_ADMIN create without a price stores null (U-02)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "SUPER_ADMIN" } });

    await expect(createClass({}, classFormData())).rejects.toThrow("REDIRECT");

    expect(classCreateMock.mock.calls[0]![0].data.applicationPrice).toBeNull();
  });

  it("MANAGER create with a price is rejected before any write (U-02)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "MANAGER" } });

    const result = await createClass({}, classFormData({ applicationPrice: "30000" }));

    expect(result.formError).toBe("신청 최종 금액은 관리자만 설정할 수 있습니다.");
    expect(classTransactionMock).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN update with a changed price writes it via CAS (U-01)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "SUPER_ADMIN" } });

    await expect(
      updateClass(
        "class-1",
        {},
        classFormData({
          applicationPrice: "20000",
          applicationPriceBaseline: "10000",
          applicationPriceRevision: "2026-10-20T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("REDIRECT");

    expect(classUpdateManyMock.mock.calls[0]![0].data.applicationPrice).toBe(20_000);
  });

  it("SUPER_ADMIN update with an unchanged price does not overwrite it (U-01)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "SUPER_ADMIN" } });

    await expect(
      updateClass(
        "class-1",
        {},
        classFormData({
          applicationPrice: "10000",
          applicationPriceBaseline: "10000",
          applicationPriceRevision: "2026-10-20T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("REDIRECT");

    for (const [call] of classUpdateManyMock.mock.calls) {
      expect(call.data).not.toHaveProperty("applicationPrice");
    }
  });

  it("MANAGER update with a price is rejected before any write (U-01)", async () => {
    classRequireMock.mockResolvedValue({ user: { role: "MANAGER" } });

    const result = await updateClass("class-1", {}, classFormData({ applicationPrice: "20000" }));

    expect(result.formError).toBe("신청 최종 금액은 관리자만 설정할 수 있습니다.");
    expect(classUpdateManyMock).not.toHaveBeenCalled();
  });

  it("guard denial rejects before any write", async () => {
    classRequireMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createClass({}, classFormData())).rejects.toThrow("UNAUTHORIZED");
    expect(classTransactionMock).not.toHaveBeenCalled();
  });
});
