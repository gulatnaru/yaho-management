import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// 단순화 결정(ADR-071): 코어 행위자는 역할만 본다 (ADMIN 또는 SUPER_ADMIN).
// 전환 모드는 판정하지 않으므로, 이 파일은 모드와 무관하게 동작한다.
// 아래 beforeAll/afterEach는 환경변수가 남아 있는 경우를 정리할 뿐 모드를 고정하지 않는다.
const CUTOVER_ENV = "YAHO_ADMIN_CUTOVER_MODE";
const originalCutoverMode = process.env[CUTOVER_ENV];
beforeAll(() => {
  delete process.env[CUTOVER_ENV];
});
afterEach(() => {
  delete process.env[CUTOVER_ENV];
});
afterAll(() => {
  if (originalCutoverMode === undefined) delete process.env[CUTOVER_ENV];
  else process.env[CUTOVER_ENV] = originalCutoverMode;
});

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
  // 단순화 결정(ADR-071): 코어는 활성 ADMIN + 활성 SUPER_ADMIN 합산 카운트
  // (role: { in: ["ADMIN", "SUPER_ADMIN"] })를 한 번만 조회한다. 목은 in 배열에
  // 들어간 역할별 카운트의 합을 반환한다.
  const managerCount = vi.fn(async (args?: { where?: { role?: string | { in?: string[] } } }) => {
    const role = args?.where?.role;
    if (typeof role === "object" && role !== null && Array.isArray(role.in)) {
      calls.push("manager-count");
      return role.in.reduce(
        (total, item) => total + (item === "SUPER_ADMIN" ? (options.activeSuperAdminCount ?? 2) : (options.activeAdminCount ?? 2)),
        0,
      );
    }
    if (role === "SUPER_ADMIN") {
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
      count: managerCount,
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
    managerCount,
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

  it("allows an ADMIN actor at the core (mode-independent)", async () => {
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
    )).resolves.toEqual({ id: "created-1" });
    expect(test.userCreate).toHaveBeenCalled();
  });

  it("rejects a non-manager actor at the core before any write", async () => {
    const test = harness({
      actor: { id: "manager-1", email: "manager@example.test", role: "MANAGER" },
    });
    await expect(createAccountCore(
      { userId: "manager-1", role: "MANAGER", teacherId: null } as never,
      {
        name: "신규",
        email: "new@example.test",
        role: "STAFF",
        teacherId: null,
        isActive: true,
        passwordHash: null,
      },
      test.client,
    )).rejects.toMatchObject({ code: "ACTOR_NOT_ACCOUNT_MANAGER" });
    expect(test.userCreate).not.toHaveBeenCalled();
  });

  it("allows ADMIN and SUPER_ADMIN actors in every cutover mode, including invalid or unset", async () => {
    for (const mode of ["LEGACY_ADMIN", "SUPER_ADMIN", "BOGUS_MODE", undefined]) {
      if (mode === undefined) delete process.env[CUTOVER_ENV];
      else process.env[CUTOVER_ENV] = mode;

      const adminCase = harness({
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
        adminCase.client,
      )).resolves.toEqual({ id: "created-1" });
      expect(adminCase.userCreate).toHaveBeenCalled();

      const superCase = harness();
      await expect(createAccountCore(
        principal(),
        {
          name: "신규",
          email: "new@example.test",
          role: "STAFF",
          teacherId: null,
          isActive: true,
          passwordHash: null,
        },
        superCase.client,
      )).resolves.toEqual({ id: "created-1" });
      expect(superCase.userCreate).toHaveBeenCalled();
    }
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

    expect(test.calls.slice(0, 4)).toEqual(["advisory-lock", "actor-check", "target-lock", "manager-count"]);
    expect(test.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authVersion: { increment: 1 } }),
    }));
    expect(test.historyCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ type: "EMAIL_CHANGED", previousEmail: "target@example.test", nextEmail: "next@example.test" }),
      expect.objectContaining({ type: "ROLE_CHANGED", previousRole: "ADMIN", nextRole: "MANAGER" }),
      expect.objectContaining({ type: "ACTIVE_CHANGED", previousIsActive: true, nextIsActive: false }),
    ] });
  });

  it.each([
    { label: "role", before: target(), role: "STAFF" as const, isActive: true },
    { label: "deactivation", before: target(), role: "MANAGER" as const, isActive: false },
    { label: "reactivation", before: target({ isActive: false }), role: "MANAGER" as const, isActive: true },
    { label: "role and active state", before: target(), role: "STAFF" as const, isActive: false },
  ])("increments authVersion once for $label", async ({ before, role, isActive }) => {
    const test = harness({ target: before });
    await updateAccountCore(principal(), before.id, {
      name: before.name, email: before.email, role, teacherId: null, isActive,
    }, test.client);
    expect(test.userUpdate).toHaveBeenCalledOnce();
    expect(test.userUpdate).toHaveBeenCalledWith({
      where: { id: before.id },
      data: { name: before.name, email: before.email, role, isActive, teacherId: null, authVersion: { increment: 1 } },
    });
  });

  it.each([
    { label: "no-op", name: "대상", email: "target@example.test" },
    { label: "general information", name: "새 이름", email: "new@example.test" },
  ])("does not increment authVersion for $label", async ({ name, email }) => {
    const test = harness();
    await updateAccountCore(principal(), "target-1", {
      name, email, role: "MANAGER", teacherId: null, isActive: true,
    }, test.client);
    expect(test.userUpdate).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { name, email, role: "MANAGER", isActive: true, teacherId: null },
    });
  });

  it("allows self-demotion and self-deactivation when another active manager exists", async () => {
    // 단순화 결정(ADR-071): 본인 보호는 제거됐다. 다른 관리 가능 계정이 있으면
    // 본인 역할 변경(ADMIN→SUPER_ADMIN 포함)·비활성화가 허용된다.
    const demotion = harness({ target: target({ id: "super-1", role: "SUPER_ADMIN" }) });
    await expect(updateAccountCore(principal(), "super-1", {
      name: "최고관리자",
      email: "super@example.test",
      role: "ADMIN",
      teacherId: null,
      isActive: true,
    }, demotion.client)).resolves.toBeUndefined();
    expect(demotion.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "ADMIN", authVersion: { increment: 1 } }),
    }));

    const deactivation = harness({ target: target({ id: "super-1", role: "SUPER_ADMIN" }) });
    await expect(updateAccountCore(principal(), "super-1", {
      name: "최고관리자",
      email: "super@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: false,
    }, deactivation.client)).resolves.toBeUndefined();
    expect(deactivation.userUpdate).toHaveBeenCalled();
  });

  it("allows an ADMIN actor to create a SUPER_ADMIN account and promote an existing account to SUPER_ADMIN", async () => {
    // ① ADMIN이 SUPER_ADMIN 계정을 생성한다.
    const adminActor = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    const created = await createAccountCore(
      { userId: "admin-1", role: "ADMIN", teacherId: null } as never,
      {
        name: "신규 최고관리자",
        email: "newsuper@example.test",
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
        passwordHash: "hash-only",
      },
      adminActor.client,
    );
    expect(created).toEqual({ id: "created-1" });
    expect(adminActor.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "SUPER_ADMIN" }),
    }));
    expect(adminActor.historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CREATED", nextRole: "SUPER_ADMIN" }),
    });

    // ② ADMIN이 기존 계정을 SUPER_ADMIN으로 승격한다 — authVersion 증가 + ROLE_CHANGED 감사.
    const promotion = harness();
    await updateAccountCore(principal(), "target-1", {
      name: "대상",
      email: "target@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
    }, promotion.client);
    expect(promotion.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "SUPER_ADMIN", authVersion: { increment: 1 } }),
    }));
    expect(promotion.historyCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ type: "ROLE_CHANGED", previousRole: "MANAGER", nextRole: "SUPER_ADMIN" }),
    ] });
  });

  it("allows an ADMIN actor to promote itself to SUPER_ADMIN", async () => {
    // ③ ADMIN 본인이 SUPER_ADMIN으로 승격한다 (본인 역할 변경 허용).
    const test = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
      target: target({ id: "admin-1", role: "ADMIN" }),
    });
    await expect(updateAccountCore(
      { userId: "admin-1", role: "ADMIN", teacherId: null } as never,
      "admin-1",
      {
        name: "관리자",
        email: "admin@example.test",
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
      },
      test.client,
    )).resolves.toBeUndefined();
    expect(test.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "SUPER_ADMIN", authVersion: { increment: 1 } }),
    }));
  });

  it("blocks removal of the last active manager, whether self or another account", async () => {
    // ⑤ 마지막 관리 가능 계정 제거 시도(본인·타인 모두)가 거부된다.
    // (a) 본인: 유일한 활성 ADMIN이 본인을 강등한다.
    const selfDemotion = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
      target: target({ id: "admin-1", role: "ADMIN" }),
      activeAdminCount: 1,
      activeSuperAdminCount: 0,
    });
    await expect(updateAccountCore(
      { userId: "admin-1", role: "ADMIN", teacherId: null } as never,
      "admin-1",
      {
        name: "마지막 관리자",
        email: "admin@example.test",
        role: "MANAGER",
        teacherId: null,
        isActive: true,
      },
      selfDemotion.client,
    )).rejects.toMatchObject({ code: "LAST_ACTIVE_MANAGER" });
    expect(selfDemotion.userUpdate).not.toHaveBeenCalled();

    // (b) 타인: 유일한 활성 ADMIN을 다른 행위자가 강등한다.
    const otherDemotion = harness({
      target: target({ role: "ADMIN" }),
      activeAdminCount: 1,
      activeSuperAdminCount: 0,
    });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "마지막 관리자",
      email: "target@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, otherDemotion.client)).rejects.toMatchObject({ code: "LAST_ACTIVE_MANAGER" });
    expect(otherDemotion.userUpdate).not.toHaveBeenCalled();

    // (c) 타인: 유일한 활성 SUPER_ADMIN을 비활성화한다.
    const otherDeactivation = harness({
      target: target({ role: "SUPER_ADMIN" }),
      activeAdminCount: 0,
      activeSuperAdminCount: 1,
    });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "마지막 최고관리자",
      email: "target@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: false,
    }, otherDeactivation.client)).rejects.toMatchObject({ code: "LAST_ACTIVE_MANAGER" });
    expect(otherDeactivation.userUpdate).not.toHaveBeenCalled();

    // (d) 대조: 관리 가능 계정이 2명 이상이면 같은 변경이 허용된다.
    const allowed = harness({
      target: target({ role: "ADMIN" }),
      activeAdminCount: 1,
      activeSuperAdminCount: 1,
    });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "관리자",
      email: "target@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, allowed.client)).resolves.toBeUndefined();
    expect(allowed.userUpdate).toHaveBeenCalled();
  });

  it("checks the combined manager count once when removing the last active manager", async () => {
    const test = harness({
      target: target({ role: "SUPER_ADMIN" }),
      activeAdminCount: 0,
      activeSuperAdminCount: 1,
    });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "최고관리자",
      email: "target@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, test.client)).rejects.toMatchObject({ code: "LAST_ACTIVE_MANAGER" });
    expect(test.calls).toEqual(["advisory-lock", "actor-check", "target-lock", "manager-count"]);
    expect(test.userUpdate).not.toHaveBeenCalled();
  });

  it("allows general-path edits of a SUPER_ADMIN target, including password reset", async () => {
    // SUPER_ADMIN 행도 일반 행처럼 편집할 수 있다 (이름만 변경 포함).
    const edit = harness({ target: target({ role: "SUPER_ADMIN" }), activeSuperAdminCount: 2 });
    await expect(updateAccountCore(principal(), "target-1", {
      name: "이름만 변경",
      email: "target@example.test",
      role: "SUPER_ADMIN",
      teacherId: null,
      isActive: true,
    }, edit.client)).resolves.toBeUndefined();
    expect(edit.userUpdate).toHaveBeenCalled();

    // ⑧ SUPER_ADMIN 대상 비밀번호 재설정이 된다.
    const reset = harness({ target: target({ role: "SUPER_ADMIN" }) });
    await expect(resetAccountPasswordCore(principal(), "target-1", "new-hash", reset.client))
      .resolves.toBeUndefined();
    expect(reset.userUpdate).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: { password: "new-hash", mustChangePassword: true, authVersion: { increment: 1 } },
    });
    expect(reset.historyCreate).toHaveBeenCalledWith({
      data: { targetUserId: "target-1", actorAdminId: "super-1", type: "PASSWORD_RESET" },
    });
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

