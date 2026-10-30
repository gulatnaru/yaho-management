import { notFound } from "next/navigation";
import { requireCurrentPrincipal, requireSuperAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

export const ACCOUNT_ROLE_LABELS = {
  SUPER_ADMIN: "최고관리자",
  ADMIN: "관리자",
  MANAGER: "준관리자",
  TEACHER: "선생님",
  STAFF: "직원",
} as const;

export const ACCOUNT_CHANGE_LABELS = {
  CREATED: "계정 생성",
  EMAIL_CHANGED: "이메일 변경",
  ROLE_CHANGED: "역할 변경",
  ACTIVE_CHANGED: "활성 상태 변경",
  PASSWORD_RESET: "비밀번호 재설정",
} as const;

const ACCOUNT_SUMMARY_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  teacher: {
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * P2 (OQ-1 간소화): 계정 관리 조회는 SUPER_ADMIN 전용으로 전환됐다. 이 3개 쿼리가
 * 목록·상세·생성 페이지의 실제 choke point이므로, 페이지 가드만 바꾸는 부분 교체는
 * 허용하지 않는다. ADMIN은 전환 이후 계정 관리에 접근할 수 없다.
 */
export async function listAccounts() {
  await requireSuperAdminPrincipal();
  return prisma.user.findMany({
    select: ACCOUNT_SUMMARY_SELECT,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function getAccountDetail(id: string) {
  await requireSuperAdminPrincipal();

  const [account, history] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: ACCOUNT_SUMMARY_SELECT,
    }),
    prisma.userAccountChange.findMany({
      where: { targetUserId: id },
      select: {
        id: true,
        type: true,
        previousEmail: true,
        nextEmail: true,
        previousRole: true,
        nextRole: true,
        previousIsActive: true,
        nextIsActive: true,
        createdAt: true,
        actorAdmin: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);

  return account ? { account, history } : null;
}

export async function listAvailableAccountTeachers(currentTeacherId?: string | null) {
  await requireSuperAdminPrincipal();
  return prisma.teacher.findMany({
    where: {
      isActive: true,
      OR: [
        { user: null },
        ...(currentTeacherId ? [{ id: currentTeacherId }] : []),
      ],
    },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/**
 * P2 (OQ-12): 본인 이력 전용 조회 경로. 읽기 전용이며, 서버에서 권한을 검사한다.
 * SUPER_ADMIN은 전체 이력을 상세 경로(getAccountDetail)로 보지만, 이 경로에서도 본인
 * 이력만 반환한다. ADMIN·STAFF는 대상=본인인 행만 반환하고, 계정 관리 페이지에는
 * 접근할 수 없다. MANAGER·TEACHER는 P2 범위에서 미결이므로 차단 방향으로 거부한다.
 * 클라이언트 숨김만으로 제한하지 않으며, live principal 기준으로 필터링한다.
 */
export async function listOwnAccountHistory() {
  const principal = await requireCurrentPrincipal();
  if (principal.role !== "SUPER_ADMIN" && principal.role !== "ADMIN" && principal.role !== "STAFF") {
    notFound();
  }

  return prisma.userAccountChange.findMany({
    where: { targetUserId: principal.userId },
    select: {
      id: true,
      type: true,
      previousEmail: true,
      nextEmail: true,
      previousRole: true,
      nextRole: true,
      previousIsActive: true,
      nextIsActive: true,
      createdAt: true,
      actorAdmin: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}
