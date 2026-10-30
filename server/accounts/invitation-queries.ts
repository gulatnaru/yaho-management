import { requireInvitationPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

/**
 * P3 초대 조회 (SUPER_ADMIN 전용 + INVALID 거부 — requireInvitationPrincipal).
 * 모드 가드(requireAccountManagementPrincipal)를 재사용하지 않는다:
 * LEGACY 모드에서 SUPER_ADMIN이 초대 목록을 보지 못하면 초대 관리 자체가
 * 불가능해지기 때문이다 (게이트 7: 초대 진입점은 모드와 무관하게 SUPER_ADMIN 전용).
 * tokenHash는 어떤 조회에서도 select하지 않는다 (원본 토큰 비노출).
 */

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING: "대기중",
  ACCEPTED: "수락됨",
  REVOKED: "해지됨",
  EXPIRED: "만료됨",
};

/** 초대 상태는 파생 값이다. 만료는 별도 행을 쓰지 않고 expiresAt 경과로 판정한다. */
export function deriveInvitationStatus(invitation: {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (invitation.usedAt !== null) return "ACCEPTED";
  if (invitation.revokedAt !== null) return "REVOKED";
  if (invitation.expiresAt <= new Date()) return "EXPIRED";
  return "PENDING";
}

export async function listInvitations() {
  await requireInvitationPrincipal();
  const rows = await prisma.adminInvitation.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      targetUser: { select: { id: true, name: true, email: true, isActive: true } },
      issuedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({ ...row, status: deriveInvitationStatus(row) }));
}

/** 초대 발급용 선생님 선택지: 활성 + 미연결 선생님만 (계정 생성 폼과 동일 조건). */
export async function listAvailableInvitationTeachers() {
  await requireInvitationPrincipal();
  return prisma.teacher.findMany({
    where: { isActive: true, user: null },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
