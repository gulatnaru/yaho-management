import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_MUTATION_ADVISORY_LOCK_KEY,
  createAccountCore,
  resetAccountPasswordCore,
  updateAccountCore,
} from "@/server/accounts/mutations";

type Role = "ADMIN" | "MANAGER" | "TEACHER";
type StoredUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  teacherId: string | null;
  mustChangePassword: boolean;
  authVersion: number;
};

const principal = (userId = "admin-1") => ({ userId, role: "ADMIN", teacherId: null }) as never;

function target(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: "target-1",
    name: "대상",
    email: "target@example.test",
    role: "MANAGER",
    isActive: true,
    teacherId: null,
    mustChangePassword: false,
    authVersion: 1,
    ...overrides,
  };
}

function harness(options: {
  target?: StoredUser;
  actor?: Partial<StoredUser> | null;
  activeAdminCount?: number;
  teacher?: { id: string; isActive: boolean } | null;
  linkedUser?: { id: string } | null;
  historyError?: Error;
} = {}) {
  const calls: string[] = [];
  let rawCall = 0;
  const currentTarget = options.target ?? target();
  const actor = options.actor === null ? null : target({
    id: "admin-1",
    email: "admin@example.test",
    role: "ADMIN",
    ...options.actor,
  });

  const queryRaw = vi.fn(async (...args: unknown[]) => {
    void args;
    rawCall += 1;
    if (rawCall === 1) {
      calls.push("advisory-lock");
      return [];
    }
    calls.push("target-lock");
    return currentTarget ? [currentTarget] : [];
  });
  const actorFind = vi.fn(async () => {
    calls.push("actor-check");
    return actor;
  });
  const linkedFind = vi.fn(async () => {
    calls.push("teacher-link-check");
    return options.linkedUser ?? null;
  });
  const teacherFind = vi.fn(async () => {
    calls.push("teacher-active-check");
    return options.teacher === undefined ? { id: "teacher-1", isActive: true } : options.teacher;
  });
  const userCreate = vi.fn(async () => {
    calls.push("user-create");
    return { id: "created-1" };
  });
  const userUpdate = vi.fn(async () => {
    calls.push("user-update");
    return {};
  });
  const adminCount = vi.fn(async () => {
    calls.push("admin-count");
    return options.activeAdminCount ?? 2;
  });
  const historyCreate = vi.fn(async (...args: unknown[]) => {
    void args;
    calls.push("history-create");
    if (options.historyError) throw options.historyError;
    return {};
  });
  const historyCreateMany = vi.fn(async (...args: unknown[]) => {
    void args;
    calls.push("history-create-many");
    if (options.historyError) throw options.historyError;
    return { count: 1 };
  });

  const tx = {
    $queryRaw: queryRaw,
    user: {
      findUnique: actorFind,
      findFirst: linkedFind,
      create: userCreate,
      update: userUpdate,
      count: adminCount,
    },
    teacher: { findUnique: teacherFind },
    userAccountChange: { create: historyCreate, createMany: historyCreateMany },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));

  return {
    client: { $transaction: transaction } as never,
    transaction,
    calls,
    queryRaw,
    userCreate,
    userUpdate,
    adminCount,
    historyCreate,
    historyCreateMany,
    teacherFind,
    linkedFind,
  };
}

