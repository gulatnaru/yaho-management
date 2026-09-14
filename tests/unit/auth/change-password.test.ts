import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_MUTATION_ADVISORY_LOCK_KEY } from "@/lib/auth/account-lock";
import type { CurrentPrincipal } from "@/lib/auth/principal";
import {
  changeOwnPasswordCore,
  CurrentPasswordInvalidError,
  PasswordChangeSessionInvalidError,
  type PasswordChangeClient,
} from "@/server/auth/change-password";

const principal: CurrentPrincipal = {
  userId: "admin-1",
  name: "관리자",
  email: "admin@yaho.test",
  role: "ADMIN",
  teacherId: null,
  authVersion: 4,
  mustChangePassword: true,
};

const input = {
  currentPassword: "old-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
};

function harness(
  row: Record<string, unknown> | null = {
    id: "admin-1",
    password: "old-hash",
    role: "ADMIN",
    isActive: true,
    teacherId: null,
    authVersion: 4,
    teacherIsActive: null,
  },
) {
  const calls: string[] = [];
  const queryRaw = vi.fn(async (...args: unknown[]) => {
    void args;
    if (queryRaw.mock.calls.length === 1) {
      calls.push("account-lock");
      return [];
    }
    calls.push("user-lock");
    return row ? [row] : [];
  });
  const update = vi.fn(async () => {
    calls.push("password-update");
    return { authVersion: 5 };
  });
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ $queryRaw: queryRaw, user: { update } }),
  );
  const comparePassword = vi.fn(async () => {
    calls.push("password-compare");
    return true;
  });
  const hashPassword = vi.fn(async () => "new-hash");

  return {
    client: { $transaction: transaction } as PasswordChangeClient,
    calls,
    queryRaw,
    update,
    comparePassword,
    hashPassword,
  };
}

describe("changeOwnPasswordCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes with account reset, locks the User, and increments authVersion", async () => {
    const test = harness();

    await expect(
      changeOwnPasswordCore(principal, input, test.client, {
        comparePassword: test.comparePassword,
        hashPassword: test.hashPassword,
      }),
    ).resolves.toEqual({ authVersion: 5 });

    expect(test.calls).toEqual([
      "account-lock",
      "user-lock",
      "password-compare",
      "password-update",
    ]);
    expect(test.queryRaw.mock.calls[0]?.[0]).not.toEqual(expect.any(String));
    expect(test.queryRaw.mock.calls[0]?.slice(1)).toContain(ACCOUNT_MUTATION_ADVISORY_LOCK_KEY);
    expect(test.queryRaw.mock.calls[1]?.[0]).not.toEqual(expect.any(String));
    expect(test.queryRaw.mock.calls[1]?.slice(1)).toContain("admin-1");
    expect(test.hashPassword).toHaveBeenCalledWith("new-password", 12);
    expect(test.comparePassword).toHaveBeenCalledWith("old-password", "old-hash");
    expect(test.update).toHaveBeenCalledWith({
      where: { id: "admin-1" },
      data: {
        password: "new-hash",
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
      select: { authVersion: true },
    });
  });

  it("rejects a wrong current password without writing", async () => {
    const test = harness();
    test.comparePassword.mockResolvedValue(false);

    await expect(
      changeOwnPasswordCore(principal, input, test.client, {
        comparePassword: test.comparePassword,
        hashPassword: test.hashPassword,
      }),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(test.update).not.toHaveBeenCalled();
  });

  it("cannot overwrite an ADMIN reset that won the authVersion race", async () => {
    const test = harness({
      id: "admin-1",
      password: "reset-hash",
      role: "ADMIN",
      isActive: true,
      teacherId: null,
      authVersion: 5,
      teacherIsActive: null,
    });

    await expect(
      changeOwnPasswordCore(principal, input, test.client, {
        comparePassword: test.comparePassword,
        hashPassword: test.hashPassword,
      }),
    ).rejects.toBeInstanceOf(PasswordChangeSessionInvalidError);
    expect(test.comparePassword).not.toHaveBeenCalled();
    expect(test.update).not.toHaveBeenCalled();
  });

  it("rechecks active role/link state inside the transaction", async () => {
    for (const row of [
      {
        id: "admin-1",
        password: "old-hash",
        role: "ADMIN",
        isActive: false,
        teacherId: null,
        authVersion: 4,
        teacherIsActive: null,
      },
      {
        id: "teacher-user-1",
        password: "old-hash",
        role: "TEACHER",
        isActive: true,
        teacherId: "teacher-1",
        authVersion: 4,
        teacherIsActive: false,
      },
    ]) {
      const selectedPrincipal =
        row.role === "TEACHER"
          ? ({
              ...principal,
              userId: "teacher-user-1",
              role: "TEACHER",
              teacherId: "teacher-1",
            } as const)
          : principal;
      const test = harness(row);

      await expect(
        changeOwnPasswordCore(selectedPrincipal, input, test.client, {
          comparePassword: test.comparePassword,
          hashPassword: test.hashPassword,
        }),
      ).rejects.toBeInstanceOf(PasswordChangeSessionInvalidError);
      expect(test.update).not.toHaveBeenCalled();
    }
  });

  it("propagates transaction failure without reporting a successful change", async () => {
    const transaction = vi.fn().mockRejectedValue(new Error("DB_FAILED"));
    const client = { $transaction: transaction } as PasswordChangeClient;

    await expect(
      changeOwnPasswordCore(principal, input, client, {
        comparePassword: vi.fn(),
        hashPassword: vi.fn().mockResolvedValue("new-hash"),
      }),
    ).rejects.toThrow("DB_FAILED");
  });
});
