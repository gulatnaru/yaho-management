import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";
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
 * P2-S 전환 안전장치 — 계정 관리 전용 모드 가드. P2의 requireSuperAdminPrincipal
 * 단일 계약을 모드별 계약으로 대체한다. 판정은 lib/auth/cutover-mode.ts의
 * resolveAccountCutoverMode() 하나만 쓰며, 계층별로 다른 판정을 두지 않는다.
 * - LEGACY_ADMIN 모드: ADMIN만 계정 관리를 수행한다 (P2 전환 전 상태).
 * - SUPER_ADMIN 모드: SUPER_ADMIN만 일반 계정 관리를 수행한다 (P2 계약).
 * - 미등록·잘못된 설정(INVALID): 전원 거부한다 (fail-closed, notFound 위장).
 * SUPER_ADMIN 계정이 DB에 존재한다는 사실만으로는 전환되지 않는다 —
 * 모드는 환경변수 설정 + 배포로만 바뀌고, 코드가 스스로 뒤집지 않는다.
 * 코어(server/accounts/mutations.ts)도 트랜잭션 안에서 모드를 다시 읽어
 * 행위자를 재검증하므로, 가드 우회 호출은 코어에서 한 번 더 걸러진다.
 */
export async function requireAccountManagementPrincipal(): Promise<
  AdminPrincipal | SuperAdminPrincipal
> {
  const principal = await requireCurrentPrincipal();
  const mode = resolveAccountCutoverMode();
  if (mode === "LEGACY_ADMIN" && principal.role === "ADMIN") {
    return principal;
  }
  if (mode === "SUPER_ADMIN" && principal.role === "SUPER_ADMIN") {
    return principal;
  }
  notFound();
}

/**
 * P1 금융·운영 ADMIN 진입점용 가드. requireAdminPrincipal을 전역으로 확장하지 않는다 —
 * 전역 확장은 계정 관리 API까지 SUPER_ADMIN에게 의도치 않게 개방하기 때문이다.
 * 계정 관리 진입점은 P2-S부터 requireAccountManagementPrincipal(모드별)로 전환됐다.
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
 * P3 초대 전용 가드 — 모드 가드(requireAccountManagementPrincipal)를 재사용하지 않는다.
 * 모드 가드는 LEGACY 모드에서 ADMIN을 허용하므로, 초대 진입점에 재사용하면
 * LEGACY ADMIN에게 초대 발급 권한이 열리는 정반대 결과가 된다 (게이트 7).
 * 초대 생성·취소·재발급·목록은 모든 모드에서 SUPER_ADMIN 전용이며,
 * 미등록·잘못된 설정(INVALID)에서는 SUPER_ADMIN이라도 전원 거부(fail-closed)한다.
 * LEGACY 모드 + SUPER_ADMIN 존재 시 발급 가능 (로그인은 계정 관리 가드와 무관).
 */
export async function requireInvitationPrincipal(): Promise<SuperAdminPrincipal> {
  const principal = await requireSuperAdminPrincipal();
  if (resolveAccountCutoverMode() === "INVALID") {
    notFound();
  }
  return principal;
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
