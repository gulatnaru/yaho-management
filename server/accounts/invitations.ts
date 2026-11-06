import { invitationUseEnabled } from "@/lib/invitations/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { CurrentPrincipal } from "@/lib/auth/authorization";
import {
  generateApplicationCapabilityToken,
  hashApplicationCapabilityToken,
  isWellFormedApplicationLinkToken,
} from "@/lib/reservation-applications/token";
import type { AccountRole, InvitationIssueInput } from "@/lib/validation/accounts";
import {
  acquireAccountMutationLock,
  createAccountInTransaction,
} from "./mutations";

/**
 * P3 직원 초대·수락·활성화 코어 (서버 전용).
 *
 * 보안 계약 (단순화 결정 ADR-071로 변경 — 모드 판정 제거):
 * - 초대 발급·취소·재발급·목록은 ADMIN 또는 SUPER_ADMIN이 수행한다.
 *   requireInvitationPrincipal() + 코어의 assertInvitationActor() 이중 방어를 쓴다.
 *   전환 모드는 판정하지 않는다 (INVALID 모드에서도 발급·수락이 끊기지 않는다).
 * - 토큰은 CSPRNG 32바이트 capability 패턴 → base64url → SHA-256 hex만 DB 저장.
 *   원본 토큰은 이 모듈이 반환하는 1회뿐이며, 제품 라우트·화면·로그에 노출하지 않는다.
 *   (P3 발급 액션은 원본을 버리고, P4에서 발송 인터페이스로 전달한다.)
 * - 수락은 토큰 게이트 대상이다 (세션 무관 공개 라우트). SUPER_ADMIN 대상 초대도
 *   일반 경로로 수락된다 (ADR-071).
 * - 실제 이메일 소유권 확인은 P4 신뢰 경로 연결 후에야 완성된다. 이 모듈의
 *   수락은 토큰 소지 확인이지 이메일 소유권 확인이 아니다.
 * - 최초 SUPER_ADMIN 부트스트랩(P7)·제2 승격(P3-2)에는 이 흐름을 재사용하지 않는다
 *   (P7 코드는 미사용 휴면 상태로 남는다 — ADR-071).
 */

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // OQ-9: 72시간 (최종 값은 P3 REVIEW 확정)

export type InvitationErrorCode =
  | "INVITATION_FORBIDDEN"
  | "INVITATION_EMAIL_ACTIVE"
  | "INVITATION_ROLE_MISMATCH"
  | "INVITATION_NOT_FOUND"
  | "INVITATION_INVALID"
  | "INVITATION_EXPIRED"
  | "INVITATION_REVOKED"
  | "INVITATION_ALREADY_USED"
  | "INVITATION_NOT_PENDING"
  | "INVITATION_TARGET_ACTIVE"
  | "INVITATION_TEACHER_UNAVAILABLE";

export class InvitationError extends Error {
  constructor(readonly code: InvitationErrorCode) {
    super(code);
    this.name = "InvitationError";
  }
}

type InvitationClient = Pick<typeof prisma, "$transaction">;

type InvitationRow = {
  id: string;
  email: string;
  role: AccountRole;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  issuedById: string;
  targetUserId: string;
  createdAt: Date;
};

type TargetRow = {
  id: string;
  email: string;
  role: AccountRole;
  isActive: boolean;
  teacherId: string | null;
};

/**
 * P3 초대 행위자 검증 (트랜잭션 내 재검증 — 가드와 별개).
 * 단순화 결정(ADR-071): ADMIN 또는 SUPER_ADMIN + 활성 + 강제 변경 아님.
 * 전환 모드는 판정하지 않는다. 가드 우회 직접 호출도 코어에서 걸러진다.
 */
export async function assertInvitationActor(
  tx: Prisma.TransactionClient,
  principal: CurrentPrincipal,
): Promise<void> {
  const actor = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { role: true, isActive: true, mustChangePassword: true },
  });
  if ((actor?.role !== "SUPER_ADMIN" && actor?.role !== "ADMIN") || !actor?.isActive || actor.mustChangePassword) {
    throw new InvitationError("INVITATION_FORBIDDEN");
  }
}

