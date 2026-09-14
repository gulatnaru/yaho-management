import { describe, expect, it, vi } from "vitest";
import {
  resolveSessionPrincipal,
  type PrincipalLookupClient,
} from "@/lib/auth/principal";

type PrincipalRow = Awaited<ReturnType<PrincipalLookupClient["user"]["findUnique"]>>;

function clientWith(row: PrincipalRow): PrincipalLookupClient {
  return { user: { findUnique: vi.fn().mockResolvedValue(row) } };
}

const adminRow = {
  id: "admin-1",
  name: "관리자",
  email: "admin@yaho.test",
  role: "ADMIN",
  isActive: true,
  teacherId: null,
  mustChangePassword: false,
  authVersion: 3,
  teacher: null,
};

describe("resolveSessionPrincipal", () => {
  it("rehydrates the current ADMIN or MANAGER role from the database", async () => {
    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 3 },
        clientWith(adminRow),
      ),
    ).resolves.toMatchObject({ role: "ADMIN", teacherId: null });

    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 3 },
        clientWith({ ...adminRow, role: "MANAGER" }),
      ),
    ).resolves.toMatchObject({ role: "MANAGER", teacherId: null });
  });

  it("applies a DB role change without consulting a JWT role", async () => {
    const principal = await resolveSessionPrincipal(
      { userId: "admin-1", authVersion: 3 },
      clientWith({ ...adminRow, role: "MANAGER" }),
    );

    expect(principal?.role).toBe("MANAGER");
  });

  it("rejects inactive users and stale authVersion sessions", async () => {
    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 3 },
        clientWith({ ...adminRow, isActive: false }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 2 },
        clientWith(adminRow),
      ),
    ).resolves.toBeNull();
  });

  it("requires a matching active Teacher for a TEACHER principal", async () => {
    const teacherRow = {
      ...adminRow,
      id: "user-teacher-1",
      role: "TEACHER",
      teacherId: "teacher-1",
      teacher: { id: "teacher-1", isActive: true },
    };

    await expect(
      resolveSessionPrincipal(
        { userId: teacherRow.id, authVersion: 3 },
        clientWith(teacherRow),
      ),
    ).resolves.toMatchObject({ role: "TEACHER", teacherId: "teacher-1" });

    await expect(
      resolveSessionPrincipal(
        { userId: teacherRow.id, authVersion: 3 },
        clientWith({ ...teacherRow, teacher: { id: "teacher-1", isActive: false } }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSessionPrincipal(
        { userId: teacherRow.id, authVersion: 3 },
        clientWith({ ...teacherRow, teacher: null }),
      ),
    ).resolves.toBeNull();
  });

  it("fails closed for malformed session identities or role/link inconsistencies", async () => {
    const lookup = clientWith(adminRow);
    await expect(resolveSessionPrincipal({ userId: undefined, authVersion: 3 }, lookup)).resolves.toBeNull();
    await expect(resolveSessionPrincipal({ userId: "admin-1", authVersion: 0 }, lookup)).resolves.toBeNull();
    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 3 },
        clientWith({
          ...adminRow,
          teacherId: "teacher-1",
          teacher: { id: "teacher-1", isActive: true },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("preserves the forced-password flag for the route gate", async () => {
    await expect(
      resolveSessionPrincipal(
        { userId: "admin-1", authVersion: 3 },
        clientWith({ ...adminRow, mustChangePassword: true }),
      ),
    ).resolves.toMatchObject({ mustChangePassword: true });
  });
});
