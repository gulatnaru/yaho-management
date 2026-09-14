export const USER_ROLES = ["ADMIN", "MANAGER", "TEACHER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

type AuthorizedUser = { id?: string; role?: UserRole } | undefined;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isAdmin(user: AuthorizedUser): boolean {
  return user?.role === "ADMIN";
}

export function isOperationalRole(role: UserRole): role is "ADMIN" | "MANAGER" {
  return role === "ADMIN" || role === "MANAGER";
}
