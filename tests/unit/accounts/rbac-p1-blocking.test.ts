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
} = {}) {
  const currentTarget = options.target ?? target();
  const actor =
    options.actor === null
      ? null
      : target({ id: "admin-1", email: "admin@example.test", role: "ADMIN", ...options.actor });
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

describe("P1 SUPER_ADMIN escalation blocking (server-enforced)", () => {
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

describe("P1 role validation (OQ-4 option B: role required)", () => {
  const base = {
    name: "신규",
    email: "new@example.test",
    teacherId: null,
    isActive: true,
    temporaryPassword: "password-123",
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
