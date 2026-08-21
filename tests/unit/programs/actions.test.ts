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
