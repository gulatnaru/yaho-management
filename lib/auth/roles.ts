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
 * 단순화 결정(ADR-071): 계정 관리 가드도 이와 동일한 역할 판정을 쓴다.
 * (P2 간소화: 일반 계정 변경의 승인·실행 분리 규칙은 폐지됐다.)
 */
export function isAdminOrSuperAdmin(user: AuthorizedUser): boolean {
  return user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
}

/**
 * P1 운영 가드 통과 역할의 명시적 열거. TEACHER 제외 방식이 아니라 열거 방식이므로
 * STAFF를 추가하는 것만으로는 운영 접근이 생기지 않으며, STAFF는 deny-by-default다.
 */
export const OPERATIONAL_GUARD_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

export type OperationalGuardRole = (typeof OPERATIONAL_GUARD_ROLES)[number];

export function isOperationalRole(role: UserRole): role is OperationalGuardRole {
  return (OPERATIONAL_GUARD_ROLES as readonly string[]).includes(role);
}
