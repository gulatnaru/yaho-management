import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    teacher: {
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

const { createTeacher, updateTeacher, setTeacherActive } = await import("@/app/(admin)/teachers/actions");

function formDataWithName(name: string) {
  const formData = new FormData();
  formData.set("name", name);
  return formData;
}

describe("teachers server actions require admin", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("createTeacher rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createTeacher({}, formDataWithName("선생님"))).rejects.toThrow("UNAUTHORIZED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateTeacher rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(updateTeacher("teacher-1", {}, formDataWithName("선생님"))).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("setTeacherActive rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(setTeacherActive("teacher-1", false)).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("createTeacher validation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    createMock.mockReset();
  });

  it("returns field errors and never calls prisma.teacher.create when name is blank", async () => {
    const result = await createTeacher({}, formDataWithName("   "));

    expect(result.errors?.name).toBeDefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  // 버그 리그레션: React 19 Server Action 폼은 액션 완료 시 uncontrolled 필드를 defaultValue로
  // 리셋한다. 검증 실패 시 사용자가 입력했던 원본 값을 `values`로 돌려주지 않으면 재렌더링 시
  // 입력값이 전부 사라진다. actions가 이 원본 값을 그대로 보존해 돌려주는지 검증한다.
  it("returns the submitted raw values in `values` when validation fails, so the form can preserve them", async () => {
    const formData = new FormData();
    formData.set("name", "   ");
    formData.set("phone", "abc"); // invalid phone format
    formData.set("memo", "메모");

    const result = await createTeacher({}, formData);

    expect(result.errors?.name).toBeDefined();
    expect(result.values).toEqual({ name: "   ", phone: "abc", memo: "메모" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateTeacher also returns the submitted raw values in `values` when validation fails", async () => {
    const formData = new FormData();
    formData.set("name", "");
    formData.set("phone", "abc");

    const result = await updateTeacher("teacher-1", {}, formData);

    expect(result.errors).toBeDefined();
    expect(result.values).toMatchObject({ name: "", phone: "abc" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("setTeacherActive", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    updateMock.mockReset();
    updateMock.mockResolvedValue({});
  });

  it("only calls prisma.teacher.update with isActive, never a delete method", async () => {
    const result = await setTeacherActive("teacher-1", false);

    expect(result).toEqual({});
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "teacher-1" }, data: { isActive: false } });
  });
});

describe("no hard delete anywhere in the codebase", () => {
  it("app/ and lib/ never call prisma.teacher.delete", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(currentDir, "../../..");
    const targets = ["app", "lib"];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(full, "utf-8");
          if (/teacher\s*\.\s*delete\s*\(/.test(content)) {
            offenders.push(full);
          }
        }
      }
    }

    for (const target of targets) {
      walk(path.join(root, target));
    }

    expect(offenders).toEqual([]);
  });
});
