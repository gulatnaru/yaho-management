export const USER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEACHER", "STAFF"] as const;

export type UserRole = (typeof USER_ROLES)[number];

type AuthorizedUser = { id?: string; role?: UserRole } | undefined;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isAdmin(user: AuthorizedUser): boolean {
  return user?.role === "ADMIN";
}

export function isSuperAdmin(user: AuthorizedUser): boolean {
  return user?.role === "SUPER_ADMIN";
}

export function isStaff(user: AuthorizedUser): boolean {
  return user?.role === "STAFF";
}

/**
 * P1-UI 금융·운영 표시 및 서버 검증용 ADMIN 동등 범위: ADMIN 또는 SUPER_ADMIN.
 * SUPER_ADMIN은 기존 ADMIN과 동일한 정상 운영·금융 기능을 이용한다.
 * 계정 관리 가드(requireAdminPrincipal, ADMIN 전용)와는 별개이며, 이 헬퍼로
 * 계정 생성·권한 변경·승인·실행 분리·SUPER_ADMIN 차단 규칙을 치환하지 않는다.
 */
export function isAdminOrSuperAdmin(user: AuthorizedUser): boolean {
  return user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
}

/**
 * P1 운영 가드 통과 역할의 명시적 열거. TEACHER 제외 방식이 아니라 열거 방식이므로
 * STAFF를 추가하는 것만으로는 운영 접근이 생기지 않으며, STAFF는 deny-by-default다.
 * 계정 관리 가드(requireAdminPrincipal)는 이 집합과 별개로 ADMIN 전용을 유지한다.
 */
export const OPERATIONAL_GUARD_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

export type OperationalGuardRole = (typeof OPERATIONAL_GUARD_ROLES)[number];

export function isOperationalRole(role: UserRole): role is OperationalGuardRole {
  return (OPERATIONAL_GUARD_ROLES as readonly string[]).includes(role);
}
