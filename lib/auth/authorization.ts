import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { isOperationalPrincipal } from "@/lib/auth/principal";
import {
  resolveSessionPrincipal,
  type AdminPrincipal,
  type CurrentPrincipal,
  type ManagerPrincipal,
  type PrincipalLookupClient,
  type SuperAdminPrincipal,
} from "@/lib/auth/principal";

export { isAdmin, isOperationalRole, isStaff, isSuperAdmin } from "@/lib/auth/roles";
export type {
  AdminPrincipal,
  CurrentPrincipal,
  ManagerPrincipal,
  StaffPrincipal,
  SuperAdminPrincipal,
  TeacherPrincipal,
} from "@/lib/auth/principal";

type ResourceAuthorizationClient = PrincipalLookupClient & {
  classTeacher: {
    findUnique(args: {
      where: { classScheduleId_teacherId: { classScheduleId: string; teacherId: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  reservation: {
    findFirst(args: {
      where: {
        id: string;
        classSchedule: { teachers: { some: { teacherId: string } } };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

const authorizationClient = prisma as unknown as ResourceAuthorizationClient;

const getRequestPrincipal = cache(async (): Promise<CurrentPrincipal | null> => {
  const session = await auth();
  return resolveSessionPrincipal({
    userId: session?.user?.id,
    authVersion: session?.user?.authVersion,
  });
});

function enforcePasswordChange(principal: CurrentPrincipal): CurrentPrincipal {
  if (principal.mustChangePassword) {
    redirect("/account/password");
  }
  return principal;
}

/** Allows the password-change route while still enforcing live account state. */
export async function requirePasswordChangePrincipal(): Promise<CurrentPrincipal> {
  const principal = await getRequestPrincipal();
  if (!principal) {
    redirect("/login");
  }
  return principal;
}

export async function requireCurrentPrincipal(): Promise<CurrentPrincipal> {
  return enforcePasswordChange(await requirePasswordChangePrincipal());
}

export async function requireOperationalPrincipal(): Promise<
  SuperAdminPrincipal | AdminPrincipal | ManagerPrincipal
> {
  const principal = await requireCurrentPrincipal();
  // P1: TEACHER 제외 방식이 아니라 명시적 열거 방식이다. STAFF는 이 가드를 통과하지 않는다.
  if (!isOperationalPrincipal(principal)) {
    notFound();
  }
  return principal;
}

/** Non-throwing public-route lookup; stale, forced-password and non-operational sessions fail closed. */
export async function getOptionalOperationalPrincipal(): Promise<
  SuperAdminPrincipal | AdminPrincipal | ManagerPrincipal | null
> {
  try {
    const principal = await getRequestPrincipal();
    if (!principal || principal.mustChangePassword) return null;
    if (!isOperationalPrincipal(principal)) return null;
    return principal;
  } catch {
    return null;
  }
}

/**
 * 단순화 결정(ADR-071) — 계정 관리 가드는 역할만 본다. ADMIN 또는 SUPER_ADMIN이면
 * 계정 관리를 수행할 수 있다 (활성 + mustChangePassword false는
 * requireCurrentPrincipal이, live 행 재확인은 코어가 담당한다).
 * 전환 모드(LEGACY_ADMIN/SUPER_ADMIN/INVALID)는 계정 관리 경로에서 판정하지 않는다 —
 * 미등록·오타 모드(INVALID)에서도 계정 관리가 끊기지 않는다.
 * 모드 판정 자체는 cutover-mode.ts에 남아 P7 잔존 코드만 참조한다.
 */
export async function requireAccountManagementPrincipal(): Promise<
  AdminPrincipal | SuperAdminPrincipal
> {
  return requireAdminOrSuperAdminPrincipal();
}

/**
 * P1 금융·운영 ADMIN 진입점용 가드. 단순화 결정(ADR-071): 계정 관리 진입점도
 * 이 가드와 동일한 역할 판정(ADMIN 또는 SUPER_ADMIN)을 쓰며,
 * requireAccountManagementPrincipal이 이 함수에 위임한다.
 * 메뉴 노출이 이 가드를 대체하지 않는다.
 */
export async function requireAdminOrSuperAdminPrincipal(): Promise<SuperAdminPrincipal | AdminPrincipal> {
  const principal = await requireCurrentPrincipal();
  if (principal.role !== "SUPER_ADMIN" && principal.role !== "ADMIN") {
    notFound();
  }
  return principal;
}

export async function requireAdminPrincipal(): Promise<AdminPrincipal> {
  const principal = await requireCurrentPrincipal();
  if (principal.role !== "ADMIN") {
    notFound();
  }
  return principal;
}

export async function requireSuperAdminPrincipal(): Promise<SuperAdminPrincipal> {
  const principal = await requireCurrentPrincipal();
  if (principal.role !== "SUPER_ADMIN") {
    notFound();
  }
  return principal;
}

/**
 * P3 초대 전용 가드 — 단순화 결정(ADR-071): ADMIN 또는 SUPER_ADMIN이 초대를
 * 발급·취소·재발급·조회할 수 있다. 전환 모드는 판정하지 않는다 (INVALID
 * 모드에서도 초대 발급이 끊기지 않는다). requireAccountManagementPrincipal과
 * 동일한 역할 판정이며, 진입점만 분리한다.
 */
export async function requireInvitationPrincipal(): Promise<SuperAdminPrincipal | AdminPrincipal> {
  return requireAdminOrSuperAdminPrincipal();
}

function ensureResourcePrincipal(principal: CurrentPrincipal): CurrentPrincipal {
  return enforcePasswordChange(principal);
}

export async function requireAssignedClass(
  classScheduleId: string,
  inputPrincipal?: CurrentPrincipal,
  client: ResourceAuthorizationClient = authorizationClient,
): Promise<CurrentPrincipal> {
  const principal = ensureResourcePrincipal(inputPrincipal ?? (await requireCurrentPrincipal()));
  if (principal.role !== "TEACHER") {
    return principal;
  }

  const assignment = await client.classTeacher.findUnique({
    where: {
      classScheduleId_teacherId: { classScheduleId, teacherId: principal.teacherId },
    },
    select: { id: true },
  });
  if (!assignment) {
    notFound();
  }
  return principal;
}

export async function requireAssignedReservation(
  reservationId: string,
  inputPrincipal?: CurrentPrincipal,
  client: ResourceAuthorizationClient = authorizationClient,
): Promise<CurrentPrincipal> {
  const principal = ensureResourcePrincipal(inputPrincipal ?? (await requireCurrentPrincipal()));
  if (principal.role !== "TEACHER") {
    return principal;
  }

  const reservation = await client.reservation.findFirst({
    where: {
      id: reservationId,
      classSchedule: { teachers: { some: { teacherId: principal.teacherId } } },
    },
    select: { id: true },
  });
  if (!reservation) {
    notFound();
  }
  return principal;
}

export async function requireOwnTeacher(
  teacherId: string,
  inputPrincipal?: CurrentPrincipal,
): Promise<CurrentPrincipal> {
  const principal = ensureResourcePrincipal(inputPrincipal ?? (await requireCurrentPrincipal()));
  if (principal.role === "TEACHER" && principal.teacherId !== teacherId) {
    notFound();
  }
  return principal;
}

/** Compatibility for existing ADMIN actions while they migrate to principals. */
export async function requireAdmin() {
  const principal = await requireAdminPrincipal();
  return {
    user: {
      id: principal.userId,
      name: principal.name,
      email: principal.email,
      role: principal.role,
      authVersion: principal.authVersion,
    },
  };
}
