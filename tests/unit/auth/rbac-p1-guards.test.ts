import { describe, expect, it, vi } from "vitest";

const principalHolder = vi.hoisted(() => ({
  current: null as {
    userId: string;
    name: string;
    email: string;
    role: string;
    teacherId: string | null;
    authVersion: number;
    mustChangePassword: boolean;
  } | null,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(() => ({ user: { id: "user-1", authVersion: 1 } })),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth/principal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/principal")>();
  return {
    ...original,
    resolveSessionPrincipal: vi.fn(() => principalHolder.current),
  };
});

type GuardName =
  | "requireOperationalPrincipal"
  | "requireAdminPrincipal"
  | "requireAdminOrSuperAdminPrincipal";

async function runGuard(
  guardName: GuardName,
  principal: {
    userId: string;
    name: string;
    email: string;
    role: string;
    teacherId: string | null;
    authVersion: number;
    mustChangePassword: boolean;
  },
): Promise<unknown> {
  principalHolder.current = principal;
  vi.resetModules();
  const mod = await import("@/lib/auth/authorization");
  return (mod as unknown as Record<string, () => Promise<unknown>>)[guardName]();
}

function principalFor(role: string, teacherId: string | null = null) {
  return {
    userId: "user-1",
    name: "사용자",
    email: "user@yaho.test",
    role,
    teacherId,
    authVersion: 1,
    mustChangePassword: false,
  };
}

describe("P1 guard matrix", () => {
  it.each([
    ["SUPER_ADMIN", true],
    ["ADMIN", true],
    ["MANAGER", true],
    ["TEACHER", false],
    ["STAFF", false],
  ] as const)("operational guard: %s -> allowed=%s", async (role, allowed) => {
    const run = runGuard("requireOperationalPrincipal", principalFor(role));
    if (allowed) {
      await expect(run).resolves.toMatchObject({ role });
    } else {
      await expect(run).rejects.toThrow("NOT_FOUND");
    }
  });

  it.each([
    ["SUPER_ADMIN", true],
    ["ADMIN", true],
    ["MANAGER", false],
    ["TEACHER", false],
    ["STAFF", false],
  ] as const)("admin-or-super-admin guard: %s -> allowed=%s", async (role, allowed) => {
    const run = runGuard("requireAdminOrSuperAdminPrincipal", principalFor(role));
    if (allowed) {
      await expect(run).resolves.toMatchObject({ role });
    } else {
      await expect(run).rejects.toThrow("NOT_FOUND");
    }
  });

  it("account guard stays ADMIN-only in P1 (SUPER_ADMIN denied until P2 transition)", async () => {
    await expect(
      runGuard("requireAdminPrincipal", principalFor("SUPER_ADMIN")),
    ).rejects.toThrow("NOT_FOUND");
    await expect(runGuard("requireAdminPrincipal", principalFor("ADMIN"))).resolves.toMatchObject({
      role: "ADMIN",
    });
  });
});