async function lockInvitationById(
  tx: Prisma.TransactionClient,
  invitationId: string,
): Promise<InvitationRow | null> {
  const rows = await tx.$queryRaw<InvitationRow[]>(
    Prisma.sql`
      SELECT "id", "email", "role", "tokenHash", "expiresAt", "usedAt", "revokedAt",
             "issuedById", "targetUserId", "createdAt"
      FROM "AdminInvitation"
      WHERE "id" = ${invitationId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

async function lockInvitationByTokenHash(
  tx: Prisma.TransactionClient,
  tokenHash: string,
): Promise<InvitationRow | null> {
  const rows = await tx.$queryRaw<InvitationRow[]>(
    Prisma.sql`
      SELECT "id", "email", "role", "tokenHash", "expiresAt", "usedAt", "revokedAt",
             "issuedById", "targetUserId", "createdAt"
      FROM "AdminInvitation"
      WHERE "tokenHash" = ${tokenHash}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<TargetRow | null> {
  const rows = await tx.$queryRaw<TargetRow[]>(
    Prisma.sql`
      SELECT "id", "email", "role", "isActive", "teacherId"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

/** 대기·만료 초대(미사용)를 전부 해지한다. 동시 유효 토큰 1개 유지를 강제한다. */
async function revokeOpenInvitations(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  actorUserId: string,
  now: Date,
): Promise<number> {
  const open = await tx.adminInvitation.findMany({
    where: { targetUserId, usedAt: null, revokedAt: null },
    select: { id: true },
  });
  if (open.length === 0) return 0;
  await tx.adminInvitation.updateMany({
    where: { id: { in: open.map((row) => row.id) }, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.userAccountChange.createMany({
    data: open.map(() => ({
      targetUserId,
      actorAdminId: actorUserId,
      type: "INVITATION_REVOKED" as const,
    })),
  });
  return open.length;
}

function newInvitationData(
  input: { email: string; role: AccountRole; targetUserId: string; issuedById: string },
  now: Date,
): { token: string; data: Prisma.AdminInvitationCreateInput } {
  const token = generateApplicationCapabilityToken();
  return {
    token,
    data: {
      email: input.email,
      role: input.role,
      tokenHash: hashApplicationCapabilityToken(token),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      issuedBy: { connect: { id: input.issuedById } },
      targetUser: { connect: { id: input.targetUserId } },
    },
  };
}

export type IssueInvitationResult = {
  invitationId: string;
  targetUserId: string;
  /** 원본 토큰 — 호출자가 1회만 다루고 제품 화면·로그에 노출하지 않는다 (P4 발송 전용). */
  token: string;
};

/**
 * P3 초대 발급. ADMIN 또는 SUPER_ADMIN이 수행한다 (단순화 결정 ADR-071).
 * - 기존 활성 이메일 → 거부 (INVITATION_EMAIL_ACTIVE).
 * - 기존 비활성 계정 재초대 → 계정 행 불변 (이름·역할·활성 상태 변경 없음),
 *   역할 불일치 시 거부. 이전 미사용 토큰 해지 후 새 토큰 발행.
 * - 신규 계정 → P2 비활성 생성 규칙 재사용 (passwordHash null, 강제 비활성,
 *   역할 명시, CREATED 감사) + 초대 행 + INVITATION_ISSUED 감사를 하나의 트랜잭션으로.
 *   SUPER_ADMIN 역할로도 발급할 수 있다 (ADR-071).
 * - TEACHER면 발급 시점 선생님 선택이 필수이며, CHECK를 만족하지 못하면
 *   createAccountInTransaction의 validateTeacherLink가 거부한다 (우회 금지).
 * - 발송은 호출하지 않는다 (P4 인터페이스 뒤에 둠). 반환된 원본 토큰은
 *   호출자가 P4 발송 외의 경로(화면·로그)로 노출해서는 안 된다.
 */
export async function issueInvitationCore(
  principal: CurrentPrincipal,
  input: InvitationIssueInput,
  client: InvitationClient = prisma,
): Promise<IssueInvitationResult> {
  const now = new Date();
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertInvitationActor(tx, principal);

    const existing = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true, role: true, isActive: true },
    });

    if (existing?.isActive) {
      throw new InvitationError("INVITATION_EMAIL_ACTIVE");
    }

    let targetUserId: string;
    if (existing) {
      // 비활성 재초대: 계정 행은 건드리지 않는다. 역할이 기존과 다르면 거부한다.
      if (existing.role !== input.role) {
        throw new InvitationError("INVITATION_ROLE_MISMATCH");
      }
      targetUserId = existing.id;
    } else {
      const created = await createAccountInTransaction(
        tx,
        principal,
        {
          name: input.name,
          email: input.email,
          role: input.role,
          teacherId: input.teacherId,
          isActive: false,
          passwordHash: null,
        },
        assertInvitationActor,
      );
      targetUserId = created.id;
    }

    await revokeOpenInvitations(tx, targetUserId, principal.userId, now);
    const { token, data } = newInvitationData(
      { email: input.email, role: input.role, targetUserId, issuedById: principal.userId },
      now,
    );
    const invitation = await tx.adminInvitation.create({ data, select: { id: true } });
    await tx.userAccountChange.create({
      data: {
        targetUserId,
        actorAdminId: principal.userId,
        type: "INVITATION_ISSUED",
        nextEmail: input.email,
        nextRole: input.role,
        nextIsActive: false,
      },
    });
    return { invitationId: invitation.id, targetUserId, token };
  });
}

/**
 * P3 초대 재발급. ADMIN 또는 SUPER_ADMIN이 수행한다 (단순화 결정 ADR-071).
 * - 사용済 초대 → 거부 (수락 완료 계정에 재발급하지 않는다).
 * - 대상 계정 활성 → 거부 (활성 계정의 초대는 권한 변경 절차로 수행한다).
 * - 대기·만료·해지 초대 → 이전 미사용 토큰 전부 해지(REVOKED 감사) 후 새 토큰 발행(RESENT 감사).
 *   계정 행의 역할·활성 상태는 변경하지 않는다 (토큰만 교체).
 */
export async function reissueInvitationCore(
  principal: CurrentPrincipal,
  invitationId: string,
  client: InvitationClient = prisma,
): Promise<IssueInvitationResult> {
  const now = new Date();
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertInvitationActor(tx, principal);

    const invitation = await lockInvitationById(tx, invitationId);
    if (!invitation) {
      throw new InvitationError("INVITATION_NOT_FOUND");
    }
    if (invitation.usedAt !== null) {
      throw new InvitationError("INVITATION_ALREADY_USED");
    }
    const target = await lockUserRow(tx, invitation.targetUserId);
    if (!target) {
      throw new InvitationError("INVITATION_NOT_FOUND");
    }
    if (target.isActive) {
      throw new InvitationError("INVITATION_TARGET_ACTIVE");
    }

    await revokeOpenInvitations(tx, target.id, principal.userId, now);
    const { token, data } = newInvitationData(
      { email: invitation.email, role: invitation.role, targetUserId: target.id, issuedById: principal.userId },
      now,
    );
    const created = await tx.adminInvitation.create({ data, select: { id: true } });
    await tx.userAccountChange.create({
      data: {
        targetUserId: target.id,
        actorAdminId: principal.userId,
        type: "INVITATION_RESENT",
        nextEmail: invitation.email,
        nextRole: invitation.role,
        nextIsActive: false,
      },
    });
    return { invitationId: created.id, targetUserId: target.id, token };
  });
}

/**
 * P3 초대 해지. ADMIN 또는 SUPER_ADMIN이 수행한다 (단순화 결정 ADR-071).
 * - 대기·만료 초대를 해지한다 (revokedAt 설정 + REVOKED 감사). 계정 행은 삭제하지
 *   않고 isActive=false + 해지 상태로 보존한다 (PLAN P3 권장 — 감사 관계 유지).
 * - 사용済 → ALREADY_USED 거부, 이미 해지됨 → REVOKED 거부, 없음 → NOT_FOUND.
 */
export async function cancelInvitationCore(
  principal: CurrentPrincipal,
  invitationId: string,
  client: InvitationClient = prisma,
): Promise<{ invitationId: string }> {
  const now = new Date();
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);
    await assertInvitationActor(tx, principal);

    const invitation = await lockInvitationById(tx, invitationId);
    if (!invitation) {
      throw new InvitationError("INVITATION_NOT_FOUND");
    }
    if (invitation.usedAt !== null) {
      throw new InvitationError("INVITATION_ALREADY_USED");
    }
    if (invitation.revokedAt !== null) {
      throw new InvitationError("INVITATION_REVOKED");
    }
    await tx.adminInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: now },
    });
    await tx.userAccountChange.create({
      data: {
        targetUserId: invitation.targetUserId,
        actorAdminId: principal.userId,
        type: "INVITATION_REVOKED",
        nextEmail: invitation.email,
        nextRole: invitation.role,
        nextIsActive: false,
      },
    });
    return { invitationId: invitation.id };
  });
}

/**
 * P3 초대 상태 조회 (공개 라우트용, 읽기 전용 — 상태를 변경하지 않는다).
 * 반환은 폼 노출 여부 판정용 최소 정보뿐이다: 유효한 대기 초대인지 여부와
 * 만료 여부(재요청 안내 문구 구분용). 계정 존재 여부·초대자 정보는 포함하지 않는다.
 */
export async function getInvitationAcceptanceState(
  token: string,
  client: Pick<typeof prisma, "adminInvitation"> = prisma,
): Promise<{ state: "VALID" | "INVALID" | "EXPIRED" }> {
  if (!isWellFormedApplicationLinkToken(token)) {
    return { state: "INVALID" };
  }
  const invitation = await client.adminInvitation.findUnique({
    where: { tokenHash: hashApplicationCapabilityToken(token) },
    select: { usedAt: true, revokedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.usedAt !== null || invitation.revokedAt !== null) {
    return { state: "INVALID" };
  }
  if (invitation.expiresAt <= new Date()) {
    return { state: "EXPIRED" };
  }
  return { state: "VALID" };
}

export type AcceptInvitationResult = { userId: string };

/**
 * P3 초대 수락 (9단계, 토큰 게이트 대상 — 세션 무관).
 * ① 토큰 검증 ② 만료·사용·취소·대상 상태 확인 ③~④ 비밀번호 정책은 액션 계층 zod +
 * 코어는 해시만 받는다 ⑤ 해시 저장 ⑥ 토큰 단회 소비 ⑦ 계정 활성화 ⑧ 감사 ⑨ 반환 후
 * 정상 로그인 가능 (자동 로그인 없음 — 액션이 로그인 페이지로 안내).
 * - 토큰 소비와 활성화는 단일 DB 트랜잭션이다. advisory lock 직렬화 +
 *   조건부 업데이트(count 검증)로 동일 토큰 동시 수락 시 최대 1건만 성공한다.
 * - GET 요청만으로 소비·활성화하지 않는다 (이 함수는 POST 액션에서만 호출한다).
 * - 단순화 결정(ADR-071): 모드 판정을 하지 않으며, SUPER_ADMIN 대상 초대의
 *   수락도 일반 경로로 허용한다.
 * - 대상 계정이 이미 활성이면 거부한다 (별도 경로로 활성화된 계정의 토큰 탈취 방지).
 * - 초대 이메일과 대상 계정 이메일이 다르면 거부한다 (발급 후 이메일 변경 시
 *   초대는 무효 — 재발급 필요). 역할은 관리자 변경이 가능하므로 수락 시 건드리지 않는다.
 * - TEACHER 대상은 수락 시점에 선생님 연결이 유효해야 한다 (비활성·연결 해제 시 거부).
 * - O-1 선택 (i): 수락 트랜잭션에서 authVersion을 증가시킨다. 최초 활성화 계정에는
 *   무해하고, 과거 활성 계정의 재활성화 시 구 JWT 부활을 차단한다 (재설정 패턴과 동일).
 *   이에 따라 게이트 문서의 "수락 로직에 authVersion 신규 정책 추가 금지" 지시는
 *   이 범위에서 수정된다 (게이트 REVIEW O-1이 허용한 선택).
 * - 감사: INVITATION_ACCEPTED 1행 (previousIsActive=false → nextIsActive=true로
 *   활성화 전이를 함께 기록한다. ACTIVE_CHANGED 병기는 하지 않는다 — 수락 사건
 *   하나로 완결되며, 활성화 전이는 행의 전후 값으로 식별 가능하다).
 *   행위자는 수락 본인이다 (actorAdminId = targetUserId — 발급자가 아니다).
 *   실패한 수락 시도는 상태를 변경하지 않으므로 감사 행을 쓰지 않는다.
 */
export async function acceptInvitationCore(
  input: { token: string; passwordHash: string },
  client: InvitationClient = prisma,
): Promise<AcceptInvitationResult> {
  if (!invitationUseEnabled()) throw new InvitationError("INVITATION_INVALID");
  if (!isWellFormedApplicationLinkToken(input.token)) {
    throw new InvitationError("INVITATION_INVALID");
  }
  const now = new Date();
  return client.$transaction(async (tx) => {
    await acquireAccountMutationLock(tx);

    const invitation = await lockInvitationByTokenHash(tx, hashApplicationCapabilityToken(input.token));
    if (!invitation) {
      throw new InvitationError("INVITATION_INVALID");
    }
    if (invitation.usedAt !== null) {
      throw new InvitationError("INVITATION_ALREADY_USED");
    }
    if (invitation.revokedAt !== null) {
      throw new InvitationError("INVITATION_REVOKED");
    }
    if (invitation.expiresAt <= now) {
      throw new InvitationError("INVITATION_EXPIRED");
    }

    const target = await lockUserRow(tx, invitation.targetUserId);
    if (!target) {
      throw new InvitationError("INVITATION_INVALID");
    }
    if (target.isActive) {
      throw new InvitationError("INVITATION_TARGET_ACTIVE");
    }
    // 발급 후 대상 이메일이 바뀌었으면 초대는 무효이다 (재발급 필요).
    if (target.email !== invitation.email) {
      throw new InvitationError("INVITATION_INVALID");
    }
    if (target.role === "TEACHER") {
      const teacher = target.teacherId
        ? await tx.teacher.findUnique({ where: { id: target.teacherId }, select: { id: true, isActive: true } })
        : null;
      if (!teacher?.isActive) {
        throw new InvitationError("INVITATION_TEACHER_UNAVAILABLE");
      }
    }

    const consumed = await tx.adminInvitation.updateMany({
      where: { id: invitation.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      throw new InvitationError("INVITATION_ALREADY_USED");
    }
    const activated = await tx.user.updateMany({
      where: { id: target.id, isActive: false },
      data: {
        password: input.passwordHash,
        isActive: true,
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
    });
    if (activated.count !== 1) {
      throw new InvitationError("INVITATION_TARGET_ACTIVE");
    }
    await tx.userAccountChange.create({
      data: {
        targetUserId: target.id,
        actorAdminId: target.id,
        type: "INVITATION_ACCEPTED",
        nextEmail: target.email,
        nextRole: target.role,
        previousIsActive: false,
        nextIsActive: true,
      },
    });
    return { userId: target.id };
  });
}