describe("last manager concurrency model", () => {
  it("serializes competing demotions so the last active manager survives", async () => {
    // 단순화 결정(ADR-071): 마지막 관리 가능 계정 가드는 활성 ADMIN + 활성
    // SUPER_ADMIN 합산이다. 행위자(SUPER_ADMIN)는 강등 대상이 아니며, 세 건의
    // 동시 강등 중 앞의 두 건만 성공하고 마지막 한 건이 LAST_ACTIVE_MANAGER으로
    // 거부돼 활성 관리자 1명이 남는다.
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
              count: vi.fn(async ({ where }: { where: { role?: { in?: string[] } | string; isActive?: boolean } }) =>
                [...users.values()].filter((user) => {
                  const roles = typeof where.role === "object" ? where.role.in ?? [] : [where.role];
                  return roles.includes(user.role) && user.isActive === where.isActive;
                }).length),
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
    const demoteSelf = updateAccountCore(principal("super-1"), "super-1", {
      name: "최고관리자",
      email: "super@example.test",
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    }, client);

    const results = await Promise.allSettled([demoteB, demoteA, demoteSelf]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "LAST_ACTIVE_MANAGER" });
    expect([...users.values()].filter((user) => (user.role === "ADMIN" || user.role === "SUPER_ADMIN") && user.isActive)).toHaveLength(1);
  });
});
