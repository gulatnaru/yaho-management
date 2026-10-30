import { describe, expect, it, vi } from "vitest";
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

// P2: 코어 행위자는 SUPER_ADMIN 전용이다. P1의 ADMIN 행위자는 코어에서 거부된다.
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

describe("P2 SUPER_ADMIN escalation blocking (server-enforced, SUPER_ADMIN actor)", () => {
  it("rejects ADMIN and STAFF actors at the core before any write", async () => {
    const adminActor = harness({
      actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    await expect(
      createAccountCore({ userId: "admin-1", role: "ADMIN", teacherId: null } as never, { ...createInput, role: "STAFF" }, adminActor.client as never),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_SUPER_ADMIN" });
    expect(adminActor.userCreate).not.toHaveBeenCalled();

    const staffActor = harness({
      actor: { id: "staff-1", email: "staff@example.test", role: "STAFF" },
    });
    await expect(
      createAccountCore({ userId: "staff-1", role: "STAFF", teacherId: null } as never, { ...createInput, role: "STAFF" }, staffActor.client as never),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_SUPER_ADMIN" });
    expect(staffActor.userCreate).not.toHaveBeenCalled();
  });

  it("rejects general-path creation of SUPER_ADMIN before any write", async () => {
    const { client, userCreate } = harness();
    await expect(
      createAccountCore(principal(), { ...createInput, role: "SUPER_ADMIN" }, client as never),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(userCreate).not.toHaveBeenCalled();
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

  it("rejects promotion to SUPER_ADMIN via general update", async () => {
    const { client, userUpdate } = harness();
    await expect(
      updateAccountCore(
        principal(),
        "target-1",
        { ...updateInput, role: "SUPER_ADMIN" },
        client as never,
      ),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects any general-path edit of a SUPER_ADMIN target (demotion included)", async () => {
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
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    await expect(
      updateAccountCore(
        principal(),
        "target-1",
        { ...updateInput, role: "SUPER_ADMIN", name: "이름 변경" },
        client as never,
      ),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects general-path password reset of a SUPER_ADMIN target", async () => {
    const { client, userUpdate } = harness({
      target: target({ role: "SUPER_ADMIN" }),
    });
    await expect(
      resetAccountPasswordCore(principal(), "target-1", "hashed", client as never),
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
    expect(userUpdate).not.toHaveBeenCalled();
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

  it("rejects SUPER_ADMIN at the validation layer (general selection excludes it)", () => {
    expect(
      accountCreateSchema.safeParse({ ...base, role: "SUPER_ADMIN" }).success,
    ).toBe(false);
    expect(
      accountUpdateSchema.safeParse({
        name: "대상",
        email: "target@example.test",
        role: "SUPER_ADMIN",
        teacherId: null,
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it("accepts STAFF without a teacher link and still requires one for TEACHER", () => {
    expect(accountCreateSchema.safeParse({ ...base, role: "STAFF" }).success).toBe(true);
    expect(accountCreateSchema.safeParse({ ...base, role: "TEACHER" }).success).toBe(false);
  });
});