describe("account mutation core", () => {
  it("creates a forced-change account and append-only CREATED history after the fixed advisory lock", async () => {
    const test = harness();
    const result = await createAccountCore(principal(), {
      name: "준관리자",
      email: "manager@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
      passwordHash: "hash-only",
    }, test.client);

    expect(result).toEqual({ id: "created-1" });
    expect(test.calls).toEqual(["advisory-lock", "actor-check", "user-create", "history-create"]);
    expect(test.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mustChangePassword: true, authVersion: 1, password: "hash-only" }),
    }));
    expect(test.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetUserId: "created-1",
        actorAdminId: "admin-1",
        type: "CREATED",
      }),
    });
    const historyPayload = JSON.stringify(test.historyCreate.mock.calls[0]?.[0]);
    expect(historyPayload).not.toContain("hash-only");
    expect(historyPayload).not.toContain("password");
  });

  it("validates an active, unlinked Teacher before creating a TEACHER account", async () => {
    const test = harness();
    await createAccountCore(principal(), {
      name: "선생님",
      email: "teacher@example.test",
      role: "TEACHER",
      teacherId: "teacher-1",
      isActive: true,
      passwordHash: "hash-only",
    }, test.client);

    expect(test.teacherFind).toHaveBeenCalledWith({ where: { id: "teacher-1" }, select: { id: true, isActive: true } });
    expect(test.linkedFind).toHaveBeenCalled();
    expect(test.calls.indexOf("teacher-active-check")).toBeLessThan(test.calls.indexOf("user-create"));
  });

  it("rejects an inactive or already-linked Teacher before every write", async () => {
    const inactive = harness({ teacher: { id: "teacher-1", isActive: false } });
    await expect(createAccountCore(principal(), {
      name: "선생님",
      email: "teacher@example.test",
      role: "TEACHER",
      teacherId: "teacher-1",
      isActive: true,
      passwordHash: "hash-only",
    }, inactive.client)).rejects.toMatchObject({ code: "TEACHER_NOT_AVAILABLE" });
    expect(inactive.userCreate).not.toHaveBeenCalled();

    const linked = harness({ linkedUser: { id: "someone-else" } });
    await expect(createAccountCore(principal(), {
      name: "선생님",
      email: "teacher@example.test",
      role: "TEACHER",
      teacherId: "teacher-1",
      isActive: true,
      passwordHash: "hash-only",
    }, linked.client)).rejects.toMatchObject({ code: "TEACHER_NOT_AVAILABLE" });
    expect(linked.userCreate).not.toHaveBeenCalled();
  });

  it("locks the target and records email, role, and active changes as separate rows", async () => {
    const test = harness({ target: target({ role: "ADMIN" }), activeAdminCount: 2 });
    await updateAccountCore(principal(), "target-1", {
      name: "변경 이름",
      email: "next@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: false,
    }, test.client);

    expect(test.calls.slice(0, 4)).toEqual(["advisory-lock", "actor-check", "target-lock", "admin-count"]);
    expect(test.historyCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ type: "EMAIL_CHANGED", previousEmail: "target@example.test", nextEmail: "next@example.test" }),
      expect.objectContaining({ type: "ROLE_CHANGED", previousRole: "ADMIN", nextRole: "MANAGER" }),
      expect.objectContaining({ type: "ACTIVE_CHANGED", previousIsActive: true, nextIsActive: false }),
    ] });
  });

  it("blocks self-deactivation, self-demotion, and removal of the last active ADMIN", async () => {
    const self = harness({ target: target({ id: "admin-1", role: "ADMIN" }) });
    await expect(updateAccountCore(principal(), "admin-1", {
      name: "관리자",
      email: "admin@example.test",
      role: "ADMIN",
      teacherId: null,
      isActive: false,
    }, self.client)).rejects.toMatchObject({ code: "SELF_DEACTIVATION" });
    expect(self.userUpdate).not.toHaveBeenCalled();

    const demotion = harness({ target: target({ id: "admin-1", role: "ADMIN" }) });
    await expect(updateAccountCore(principal(), "admin-1", {
      name: "관리자",
      email: "admin@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, demotion.client)).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE" });

    const last = harness({ target: target({ role: "ADMIN" }), activeAdminCount: 1 });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "마지막 관리자",
      email: "target@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, last.client)).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    expect(last.userUpdate).not.toHaveBeenCalled();
  });

  it("resets the hash, forces password change, increments authVersion, and records no credential value", async () => {
    const test = harness();
    await resetAccountPasswordCore(principal(), "target-1", "new-hash", test.client);

    expect(test.userUpdate).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { password: "new-hash", mustChangePassword: true, authVersion: { increment: 1 } },
    });
    expect(test.historyCreate).toHaveBeenCalledWith({
      data: { targetUserId: "target-1", actorAdminId: "admin-1", type: "PASSWORD_RESET" },
    });
    expect(JSON.stringify(test.historyCreate.mock.calls[0]?.[0])).not.toContain("new-hash");
  });

  it("propagates history failure so Prisma rolls back the preceding User mutation", async () => {
    const test = harness({ historyError: new Error("HISTORY_WRITE_FAILED") });
    await expect(resetAccountPasswordCore(principal(), "target-1", "new-hash", test.client)).rejects.toThrow("HISTORY_WRITE_FAILED");
    expect(test.userUpdate).toHaveBeenCalledTimes(1);
    expect(test.historyCreate).toHaveBeenCalledTimes(1);
    expect(test.transaction).toHaveBeenCalledTimes(1);
  });

  it("uses parameterized raw SQL for the shared fixed advisory lock and target row lock", async () => {
    const test = harness();
    await resetAccountPasswordCore(principal(), "target-1", "new-hash", test.client);

    expect(ACCOUNT_MUTATION_ADVISORY_LOCK_KEY).toBe(16_001_001);
    expect(test.queryRaw).toHaveBeenCalledTimes(2);
    expect(typeof test.queryRaw.mock.calls[0]?.[0]).not.toBe("string");
    expect(typeof test.queryRaw.mock.calls[1]?.[0]).not.toBe("string");
  });
});

describe("last ADMIN concurrency model", () => {
  it("serializes competing ADMIN demotions so exactly one succeeds and one active ADMIN remains", async () => {
    const users = new Map<string, StoredUser>([
      ["admin-a", target({ id: "admin-a", email: "a@example.test", role: "ADMIN" })],
      ["admin-b", target({ id: "admin-b", email: "b@example.test", role: "ADMIN" })],
    ]);
    let queue = Promise.resolve();

    const client = {
      $transaction: <T>(callback: (tx: unknown) => Promise<T>) => {
        const run = queue.then(async () => {
          let rawCalls = 0;
          const tx = {
            $queryRaw: vi.fn(async () => {
              rawCalls += 1;
              if (rawCalls === 1) return [];
              const targetId = rawCalls === 2 ? "admin-b" : "admin-a";
              return [users.get(targetId)];
            }),
            user: {
              findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id)),
              findFirst: vi.fn(async () => null),
              count: vi.fn(async () => [...users.values()].filter((user) => user.role === "ADMIN" && user.isActive).length),
              update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredUser> }) => {
                users.set(where.id, { ...users.get(where.id)!, ...data });
              }),
            },
            teacher: { findUnique: vi.fn(async () => null) },
            userAccountChange: { createMany: vi.fn(async () => ({ count: 1 })) },
          };
          return callback(tx);
        });
        queue = run.then(() => undefined, () => undefined);
        return run;
      },
    } as never;

    const demoteB = updateAccountCore(principal("admin-a"), "admin-b", {
      name: "B",
      email: "b@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, client);
    const demoteA = updateAccountCore(principal("admin-b"), "admin-a", {
      name: "A",
      email: "a@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, client);

    const results = await Promise.allSettled([demoteB, demoteA]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect([...users.values()].filter((user) => user.role === "ADMIN" && user.isActive)).toHaveLength(1);
  });
});
