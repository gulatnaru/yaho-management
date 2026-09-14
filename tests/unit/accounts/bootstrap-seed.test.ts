import { describe, expect, it, vi } from "vitest";
import {
  ensureBootstrapAdmin,
  type BootstrapClient,
} from "@/server/accounts/bootstrap";

type StoredUser = {
  email: string;
  name: string;
  password: string;
  role: "ADMIN" | "MANAGER" | "TEACHER";
  isActive: boolean;
  teacherId: string | null;
  mustChangePassword: boolean;
  authVersion: number;
};

function createUserDelegate(initialUsers: StoredUser[] = []) {
  const users = initialUsers.map((user) => ({ ...user }));
  const calls: string[] = [];
  const transactionClient = {
    $queryRaw: vi.fn(async () => {
      calls.push("lock");
      return [{ locked: 1 }];
    }),
    user: {
      findFirst: vi.fn(async () => {
        calls.push("findFirst");
        return users[0] ? { id: users[0].email } : null;
      }),
      create: vi.fn(async ({ data }: { data: StoredUser }) => {
        calls.push("create");
        users.push({ ...data });
        return { id: data.email };
      }),
    },
  };
  const transaction = vi.fn(async <T>(callback: (tx: typeof transactionClient) => Promise<T>) => {
    calls.push("transaction");
    return callback(transactionClient);
  });

  return {
    users,
    client: { $transaction: transaction } as BootstrapClient,
    calls,
    transaction,
    transactionClient,
  };
}

describe("ensureBootstrapAdmin", () => {
  it("creates exactly one bootstrap ADMIN when the User table is empty", async () => {
    const harness = createUserDelegate();
    const hashPassword = vi.fn(async () => "bootstrap-hash");

    await expect(
      ensureBootstrapAdmin(
        harness.client,
        { email: "admin@yaho.test", password: "temporary-password" },
        hashPassword,
      ),
    ).resolves.toEqual({ created: true });

    expect(harness.users).toEqual([
      {
        email: "admin@yaho.test",
        name: "운영자",
        password: "bootstrap-hash",
        role: "ADMIN",
        isActive: true,
        teacherId: null,
        mustChangePassword: false,
        authVersion: 1,
      },
    ]);
    expect(harness.calls).toEqual(["transaction", "lock", "findFirst", "create"]);
    expect(hashPassword).toHaveBeenCalledWith("temporary-password", 12);
  });

  it.each([
    ["ADMIN with the same email", "ADMIN", "configured@yaho.test"],
    ["ADMIN with a different email", "ADMIN", "existing-admin@yaho.test"],
    ["MANAGER with a different email", "MANAGER", "existing-manager@yaho.test"],
    ["TEACHER with a different email", "TEACHER", "existing-teacher@yaho.test"],
  ] as const)("does nothing for an existing %s", async (_label, role, email) => {
    const existing: StoredUser = {
      email,
      name: "기존 운영자",
      password: "existing-hash",
      role,
      isActive: false,
      teacherId: role === "TEACHER" ? "teacher-1" : null,
      mustChangePassword: true,
      authVersion: 9,
    };
    const harness = createUserDelegate([existing]);

    await expect(
      ensureBootstrapAdmin(
        harness.client,
        { email: "configured@yaho.test", password: "different-password" },
        async () => "different-hash",
      ),
    ).resolves.toEqual({ created: false });

    expect(harness.users).toEqual([existing]);
    expect(harness.transactionClient.user.create).not.toHaveBeenCalled();
    expect(harness.calls).toEqual(["transaction", "lock", "findFirst"]);
  });
});
