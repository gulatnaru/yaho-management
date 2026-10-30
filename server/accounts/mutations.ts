import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";
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
  | "SELF_DEACTIVATION"
  | "SELF_ROLE_CHANGE"
  | "LAST_ACTIVE_ADMIN"
  | "LAST_ACTIVE_SUPER_ADMIN"
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

/**
 * P2-S (모드별 계약): 계정 mutation 행위자는 전환 모드에 따라 달라진다.
 * - LEGACY_ADMIN 모드: ADMIN 행위자만 허용한다 (P2 전환 전 상태).
 * - SUPER_ADMIN 모드: SUPER_ADMIN 행위자만 허용한다 (P2 계약).
 * - 미등록·잘못된 설정(INVALID): 전원 거부한다 (fail-closed).
 * 모드는 액션·쿼리 가드와 별개로 트랜잭션 안에서 다시 읽는다 — 가드에
 * 전달된 값이 아니라 호출 시점의 process.env를 기준으로 재검증하므로,
 * 가드 우회 직접 호출도 코어에서 걸러진다. SUPER_ADMIN 계정이 DB에
 * 존재한다는 사실만으로는 LEGACY 모드에서 권한이 생기지 않는다.
 * live principal의 DB 행을 트랜잭션 안에서 재조회하므로, 세션에 남은
 * 낡은 역할·비활성 상태로는 우회할 수 없다. 코드명은 P2의
 * ACTOR_NOT_SUPER_ADMIN에서 모드별 계약에 맞게 변경됐다.
 */
async function assertAccountManagementActor(tx: Prisma.TransactionClient, principal: CurrentPrincipal): Promise<void> {
  const mode = resolveAccountCutoverMode();
  const actor = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { role: true, isActive: true, mustChangePassword: true },
  });

  const roleAllowed =
    mode === "LEGACY_ADMIN" ? actor?.role === "ADMIN" : mode === "SUPER_ADMIN" ? actor?.role === "SUPER_ADMIN" : false;

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
    await assertAccountManagementActor(tx, principal);
    // P1 차단 (스키마·선택지 확장보다 먼저 강제): 일반 생성 경로로 SUPER_ADMIN을 만들 수 없다.
    // SUPER_ADMIN 생성은 최초 등록 절차(P7)·승격 워크플로(P3-2)로만 허용된다.
    if (input.role === "SUPER_ADMIN") {
      throw new AccountMutationError("SUPER_ADMIN_FORBIDDEN");
    }
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
    await assertAccountManagementActor(tx, principal);
    const current = await lockTargetAccount(tx, targetUserId);

    // P2 본인 보호 (P1 ADMIN 전용에서 일반화): 행위자 본인의 비활성화·역할 변경은
    // 대상 역할과 무관하게 거부한다. SUPER_ADMIN 본인의 강등도 여기서 SELF_ROLE_CHANGE으로
    // 거부되며, 일반 경로 blanket보다 먼저 판정한다.
    if (principal.userId === targetUserId && !input.isActive) {
      throw new AccountMutationError("SELF_DEACTIVATION");
    }
    if (principal.userId === targetUserId && input.role !== current.role) {
      throw new AccountMutationError("SELF_ROLE_CHANGE");
    }

    // P2 마지막 활성 SUPER_ADMIN 보호 (LAST_ACTIVE_ADMIN과 병존). 실제 활성 SUPER_ADMIN을
    // 제거하는 변경(비활성화 또는 SUPER_ADMIN 외 역할로의 변경)에 한해, 활성 SUPER_ADMIN이
    // 1명 이하이면 거부한다. 일반 경로에서는 본인 제거가 위 본인 보호에, 타인 제거가 아래
    // blanket에 먼저 걸리므로 이 검사는 방어 심화(defense-in-depth)이며, 목 기반 단위
    // 테스트로 판정 순서·코드를 검증한다. 고위험 승격·최초 등록 전용 경로는 P3-2/P7 범위이다.
    const removesActiveSuperAdmin = current.role === "SUPER_ADMIN" && current.isActive &&
      (input.role !== "SUPER_ADMIN" || !input.isActive);
    if (removesActiveSuperAdmin) {
      const activeSuperAdminCount = await tx.user.count({ where: { role: "SUPER_ADMIN", isActive: true } });
      if (activeSuperAdminCount <= 1) {
        throw new AccountMutationError("LAST_ACTIVE_SUPER_ADMIN");
      }
    }

    // P1 차단 유지: 일반 수정 경로로는 SUPER_ADMIN 대상의 어떤 변경도, SUPER_ADMIN으로의
    // 승격도 불가하다. SUPER_ADMIN 관련 변경은 승격 워크플로(P3-2)·최초 등록(P7)으로만
    // 허용되며, 일반 변경 2인 승인·실행 워크플로(P2-2)는 간소화 결정으로 폐지됐다.
    if (current.role === "SUPER_ADMIN" || input.role === "SUPER_ADMIN") {
      throw new AccountMutationError("SUPER_ADMIN_FORBIDDEN");
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
    await assertAccountManagementActor(tx, principal);
    const current = await lockTargetAccount(tx, targetUserId);

    // P1 차단 유지 (방어 심화): 일반 재설정 경로로 SUPER_ADMIN credential을 교체할 수 없다.
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
