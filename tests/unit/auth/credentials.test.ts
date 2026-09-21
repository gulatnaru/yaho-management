import { describe, expect, it, vi } from "vitest";
import {
  authenticateOperator,
  INVALID_CREDENTIAL_PASSWORD_HASH,
  type CredentialLookupClient,
} from "@/lib/auth/credentials";

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
  it("uses a precomputed bcrypt cost-12 dummy hash", () => {
    expect(INVALID_CREDENTIAL_PASSWORD_HASH).toMatch(/^\$2[aby]\$12\$/);
  });

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
    expect(comparePassword).toHaveBeenCalledTimes(2);
  });

  it("fails closed for inactive, inconsistent, or invalid-version accounts", async () => {
    const comparePassword = vi.fn().mockResolvedValue(true);
    for (const user of [
      { ...baseUser, isActive: false },
      { ...baseUser, teacherId: "teacher-1", teacher: { id: "teacher-1", isActive: true } },
      { ...baseUser, authVersion: 0 },
      { ...baseUser, role: "UNKNOWN" },
    ]) {
      await expect(
        authenticateOperator(
          { email: baseUser.email, password: "valid-password" },
          credentialClient(user),
          comparePassword,
        ),
      ).resolves.toBeNull();
    }
    expect(comparePassword).toHaveBeenCalledTimes(4);
    for (const call of comparePassword.mock.calls) {
      expect(call).toEqual(["valid-password", "stored-hash"]);
    }
  });

  it("performs one dummy password comparison for a missing User", async () => {
    const comparePassword = vi.fn().mockResolvedValue(true);

    await expect(
      authenticateOperator(
        { email: "missing@yaho.test", password: "valid-password" },
        credentialClient(null),
        comparePassword,
      ),
    ).resolves.toBeNull();

    expect(comparePassword).toHaveBeenCalledTimes(1);
    expect(comparePassword).toHaveBeenCalledWith("valid-password", INVALID_CREDENTIAL_PASSWORD_HASH);
  });

  it("performs one dummy password comparison when the stored password is null", async () => {
    const comparePassword = vi.fn().mockResolvedValue(true);

    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "valid-password" },
        credentialClient({ ...baseUser, password: null }),
        comparePassword,
      ),
    ).resolves.toBeNull();

    expect(comparePassword).toHaveBeenCalledTimes(1);
    expect(comparePassword).toHaveBeenCalledWith("valid-password", INVALID_CREDENTIAL_PASSWORD_HASH);
  });

  it("compares the real hash exactly once for valid wrong and correct passwords", async () => {
    const wrongCompare = vi.fn().mockResolvedValue(false);
    const correctCompare = vi.fn().mockResolvedValue(true);

    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "wrong-password" },
        credentialClient(baseUser),
        wrongCompare,
      ),
    ).resolves.toBeNull();
    await expect(
      authenticateOperator(
        { email: baseUser.email, password: "valid-password" },
        credentialClient(baseUser),
        correctCompare,
      ),
    ).resolves.toMatchObject({ id: baseUser.id });

    expect(wrongCompare).toHaveBeenCalledOnce();
    expect(wrongCompare).toHaveBeenCalledWith("wrong-password", "stored-hash");
    expect(correctCompare).toHaveBeenCalledOnce();
    expect(correctCompare).toHaveBeenCalledWith("valid-password", "stored-hash");
  });
});
