export type UserRole = "ADMIN" | "TEACHER";

type AuthorizedUser = { id?: string; role?: UserRole } | undefined;

export function isAdmin(user: AuthorizedUser): boolean {
  return user?.role === "ADMIN";
}
