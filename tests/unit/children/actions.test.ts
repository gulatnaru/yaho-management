import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireOperationalPrincipal: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    child: {
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

const { createChild, updateChild, setChildActive } = await import("@/app/(admin)/children/actions");

function formDataWithName(name: string) {
  const formData = new FormData();
  formData.set("name", name);
  return formData;
}

describe("children server actions require admin", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("createChild rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(createChild({}, formDataWithName("아이"))).rejects.toThrow("UNAUTHORIZED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateChild rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(updateChild("child-1", {}, formDataWithName("아이"))).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("setChildActive rejects and never touches prisma when requireAdmin denies access", async () => {
    requireAdminMock.mockImplementation(() => {
      throw new Error("UNAUTHORIZED");
    });

    await expect(setChildActive("child-1", false)).rejects.toThrow("UNAUTHORIZED");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("createChild validation", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    createMock.mockReset();
  });

  it("returns field errors and never calls prisma.child.create when name is blank", async () => {
    const result = await createChild({}, formDataWithName("   "));

    expect(result.errors?.name).toBeDefined();
    expect(createMock).not.toHaveBeenCalled();
  });

  // 버그 리그레션: React 19 Server Action 폼은 액션 완료 시 uncontrolled 필드를 defaultValue로
  // 리셋한다. 검증 실패 시 사용자가 입력했던 원본 값을 `values`로 돌려주지 않으면 재렌더링 시
  // 입력값이 전부 사라진다. actions가 이 원본 값을 그대로 보존해 돌려주는지 검증한다.
  it("returns the submitted raw values in `values` when validation fails, so the form can preserve them", async () => {
    const formData = new FormData();
    formData.set("name", "   "); // invalid: blank after trim -> triggers validation failure
    formData.set("birthDate", "2020-01-01");
    formData.set("gender", "MALE");
    formData.set("guardianName", "  홍길동  "); // raw value, not trimmed
    formData.set("guardianPhone", "010-1234-5678");
    formData.set("memo", "메모");

    const result = await createChild({}, formData);

    expect(result.errors?.name).toBeDefined();
    expect(result.values).toEqual({
      name: "   ",
      birthDate: "2020-01-01",
      gender: "MALE",
      guardianName: "  홍길동  ",
      guardianPhone: "010-1234-5678",
      memo: "메모",
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("updateChild also returns the submitted raw values in `values` when validation fails", async () => {
    const formData = new FormData();
    formData.set("name", "");
    formData.set("guardianPhone", "abc"); // invalid phone format

    const result = await updateChild("child-1", {}, formData);

    expect(result.errors).toBeDefined();
    expect(result.values).toMatchObject({ name: "", guardianPhone: "abc" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("setChildActive", () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue({ user: { role: "ADMIN" } });
    updateMock.mockReset();
    updateMock.mockResolvedValue({});
    findUniqueMock.mockReset();
  });

  it("refuses to reactivate a child whose personal data was purged (ADR-057)", async () => {
    const { Prisma } = await import("@prisma/client");
    updateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record to update not found.", { code: "P2025", clientVersion: "test" }),
    );
    findUniqueMock.mockResolvedValueOnce({ personalDataPurgedAt: new Date("2031-01-01T00:00:00Z") });

    await expect(setChildActive("child-1", true)).resolves.toEqual({
      error: "보관기간이 지나 개인정보를 파기한 아이는 수정할 수 없습니다.",
    });
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: "child-1" }, select: { personalDataPurgedAt: true } });
  });

  // MSG-1: 없는 아이를 "파기된 아이"로 안내하지 않는다.
  it("reports a missing child as not found instead of purged", async () => {
    const { Prisma } = await import("@prisma/client");
    updateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record to update not found.", { code: "P2025", clientVersion: "test" }),
    );
    findUniqueMock.mockResolvedValueOnce(null);

    await expect(setChildActive("child-missing", true)).resolves.toEqual({ error: "아이를 찾을 수 없습니다." });
  });

  it("updateChild distinguishes a purged child from a missing child", async () => {
    const { Prisma } = await import("@prisma/client");
    const notFound = () =>
      new Prisma.PrismaClientKnownRequestError("Record to update not found.", { code: "P2025", clientVersion: "test" });

    updateMock.mockRejectedValueOnce(notFound());
    findUniqueMock.mockResolvedValueOnce({ personalDataPurgedAt: new Date("2031-01-01T00:00:00Z") });
    const purged = await updateChild("child-1", {}, formDataWithName("아이"));
    expect(purged.formError).toBe("보관기간이 지나 개인정보를 파기한 아이는 수정할 수 없습니다.");

    updateMock.mockRejectedValueOnce(notFound());
    findUniqueMock.mockResolvedValueOnce(null);
    const missing = await updateChild("child-missing", {}, formDataWithName("아이"));
    expect(missing.formError).toBe("아이를 찾을 수 없습니다.");
  });

  it("only calls prisma.child.update with isActive, never a delete method", async () => {
    const result = await setChildActive("child-1", false);

    expect(result).toEqual({});
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "child-1", personalDataPurgedAt: null },
      data: { isActive: false },
    });
  });
});

describe("no hard delete anywhere in the codebase", () => {
  it("app/ and lib/ never call prisma.child.delete", async () => {
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
          if (/child\s*\.\s*delete\s*\(/.test(content)) {
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
