import { describe, expect, it, vi } from "vitest";
import { authenticateOperator, type CredentialLookupClient } from "@/lib/auth/credentials";

function credentialClient(
  user: Awaited<ReturnType<CredentialLookupClient["user"]["findUnique"]>>,
): CredentialLookupClient {
  return { user: { findUnique: vi.fn().mockResolvedValue(user) } };
}

const baseUser = {
  id: "user-1",
  name: "운영자",
  email: "operator@yaho.test",
  password: "stored-hash",
  role: "ADMIN",
  isActive: true,
  teacherId: null,
  authVersion: 2,
  teacher: null,
};

describe("authenticateOperator", () => {
  it("returns identity and authVersion without returning a role", async () => {
    const result = await authenticateOperator(
      { email: baseUser.email, password: "valid-password" },
      credentialClient(baseUser),
      vi.fn().mockResolvedValue(true),
    );

    expect(result).toEqual({
      id: "user-1",
      name: "운영자",
      email: "operator@yaho.test",
      authVersion: 2,
    });
    expect(result).not.toHaveProperty("role");
  });

  it("allows an active MANAGER without a Teacher link", async () => {
    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "valid-password" },
        credentialClient({ ...baseUser, role: "MANAGER" }),
        vi.fn().mockResolvedValue(true),
      ),
    ).resolves.toMatchObject({ id: "user-1", authVersion: 2 });
  });

  it("requires an active matching Teacher for TEACHER login", async () => {
    const comparePassword = vi.fn().mockResolvedValue(true);
    const teacherUser = {
      ...baseUser,
      role: "TEACHER",
      teacherId: "teacher-1",
      teacher: { id: "teacher-1", isActive: true },
    };

    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "valid-password" },
        credentialClient(teacherUser),
        comparePassword,
      ),
    ).resolves.toMatchObject({ id: "user-1" });
    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "valid-password" },
        credentialClient({ ...teacherUser, teacher: { id: "teacher-1", isActive: false } }),
        comparePassword,
      ),
    ).resolves.toBeNull();
  });

  it("fails closed for inactive, inconsistent, or invalid-version accounts", async () => {
    const comparePassword = vi.fn().mockResolvedValue(true);
    for (const user of [
      { ...baseUser, isActive: false },
      { ...baseUser, teacherId: "teacher-1", teacher: { id: "teacher-1", isActive: true } },
      { ...baseUser, authVersion: 0 },
    ]) {
      await expect(
        authenticateOperator(
          { email: baseUser.email, password: "valid-password" },
          credentialClient(user),
          comparePassword,
        ),
      ).resolves.toBeNull();
    }
  });
});
