import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

export const ACCOUNT_ROLE_LABELS = {
  ADMIN: "관리자",
  MANAGER: "준관리자",
  TEACHER: "선생님",
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

export async function listAccounts() {
  await requireAdminPrincipal();
  return prisma.user.findMany({
    select: ACCOUNT_SUMMARY_SELECT,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function getAccountDetail(id: string) {
  await requireAdminPrincipal();

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
  await requireAdminPrincipal();
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
