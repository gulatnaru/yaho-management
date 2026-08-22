import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    program: {
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

const { createProgram, updateProgram, setProgramStatus } = await import("@/app/(admin)/programs/actions");

function formDataWithName(name: string) {
  const formData = new FormData();
  formData.set("name", name);
  return formData;
}

describe("programs server actions require admin", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("createProgram rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createProgram({}, formDataWithName("발레 A반"))).rejects.toThrow("UNAUTHORIZED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateProgram rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(updateProgram("program-1", {}, formDataWithName("발레 A반"))).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("setProgramStatus rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(setProgramStatus("program-1", "INACTIVE")).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("createProgram validation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    createMock.mockReset();
  });

  it("returns field errors and never calls prisma.program.create when name is blank", async () => {
    const result = await createProgram({}, formDataWithName("   "));

    expect(result.errors?.name).toBeDefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  // 버그 리그레션: React 19 Server Action 폼은 액션 완료 시 uncontrolled 필드를 defaultValue로
  // 리셋한다. 검증 실패 시 사용자가 입력했던 원본 값을 `values`로 돌려주지 않으면 재렌더링 시
  // 입력값이 전부 사라진다. actions가 이 원본 값을 그대로 보존해 돌려주는지 검증한다.
  it("returns the submitted raw values in `values` when validation fails, so the form can preserve them", async () => {
    const formData = new FormData();
    formData.set("name", "   ");
    formData.set("description", "설명");
    formData.set("targetAgeMin", "10");
    formData.set("targetAgeMax", "5"); // invalid: min > max
    formData.set("defaultDuration", "60");
    formData.set("defaultPrice", "10000");
    formData.set("memo", "메모");

    const result = await createProgram({}, formData);

    expect(result.errors).toBeDefined();
    expect(result.values).toEqual({
      name: "   ",
      description: "설명",
      targetAgeMin: "10",
      targetAgeMax: "5",
      defaultDuration: "60",
      defaultPrice: "10000",
      memo: "메모",
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateProgram also returns the submitted raw values in `values` when validation fails", async () => {
    const formData = new FormData();
    formData.set("name", "");
    formData.set("targetAgeMin", "10");
    formData.set("targetAgeMax", "5");

    const result = await updateProgram("program-1", {}, formData);

    expect(result.errors).toBeDefined();
    expect(result.values).toMatchObject({ name: "", targetAgeMin: "10", targetAgeMax: "5" });
  });
});

describe("updateProgram", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    updateMock.mockReset();
    updateMock.mockResolvedValue({});
  });

  it("never includes status in the update payload, even if the form data contains one", async () => {
    const formData = formDataWithName("발레 A반");
    // status는 이 폼에서 절대 받지 않는다 — setProgramStatus로만 변경한다.
    // 누군가 실수로 폼에 status 필드를 다시 추가해도 updateProgram이 이를 무시하는지 검증.
    formData.set("status", "INACTIVE");

    await expect(updateProgram("program-1", {}, formData)).rejects.toThrow("REDIRECT");

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = updateMock.mock.calls;
    expect(callArg.data).not.toHaveProperty("status");
  });
});

describe("setProgramStatus", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    updateMock.mockReset();
    updateMock.mockResolvedValue({});
  });

  it("only calls prisma.program.update with status, never a delete method", async () => {
    const result = await setProgramStatus("program-1", "INACTIVE");

    expect(result).toEqual({});
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "program-1" }, data: { status: "INACTIVE" } });
  });
});

describe("no hard delete anywhere in the codebase", () => {
  it("app/ and lib/ never call prisma.program.delete", async () => {
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
          if (/program\s*\.\s*delete\s*\(/.test(content)) {
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
