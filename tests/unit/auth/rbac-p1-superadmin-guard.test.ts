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

async function runGuard(principal: typeof principalHolder.current) {
  principalHolder.current = principal;
  vi.resetModules();
  const { requireSuperAdminPrincipal } = await import("@/lib/auth/authorization");
  return requireSuperAdminPrincipal();
}

function principalFor(role: string) {
  return {
    userId: "user-1",
    name: "사용자",
    email: "user@yaho.test",
    role,
    teacherId: role === "TEACHER" ? "teacher-1" : null,
    authVersion: 1,
    mustChangePassword: false,
  };
}

describe("P1 super-admin guard", () => {
  it("allows SUPER_ADMIN", async () => {
    await expect(runGuard(principalFor("SUPER_ADMIN"))).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
  });

  it.each(["ADMIN", "MANAGER", "TEACHER", "STAFF"])("rejects %s with NOT_FOUND", async (role) => {
    await expect(runGuard(principalFor(role))).rejects.toThrow("NOT_FOUND");
  });

  it("redirects an inactive account to login", async () => {
    // resolveSessionPrincipal returns null for an inactive account row.
    await expect(runGuard(null)).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects an authVersion mismatch to login", async () => {
    // resolveSessionPrincipal returns null for a row with an authVersion mismatch.
    await expect(runGuard(null)).rejects.toThrow("REDIRECT:/login");
  });
});
