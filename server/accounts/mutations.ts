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
  | "ACTOR_NOT_ACCOUNT_MANAGER"
  | "ACCOUNT_NOT_FOUND"
  | "LAST_ACTIVE_MANAGER"
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

/**
 * 단순화 결정(ADR-071): 계정 mutation 행위자는 역할만 본다 — ADMIN 또는
 * SUPER_ADMIN이면 허용한다. 전환 모드는 판정하지 않는다 (INVALID 모드에서도
 * 계정 관리가 끊기지 않는다). live principal의 DB 행을 트랜잭션 안에서
 * 재조회하므로, 세션에 남은 낡은 역할·비활성 상태로는 우회할 수 없다.
 * 조건: 활성 + mustChangePassword false + 역할 ADMIN/SUPER_ADMIN.
 */
async function assertAccountManagementActor(tx: Prisma.TransactionClient, principal: CurrentPrincipal): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { role: true, isActive: true, mustChangePassword: true },
  });

  const roleAllowed = actor?.role === "ADMIN" || actor?.role === "SUPER_ADMIN";

  if (!actor?.isActive || actor.mustChangePassword || !roleAllowed) {
    throw new AccountMutationError("ACTOR_NOT_ACCOUNT_MANAGER");
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

export type CreateAccountCoreInput = Omit<AccountCreateInput, "role"> & {
  /**
   * P2 (OQ-8): null이면 비밀번호 없는 생성이다. 이 경우 계정은 비활성(isActive=false,
   * mustChangePassword=false)으로 생성되며, 활성화는 P3 초대 수락을 통해서만 이뤄진다.
   * 문자열이면 기존 해시 경로(재설정 지원과 동일한 mustChangePassword=true 계약)이다.
   */
  passwordHash: string | null;
  // 단순화 결정(ADR-071): SUPER_ADMIN도 일반 생성 경로로 만들 수 있다.
  // ACCOUNT_ROLES가 SUPER_ADMIN을 포함하므로 AccountRole이 그대로 쓰인다.
  role: AccountRole;
};

export type AccountActorAssertion = (
  tx: Prisma.TransactionClient,
  principal: CurrentPrincipal,
) => Promise<void>;

/**
 * P3: 트랜잭션 내부 계정 생성 (호출자가 트랜잭션 + advisory lock을 소유한다).
 * P2 경로(createAccountCore)는 이 함수에 assertAccountManagementActor를 넘기고,
 * P3 초대 발급 경로는 assertInvitationActor를 넘겨 같은 생성·감사 원자성을
 * 초대 행 생성과 하나의 트랜잭션으로 묶는다. 행위자 판정 이외의 규칙
 * (선생님 연결 검증·비밀번호 없는 강제 비활성·CREATED 감사)은 두 경로에서 동일하다.
 * 단순화 결정(ADR-071): SUPER_ADMIN 생성 차단은 제거됐다 — 일반 경로로
 * SUPER_ADMIN 계정을 만들 수 있다.
 */
export async function createAccountInTransaction(
  tx: Prisma.TransactionClient,
  principal: CurrentPrincipal,
  input: CreateAccountCoreInput,
  assertActor: AccountActorAssertion,
): Promise<{ id: string }> {
  await assertActor(tx, principal);
  await validateTeacherLink(tx, input.role, input.teacherId);

  // P2 (OQ-8): 비밀번호 없는 생성은 강제 비활성이다. 호출자가 isActive=true를 넘겨도
  // 활성화되지 않으며, 임시 비밀번호 전달·이메일 검증 우회 활성화 경로는 만들지 않는다.
  const isActive = input.passwordHash === null ? false : input.isActive;
  const mustChangePassword = input.passwordHash !== null;

  const created = await tx.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: input.passwordHash,
      role: input.role,
      isActive,
      teacherId: input.role === "TEACHER" ? input.teacherId : null,
      mustChangePassword,
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
      nextIsActive: isActive,
    },
  });

  return created;
}

export async function createAccountCore(
  principal: CurrentPrincipal,
  input: CreateAccountCoreInput,
  client: AccountMutationClient = prisma,
): Promise<{ id: string }> {
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    return createAccountInTransaction(tx, principal, input, assertAccountManagementActor);
  });
}

export async function updateAccountCore(
  principal: CurrentPrincipal,
  targetUserId: string,
  input: Omit<AccountUpdateInput, "role"> & { role: AccountRole },
  client: AccountMutationClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertAccountManagementActor(tx, principal);
    const current = await lockTargetAccount(tx, targetUserId);

    // 단순화 결정(ADR-071): 본인 보호(SELF_DEACTIVATION·SELF_ROLE_CHANGE)는 제거됐다.
    // ADMIN 본인의 역할 변경(ADMIN→SUPER_ADMIN 포함)·비활성화도 허용한다.
    // 유일하게 남는 차단은 아래 최종 관리 가능 계정 가드이다.
    // 최종 관리 가능 계정 가드 (LAST_ACTIVE_MANAGER): 변경(역할 변경 또는
    // 비활성화) 후 활성 ADMIN + 활성 SUPER_ADMIN의 합이 0명이 되면 거부한다.
    // 본인·타인 모두에 적용되며, 마지막 관리 가능 계정이 사라지는 변경 하나만 막는다.
    const removesActiveManager =
      (current.role === "ADMIN" || current.role === "SUPER_ADMIN") &&
      current.isActive &&
      (input.role !== "ADMIN" && input.role !== "SUPER_ADMIN" || !input.isActive);
    if (removesActiveManager) {
      const activeManagerCount = await tx.user.count({
        where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, isActive: true },
      });
      if (activeManagerCount <= 1) {
        throw new AccountMutationError("LAST_ACTIVE_MANAGER");
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
        ...(current.role !== input.role || current.isActive !== input.isActive
          ? { authVersion: { increment: 1 } }
          : {}),
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
    await assertAccountManagementActor(tx, principal);
    // 대상 행 잠금 (없으면 ACCOUNT_NOT_FOUND). 단순화 결정(ADR-071): SUPER_ADMIN
    // 대상 재설정 차단은 제거됐다 — 일반 재설정 경로로 SUPER_ADMIN credential을
    // 교체할 수 있다.
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
