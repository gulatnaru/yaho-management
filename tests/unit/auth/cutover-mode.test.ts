import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";

const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalMode = process.env[CUTOVER_ENV];

afterAll(() => {
  if (originalMode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = originalMode;
});

describe("P2-S cutover mode resolution", () => {
  it("accepts only the exact LEGACY_ADMIN and SUPER_ADMIN values", () => {
    process.env[CUTOVER_ENV] = "LEGACY_ADMIN";
    expect(resolveAccountCutoverMode()).toBe("LEGACY_ADMIN");
    process.env[CUTOVER_ENV] = "SUPER_ADMIN";
    expect(resolveAccountCutoverMode()).toBe("SUPER_ADMIN");
  });

  it("fails closed on unregistered, empty, mistyped, and case-variant values", () => {
    for (const value of ["", "legacy_admin", "super_admin", "LEGACY", "SUPER", "LEGACY_ADMIN ", " SUPER_ADMIN", "BOGUS_MODE"]) {
      process.env[CUTOVER_ENV] = value;
      expect(resolveAccountCutoverMode()).toBe("INVALID");
    }
    delete process.env[CUTOVER_ENV];
    expect(resolveAccountCutoverMode()).toBe("INVALID");
  });

  it("reads the environment on every call instead of caching a module-level value", () => {
    // 같은 모듈 인스턴스에서 환경변수만 바꿔도 판정이 따라간다 — 장수명 서버가
    // 재시작 없이(로컬) 또는 재배포 후(호스팅) 새 설정을 읽는 전제이다.
    process.env[CUTOVER_ENV] = "LEGACY_ADMIN";
    expect(resolveAccountCutoverMode()).toBe("LEGACY_ADMIN");
    process.env[CUTOVER_ENV] = "SUPER_ADMIN";
    expect(resolveAccountCutoverMode()).toBe("SUPER_ADMIN");
    delete process.env[CUTOVER_ENV];
    expect(resolveAccountCutoverMode()).toBe("INVALID");
  });
});

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

async function runGuard(mode: string | undefined, principal: typeof principalHolder.current) {
  if (mode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = mode;
  principalHolder.current = principal;
  vi.resetModules();
  const { requireAccountManagementPrincipal } = await import("@/lib/auth/authorization");
  return requireAccountManagementPrincipal();
}

describe("단순화 결정(ADR-071) — 계정 관리 가드는 역할만 본다 (모드 무관)", () => {
  it("allows ADMIN and SUPER_ADMIN in LEGACY_ADMIN mode", async () => {
    await expect(runGuard("LEGACY_ADMIN", principalFor("ADMIN"))).resolves.toMatchObject({ role: "ADMIN" });
    await expect(runGuard("LEGACY_ADMIN", principalFor("SUPER_ADMIN"))).resolves.toMatchObject({ role: "SUPER_ADMIN" });
    for (const role of ["MANAGER", "TEACHER", "STAFF"]) {
      await expect(runGuard("LEGACY_ADMIN", principalFor(role))).rejects.toThrow("NOT_FOUND");
    }
  });

  it("allows ADMIN and SUPER_ADMIN in SUPER_ADMIN mode", async () => {
    await expect(runGuard("SUPER_ADMIN", principalFor("SUPER_ADMIN"))).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
    await expect(runGuard("SUPER_ADMIN", principalFor("ADMIN"))).resolves.toMatchObject({ role: "ADMIN" });
    for (const role of ["MANAGER", "TEACHER", "STAFF"]) {
      await expect(runGuard("SUPER_ADMIN", principalFor(role))).rejects.toThrow("NOT_FOUND");
    }
  });

  it("allows ADMIN and SUPER_ADMIN even when the mode is invalid or unregistered", async () => {
    for (const mode of ["BOGUS_MODE", undefined]) {
      await expect(runGuard(mode, principalFor("SUPER_ADMIN"))).resolves.toMatchObject({ role: "SUPER_ADMIN" });
      await expect(runGuard(mode, principalFor("ADMIN"))).resolves.toMatchObject({ role: "ADMIN" });
      for (const role of ["MANAGER", "TEACHER", "STAFF"]) {
        await expect(runGuard(mode, principalFor(role))).rejects.toThrow("NOT_FOUND");
      }
    }
  });

  it("redirects a missing principal to login in every mode", async () => {
    for (const mode of ["LEGACY_ADMIN", "SUPER_ADMIN", "BOGUS_MODE"]) {
      await expect(runGuard(mode, null)).rejects.toThrow("REDIRECT:/login");
    }
  });
});
