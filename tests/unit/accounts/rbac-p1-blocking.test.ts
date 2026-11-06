import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAccountCore,
  resetAccountPasswordCore,
  updateAccountCore,
} from "@/server/accounts/mutations";
import {
  accountCreateSchema,
  accountUpdateSchema,
} from "@/lib/validation/accounts";

type Role = "ADMIN" | "MANAGER" | "TEACHER" | "STAFF" | "SUPER_ADMIN";
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
} = {}) {
  const currentTarget = options.target ?? target();
  const actor =
    options.actor === null
      ? null
      : target({ id: "super-1", email: "super@example.test", role: "SUPER_ADMIN", ...options.actor });
  const userCreate = vi.fn(async () => ({ id: "created-1" }));
  const userUpdate = vi.fn(async () => currentTarget);
  const accountChangeCreate = vi.fn(async () => ({}));
  const accountChangeCreateMany = vi.fn(async () => ({}));
  const userCount = vi.fn(async () => options.activeAdminCount ?? 2);
  let rawCall = 0;
  const queryRaw = vi.fn(async () => {
    rawCall += 1;
    if (rawCall === 1) return []; // advisory lock
    return [currentTarget]; // target lock
  });
  const tx = {
    $queryRaw: queryRaw,
    user: {
      findUnique: vi.fn(async () => actor),
      create: userCreate,
      update: userUpdate,
      count: userCount,
    },
    teacher: { findUnique: vi.fn(async () => null) },
    userAccountChange: { create: accountChangeCreate, createMany: accountChangeCreateMany },
  };
  const client = { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { client, tx, userCreate, userUpdate, accountChangeCreate, accountChangeCreateMany };
}

const createInput = {
  name: "신규",
  email: "new@example.test",
  isActive: true,
  teacherId: null,
  passwordHash: "hashed",
};

const updateInput = {
  name: "대상",
  email: "target@example.test",
  isActive: true,
  teacherId: null,
};

describe("단순화 결정(ADR-071) — ADMIN·SUPER_ADMIN 계정 관리 허용 (서버 강제, 모드 무관)", () => {
  it("allows ADMIN actors and rejects STAFF actors at the core before any write", async () => {
    const adminActor = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    await expect(
      createAccountCore({ userId: "admin-1", role: "ADMIN", teacherId: null } as never, { ...createInput, role: "STAFF" }, adminActor.client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(adminActor.userCreate).toHaveBeenCalled();

    const staffActor = harness({
      actor: { id: "staff-1", email: "staff@example.test", role: "STAFF" },
    });
    await expect(
      createAccountCore({ userId: "staff-1", role: "STAFF", teacherId: null } as never, { ...createInput, role: "STAFF" }, staffActor.client as never),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_ACCOUNT_MANAGER" });
    expect(staffActor.userCreate).not.toHaveBeenCalled();
  });

  it("allows ADMIN and SUPER_ADMIN actors in LEGACY_ADMIN mode", async () => {
    process.env[CUTOVER_ENV] = "LEGACY_ADMIN";
    const legacy = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    await expect(
      createAccountCore({ userId: "admin-1", role: "ADMIN", teacherId: null } as never, { ...createInput, role: "STAFF" }, legacy.client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(legacy.userCreate).toHaveBeenCalled();

    const superInLegacy = harness();
    await expect(
      createAccountCore(principal(), { ...createInput, role: "STAFF" }, superInLegacy.client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(superInLegacy.userCreate).toHaveBeenCalled();
  });

  it("allows a SUPER_ADMIN actor even when the cutover mode is invalid", async () => {
    process.env[CUTOVER_ENV] = "bogus";
    const { client, userCreate } = harness();
    await expect(
      createAccountCore(principal(), { ...createInput, role: "STAFF" }, client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(userCreate).toHaveBeenCalled();
  });

  it("allows general-path creation of SUPER_ADMIN", async () => {
    const { client, userCreate } = harness();
    await expect(
      createAccountCore(principal(), { ...createInput, role: "SUPER_ADMIN" }, client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "SUPER_ADMIN" }) }),
    );
  });

  it("allows general-path creation of STAFF (no automatic ADMIN grant)", async () => {
    const { client, userCreate } = harness();
    await expect(
      createAccountCore(principal(), { ...createInput, role: "STAFF" }, client as never),
    ).resolves.toMatchObject({ id: "created-1" });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "STAFF" }) }),
    );
  });

  it("allows promotion to SUPER_ADMIN via general update", async () => {
    const { client, userUpdate } = harness();
    await expect(
      updateAccountCore(
        principal(),
        "target-1",
        { ...updateInput, role: "SUPER_ADMIN" },
        client as never,
      ),
    ).resolves.toBeUndefined();
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "SUPER_ADMIN" }) }),
    );
  });

  it("allows general-path edits of a SUPER_ADMIN target (demotion and name-only change included)", async () => {
    const { client, userUpdate } = harness({
      target: target({ role: "SUPER_ADMIN" }),
    });
    await expect(
      updateAccountCore(
        principal(),
        "target-1",
        { ...updateInput, role: "ADMIN" },
        client as never,
      ),
    ).resolves.toBeUndefined();
    await expect(
      updateAccountCore(
        principal(),
        "target-1",
        { ...updateInput, role: "SUPER_ADMIN", name: "이름 변경" },
        client as never,
      ),
    ).resolves.toBeUndefined();
    expect(userUpdate).toHaveBeenCalledTimes(2);
  });

  it("allows general-path password reset of a SUPER_ADMIN target", async () => {
    const { client, userUpdate } = harness({
      target: target({ role: "SUPER_ADMIN" }),
    });
    await expect(
      resetAccountPasswordCore(principal(), "target-1", "hashed", client as never),
    ).resolves.toBeUndefined();
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ password: "hashed" }) }),
    );
  });

  it("preserves existing ADMIN->STAFF role change behavior (not a privilege grant)", async () => {
    const { client, userUpdate } = harness();
    await updateAccountCore(
      principal(),
      "target-1",
      { ...updateInput, role: "STAFF" },
      client as never,
    );
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "STAFF" }) }),
    );
  });
});

describe("P1 role validation (OQ-4 option B: role required; P2 keeps it, drops the password field)", () => {
  const base = {
    name: "신규",
    email: "new@example.test",
    teacherId: null,
    isActive: true,
  };

  it("rejects a missing role (no ADMIN default)", () => {
    const { role: _omitted, ...withoutRole } = base as Record<string, unknown>;
    void _omitted;
    expect(
      accountCreateSchema.safeParse({ ...withoutRole, role: undefined }).success,
    ).toBe(false);
  });

  it("accepts SUPER_ADMIN at the validation layer (general selection includes it)", async () => {
    expect(
      accountCreateSchema.safeParse({ ...base, role: "SUPER_ADMIN" }).success,
    ).toBe(true);
    expect(
      accountUpdateSchema.safeParse({
        name: "대상",
        email: "target@example.test",
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
      }).success,
    ).toBe(true);
  });

  it("accepts STAFF without a teacher link and still requires one for TEACHER", () => {
    expect(accountCreateSchema.safeParse({ ...base, role: "STAFF" }).success).toBe(true);
    expect(accountCreateSchema.safeParse({ ...base, role: "TEACHER" }).success).toBe(false);
  });
});
