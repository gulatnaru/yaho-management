import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_MUTATION_ADVISORY_LOCK_KEY,
  createAccountCore,
  resetAccountPasswordCore,
  updateAccountCore,
} from "@/server/accounts/mutations";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "TEACHER" | "STAFF";
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

// P2: 코어 행위자는 SUPER_ADMIN 전용이다.
const principal = (userId = "super-1") => ({ userId, role: "SUPER_ADMIN", teacherId: null }) as never;

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
  activeSuperAdminCount?: number;
  teacher?: { id: string; isActive: boolean } | null;
  linkedUser?: { id: string } | null;
  historyError?: Error;
} = {}) {
  const calls: string[] = [];
  let rawCall = 0;
  const currentTarget = options.target ?? target();
  const actor = options.actor === null ? null : target({
    id: "super-1",
    email: "super@example.test",
    role: "SUPER_ADMIN",
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
  // P2: 코어의 count 호출은 역할별로 나뉜다. 목은 where.role을 보고 해당 카운트를 반환한다.
  const adminCount = vi.fn(async (args?: { where?: { role?: string } }) => {
    if (args?.where?.role === "SUPER_ADMIN") {
      calls.push("super-count");
      return options.activeSuperAdminCount ?? 2;
    }
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
        actorAdminId: "super-1",
        type: "CREATED",
      }),
    });
    const historyPayload = JSON.stringify(test.historyCreate.mock.calls[0]?.[0]);
    expect(historyPayload).not.toContain("hash-only");
    expect(historyPayload).not.toContain("password");
  });

  it("creates a passwordless inactive account pending invitation (P2, OQ-8)", async () => {
    const test = harness();
    const result = await createAccountCore(principal(), {
      name: "신규 직원",
      email: "staff@example.test",
      role: "STAFF",
      teacherId: null,
      isActive: true,
      passwordHash: null,
    }, test.client);

    expect(result).toEqual({ id: "created-1" });
    // 호출자가 isActive=true를 넘겨도 비밀번호 없는 생성은 강제 비활성이다.
    expect(test.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        password: null,
        isActive: false,
        mustChangePassword: false,
        authVersion: 1,
      }),
    }));
    expect(test.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetUserId: "created-1",
        actorAdminId: "super-1",
        type: "CREATED",
        nextIsActive: false,
      }),
    });
  });

  it("rejects a non-SUPER_ADMIN actor at the core before any write", async () => {
    const test = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    await expect(createAccountCore(
      { userId: "admin-1", role: "ADMIN", teacherId: null } as never,
      {
        name: "신규",
        email: "new@example.test",
        role: "STAFF",
        teacherId: null,
        isActive: true,
        passwordHash: null,
      },
      test.client,
    )).rejects.toMatchObject({ code: "ACTOR_NOT_SUPER_ADMIN" });
    expect(test.userCreate).not.toHaveBeenCalled();
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
    // P2: 본인 보호는 SUPER_ADMIN 본인에게도 적용된다 (P1 ADMIN 전용에서 일반화).
    const self = harness({ target: target({ id: "super-1", role: "SUPER_ADMIN" }) });
    await expect(updateAccountCore(principal(), "super-1", {
      name: "최고관리자",
      email: "super@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: false,
    }, self.client)).rejects.toMatchObject({ code: "SELF_DEACTIVATION" });
    expect(self.userUpdate).not.toHaveBeenCalled();

    const demotion = harness({ target: target({ id: "super-1", role: "SUPER_ADMIN" }) });
    await expect(updateAccountCore(principal(), "super-1", {
      name: "최고관리자",
      email: "super@example.test",
      role: "ADMIN",
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

  it("blocks any general-path edit of a SUPER_ADMIN target, including name-only changes", async () => {
    const test = harness({ target: target({ role: "SUPER_ADMIN" }), activeSuperAdminCount: 2 });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "이름만 변경",
      email: "target@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
    }, test.client)).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(test.userUpdate).not.toHaveBeenCalled();
  });

  it("checks LAST_ACTIVE_SUPER_ADMIN before the general-path blanket (defense-in-depth)", async () => {
    // 실제 운영에서는 본인 제거가 본인 보호에, 타인 제거가 blanket에 먼저 걸리므로 이 검사는
    // 일반 경로에서 도달하지 않는다. 목 카운트로 판정 순서·코드만 검증한다.
    const test = harness({
      target: target({ id: "super-2", role: "SUPER_ADMIN" }),
      activeSuperAdminCount: 1,
    });
    await expect(updateAccountCore(principal(), "super-2", {
      name: "최고관리자2",
      email: "super2@example.test",
      role: "ADMIN",
      teacherId: null,
      isActive: true,
    }, test.client)).rejects.toMatchObject({ code: "LAST_ACTIVE_SUPER_ADMIN" });
    expect(test.calls).toEqual(["advisory-lock", "actor-check", "target-lock", "super-count"]);
    expect(test.userUpdate).not.toHaveBeenCalled();
  });

  it("resets the hash, forces password change, increments authVersion, and records no credential value", async () => {
    const test = harness();
    await resetAccountPasswordCore(principal(), "target-1", "new-hash", test.client);

    expect(test.userUpdate).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { password: "new-hash", mustChangePassword: true, authVersion: { increment: 1 } },
    });
    expect(test.historyCreate).toHaveBeenCalledWith({
      data: { targetUserId: "target-1", actorAdminId: "super-1", type: "PASSWORD_RESET" },
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
    // P2: 강등 행위자는 SUPER_ADMIN이다. P1의 ADMIN 상호 강등(행위자 무효화로 1건만 성공)과
    // 달리, P2에서는 두 번째 강등이 LAST_ACTIVE_ADMIN으로 거부된다.
    const users = new Map<string, StoredUser>([
      ["super-1", target({ id: "super-1", email: "super@example.test", role: "SUPER_ADMIN" })],
      ["admin-a", target({ id: "admin-a", email: "a@example.test", role: "ADMIN" })],
      ["admin-b", target({ id: "admin-b", email: "b@example.test", role: "ADMIN" })],
    ]);
    let queue = Promise.resolve();

    const client = {
      $transaction: <T>(callback: (tx: unknown) => Promise<T>) => {
        const run = queue.then(async () => {
          let rawCalls = 0;
          const tx = {
            $queryRaw: vi.fn(async (...args: unknown[]) => {
              rawCalls += 1;
              if (rawCalls === 1) return [];
              // 대상 행 잠금은 파라미터화된 대상 id로 조회한다 (요청 대상과 무관하게
              // 고정 id를 반환하던 P1 목의 결함을 P2에서 수정).
              const values = (args[0] as { values?: unknown[] } | undefined)?.values ?? [];
              const row = users.get(values[0] as string);
              return row ? [row] : [];
            }),
            user: {
              findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id)),
              findFirst: vi.fn(async () => null),
              count: vi.fn(async ({ where }: { where: { role?: string; isActive?: boolean } }) =>
                [...users.values()].filter((user) => user.role === where.role && user.isActive === where.isActive).length),
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

    const demoteB = updateAccountCore(principal("super-1"), "admin-b", {
      name: "B",
      email: "b@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, client);
    const demoteA = updateAccountCore(principal("super-1"), "admin-a", {
      name: "A",
      email: "a@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, client);

    const results = await Promise.allSettled([demoteB, demoteA]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    expect([...users.values()].filter((user) => user.role === "ADMIN" && user.isActive)).toHaveLength(1);
  });
});
