import { describe, expect, it, vi } from "vitest";
import {
  isOperationalRole,
  isStaff,
  isSuperAdmin,
  isUserRole,
} from "@/lib/auth/roles";
import { resolveSessionPrincipal } from "@/lib/auth/principal";

describe("P1 role predicates", () => {
  it("recognizes all five roles and rejects unknown values", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEACHER", "STAFF"]) {
      expect(isUserRole(role)).toBe(true);
    }
    expect(isUserRole("OWNER")).toBe(false);
    expect(isSuperAdmin({ role: "SUPER_ADMIN" })).toBe(true);
    expect(isSuperAdmin({ role: "ADMIN" })).toBe(false);
    expect(isStaff({ role: "STAFF" })).toBe(true);
    expect(isStaff({ role: "MANAGER" })).toBe(false);
  });

  it("enumerates the operational guard set explicitly (STAFF denied by default)", () => {
    expect(isOperationalRole("SUPER_ADMIN")).toBe(true);
    expect(isOperationalRole("ADMIN")).toBe(true);
    expect(isOperationalRole("MANAGER")).toBe(true);
    expect(isOperationalRole("TEACHER")).toBe(false);
    expect(isOperationalRole("STAFF")).toBe(false);
  });
});

describe("P1 principal resolution", () => {
  function clientFor(row: Record<string, unknown>) {
    return { user: { findUnique: vi.fn().mockResolvedValue(row) } };
  }

  const baseRow = {
    id: "user-1",
    name: "사용자",
    email: "user@yaho.test",
    isActive: true,
    teacherId: null,
    mustChangePassword: false,
    authVersion: 1,
    teacher: null,
  };

  it("resolves SUPER_ADMIN and STAFF principals without a teacher link", async () => {
    const superAdmin = await resolveSessionPrincipal(
      { userId: "user-1", authVersion: 1 },
      clientFor({ ...baseRow, role: "SUPER_ADMIN" }) as never,
    );
    expect(superAdmin?.role).toBe("SUPER_ADMIN");
    expect(superAdmin?.teacherId).toBeNull();

    const staff = await resolveSessionPrincipal(
      { userId: "user-1", authVersion: 1 },
      clientFor({ ...baseRow, role: "STAFF" }) as never,
    );
    expect(staff?.role).toBe("STAFF");
  });

  it("fails closed when SUPER_ADMIN or STAFF rows carry a teacher link", async () => {
    const badSuperAdmin = await resolveSessionPrincipal(
      { userId: "user-1", authVersion: 1 },
      clientFor({ ...baseRow, role: "SUPER_ADMIN", teacherId: "teacher-1" }) as never,
    );
    expect(badSuperAdmin).toBeNull();

    const badStaff = await resolveSessionPrincipal(
      { userId: "user-1", authVersion: 1 },
      clientFor({ ...baseRow, role: "STAFF", teacherId: "teacher-1" }) as never,
    );
    expect(badStaff).toBeNull();
  });
});
