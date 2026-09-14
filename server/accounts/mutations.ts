import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CurrentPrincipal } from "@/lib/auth/authorization";
import {
  ACCOUNT_MUTATION_ADVISORY_LOCK_KEY,
  lockAccountMutations,
} from "@/lib/auth/account-lock";
import type { AccountCreateInput, AccountRole, AccountUpdateInput } from "@/lib/validation/accounts";

export { ACCOUNT_MUTATION_ADVISORY_LOCK_KEY };

export type AccountMutationErrorCode =
  | "ACTOR_NOT_ADMIN"
  | "ACCOUNT_NOT_FOUND"
  | "SELF_DEACTIVATION"
  | "SELF_ROLE_CHANGE"
  | "LAST_ACTIVE_ADMIN"
  | "TEACHER_REQUIRED"
  | "TEACHER_NOT_AVAILABLE";

export class AccountMutationError extends Error {
  constructor(readonly code: AccountMutationErrorCode) {
    super(code);
    this.name = "AccountMutationError";
  }
}

type AccountMutationClient = Pick<typeof prisma, "$transaction">;

type LockedAccount = {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  isActive: boolean;
  teacherId: string | null;
};

/**
 * 모든 계정·credential mutation이 공유하는 transaction-scoped lock이다.
 * self password change도 transaction 안에서 이 helper를 먼저 호출해야 reset과 직렬화된다.
 */
export async function acquireAccountMutationLock(tx: Prisma.TransactionClient): Promise<void> {
  await lockAccountMutations(tx);
}

async function assertAdminActor(tx: Prisma.TransactionClient, principal: CurrentPrincipal): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { role: true, isActive: true, mustChangePassword: true },
  });

  if (!actor?.isActive || actor.role !== "ADMIN" || actor.mustChangePassword) {
    throw new AccountMutationError("ACTOR_NOT_ADMIN");
  }
}

async function lockTargetAccount(
  tx: Prisma.TransactionClient,
  targetUserId: string,
): Promise<LockedAccount> {
  const rows = await tx.$queryRaw<LockedAccount[]>(
    Prisma.sql`
      SELECT "id", "email", "name", "role", "isActive", "teacherId"
      FROM "User"
      WHERE "id" = ${targetUserId}
      FOR UPDATE
    `,
  );
  const account = rows[0];
  if (!account) {
    throw new AccountMutationError("ACCOUNT_NOT_FOUND");
  }
  return account;
}

async function validateTeacherLink(
  tx: Prisma.TransactionClient,
  role: AccountRole,
  teacherId: string | null,
  targetUserId?: string,
): Promise<void> {
  if (role !== "TEACHER") {
    if (teacherId) {
      throw new AccountMutationError("TEACHER_NOT_AVAILABLE");
    }
    return;
  }

  if (!teacherId) {
    throw new AccountMutationError("TEACHER_REQUIRED");
  }

  const [teacher, linkedUser] = await Promise.all([
    tx.teacher.findUnique({
      where: { id: teacherId },
      select: { id: true, isActive: true },
    }),
    tx.user.findFirst({
      where: {
        teacherId,
        ...(targetUserId ? { NOT: { id: targetUserId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (!teacher?.isActive || linkedUser) {
    throw new AccountMutationError("TEACHER_NOT_AVAILABLE");
  }
}

export type CreateAccountCoreInput = Omit<AccountCreateInput, "temporaryPassword"> & {
  passwordHash: string;
};

export async function createAccountCore(
  principal: CurrentPrincipal,
  input: CreateAccountCoreInput,
  client: AccountMutationClient = prisma,
): Promise<{ id: string }> {
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAdminActor(tx, principal);
    await validateTeacherLink(tx, input.role, input.teacherId);

    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        password: input.passwordHash,
        role: input.role,
        isActive: input.isActive,
        teacherId: input.role === "TEACHER" ? input.teacherId : null,
        mustChangePassword: true,
        authVersion: 1,
      },
      select: { id: true },
    });

    await tx.userAccountChange.create({
      data: {
        targetUserId: created.id,
        actorAdminId: principal.userId,
        type: "CREATED",
        nextEmail: input.email,
        nextRole: input.role,
        nextIsActive: input.isActive,
      },
    });

    return created;
  });
}

export async function updateAccountCore(
  principal: CurrentPrincipal,
  targetUserId: string,
  input: AccountUpdateInput,
  client: AccountMutationClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAdminActor(tx, principal);
    const current = await lockTargetAccount(tx, targetUserId);

    if (principal.userId === targetUserId && !input.isActive) {
      throw new AccountMutationError("SELF_DEACTIVATION");
    }
    if (principal.userId === targetUserId && current.role === "ADMIN" && input.role !== "ADMIN") {
      throw new AccountMutationError("SELF_ROLE_CHANGE");
    }

    const removesActiveAdmin = current.role === "ADMIN" && current.isActive &&
      (input.role !== "ADMIN" || !input.isActive);
    if (removesActiveAdmin) {
      const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
      if (activeAdminCount <= 1) {
        throw new AccountMutationError("LAST_ACTIVE_ADMIN");
      }
    }

    await validateTeacherLink(tx, input.role, input.teacherId, targetUserId);

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        isActive: input.isActive,
        teacherId: input.role === "TEACHER" ? input.teacherId : null,
      },
    });

    const historyRows: Array<{
      targetUserId: string;
      actorAdminId: string;
      type: "EMAIL_CHANGED" | "ROLE_CHANGED" | "ACTIVE_CHANGED";
      previousEmail?: string;
      nextEmail?: string;
      previousRole?: AccountRole;
      nextRole?: AccountRole;
      previousIsActive?: boolean;
      nextIsActive?: boolean;
    }> = [];

    if (current.email !== input.email) {
      historyRows.push({
        targetUserId,
        actorAdminId: principal.userId,
        type: "EMAIL_CHANGED",
        previousEmail: current.email,
        nextEmail: input.email,
      });
    }
    if (current.role !== input.role) {
      historyRows.push({
        targetUserId,
        actorAdminId: principal.userId,
        type: "ROLE_CHANGED",
        previousRole: current.role,
        nextRole: input.role,
      });
    }
    if (current.isActive !== input.isActive) {
      historyRows.push({
        targetUserId,
        actorAdminId: principal.userId,
        type: "ACTIVE_CHANGED",
        previousIsActive: current.isActive,
        nextIsActive: input.isActive,
      });
    }

    if (historyRows.length > 0) {
      await tx.userAccountChange.createMany({ data: historyRows });
    }
  });
}

export async function resetAccountPasswordCore(
  principal: CurrentPrincipal,
  targetUserId: string,
  passwordHash: string,
  client: AccountMutationClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAdminActor(tx, principal);
    await lockTargetAccount(tx, targetUserId);

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        password: passwordHash,
        mustChangePassword: true,
        authVersion: { increment: 1 },
      },
    });

    await tx.userAccountChange.create({
      data: {
        targetUserId,
        actorAdminId: principal.userId,
        type: "PASSWORD_RESET",
      },
    });
  });
}
