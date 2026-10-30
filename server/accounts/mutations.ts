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
  | "TEACHER_NOT_AVAILABLE"
  | "SUPER_ADMIN_FORBIDDEN";

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
  // P1: 일반 경로의 신뢰 경계. DB 행은 P7 이후 SUPER_ADMIN일 수 있어 코어 입력·잠금 행은
  // SUPER_ADMIN을 명시적으로 포함하고, 아래에서 일반 경로 진입을 거부한다.
  role: AccountRole | "SUPER_ADMIN";
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

export type CreateAccountCoreInput = Omit<AccountCreateInput, "temporaryPassword" | "role"> & {
  passwordHash: string;
  // P1 신뢰 경계: 검증 스키마는 SUPER_ADMIN을 허용하지 않지만, 코어는 우회 호출에 대비해
  // SUPER_ADMIN 입력을 명시적으로 받고 아래에서 거부한다.
  role: AccountRole | "SUPER_ADMIN";
};

export async function createAccountCore(
  principal: CurrentPrincipal,
  input: CreateAccountCoreInput,
  client: AccountMutationClient = prisma,
): Promise<{ id: string }> {
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAdminActor(tx, principal);
    // P1 차단 (스키마·선택지 확장보다 먼저 강제): 일반 생성 경로로 SUPER_ADMIN을 만들 수 없다.
    // SUPER_ADMIN 생성은 최초 등록 절차(P7)·승격 워크플로(P3-2)로만 허용된다.
    if (input.role === "SUPER_ADMIN") {
      throw new AccountMutationError("SUPER_ADMIN_FORBIDDEN");
    }
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
  input: Omit<AccountUpdateInput, "role"> & { role: AccountRole | "SUPER_ADMIN" },
  client: AccountMutationClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAdminActor(tx, principal);
    const current = await lockTargetAccount(tx, targetUserId);

    // P1 차단: 일반 수정 경로로는 SUPER_ADMIN 대상의 어떤 변경도, SUPER_ADMIN으로의 승격도 불가하다.
    // SUPER_ADMIN 관련 변경은 승인·실행 워크플로(P2-2)·승격 워크플로(P3-2)로만 허용된다.
    if (current.role === "SUPER_ADMIN" || input.role === "SUPER_ADMIN") {
      throw new AccountMutationError("SUPER_ADMIN_FORBIDDEN");
    }

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
    const current = await lockTargetAccount(tx, targetUserId);

    // P1 차단 (방어 심화): 일반 재설정 경로로 SUPER_ADMIN credential을 교체할 수 없다.
    // 임시 비밀번호를 아는 행위자가 SUPER_ADMIN으로 로그인하는 상승 경로를 막는다.
    if (current.role === "SUPER_ADMIN") {
      throw new AccountMutationError("SUPER_ADMIN_FORBIDDEN");
    }

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
