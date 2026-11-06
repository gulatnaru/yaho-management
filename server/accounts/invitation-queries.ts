import { requireInvitationPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

/**
 * P3 초대 조회 (ADMIN 또는 SUPER_ADMIN — requireInvitationPrincipal, 단순화 결정 ADR-071).
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
      deliveryAttempt: { select: { status: true } },
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
