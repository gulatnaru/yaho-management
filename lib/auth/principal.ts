import { prisma } from "@/lib/db/prisma";
import { isOperationalRole, isUserRole, type UserRole } from "@/lib/auth/roles";

export type AdminPrincipal = PrincipalBase & {
  role: "ADMIN";
  teacherId: null;
};

export type SuperAdminPrincipal = PrincipalBase & {
  role: "SUPER_ADMIN";
  teacherId: null;
};

export type ManagerPrincipal = PrincipalBase & {
  role: "MANAGER";
  teacherId: null;
};

export type StaffPrincipal = PrincipalBase & {
  role: "STAFF";
  teacherId: null;
};

export type TeacherPrincipal = PrincipalBase & {
  role: "TEACHER";
  teacherId: string;
};

export type CurrentPrincipal =
  | SuperAdminPrincipal
  | AdminPrincipal
  | ManagerPrincipal
  | TeacherPrincipal
  | StaffPrincipal;

type PrincipalBase = {
  userId: string;
  name: string;
  email: string;
  authVersion: number;
  mustChangePassword: boolean;
};

export type SessionPrincipalIdentity = {
  userId: unknown;
  authVersion: unknown;
};

type PrincipalUserRow = {
  id: string;
  name: string;
  email: string;
  role: unknown;
  isActive: boolean;
  teacherId: string | null;
  mustChangePassword: boolean;
  authVersion: number;
  teacher: { id: string; isActive: boolean } | null;
};

export type PrincipalLookupClient = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        name: true;
        email: true;
        role: true;
        isActive: true;
        teacherId: true;
        mustChangePassword: true;
        authVersion: true;
        teacher: { select: { id: true; isActive: true } };
      };
    }): Promise<PrincipalUserRow | null>;
  };
};

const principalSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  teacherId: true,
  mustChangePassword: true,
  authVersion: true,
  teacher: { select: { id: true, isActive: true } },
} as const;

function hasValidIdentity(identity: SessionPrincipalIdentity): identity is {
  userId: string;
  authVersion: number;
} {
  return (
    typeof identity.userId === "string" &&
    identity.userId.length > 0 &&
    Number.isSafeInteger(identity.authVersion) &&
    (identity.authVersion as number) >= 1
  );
}

function toPrincipal(row: PrincipalUserRow, sessionAuthVersion: number): CurrentPrincipal | null {
  if (
    !row.isActive ||
    !isUserRole(row.role) ||
    !Number.isSafeInteger(row.authVersion) ||
    row.authVersion < 1 ||
    row.authVersion !== sessionAuthVersion
  ) {
    return null;
  }

  const base: PrincipalBase = {
    userId: row.id,
    name: row.name,
    email: row.email,
    authVersion: row.authVersion,
    mustChangePassword: row.mustChangePassword,
  };

  if (isOperationalRole(row.role)) {
    if (row.teacherId !== null || row.teacher !== null) {
      return null;
    }
    return { ...base, role: row.role, teacherId: null };
  }

  // STAFF는 로그인·본인 비밀번호 변경 경로를 위해 principal로 해석되지만,
  // 운영·ADMIN 가드에서는 거부된다 (deny-by-default). TEACHER가 아닌 행은
  // teacherId·teacher 연결이 없어야 하며, 불일치 행은 fail-closed로 null이다.
  if (row.role === "STAFF") {
    if (row.teacherId !== null || row.teacher !== null) {
      return null;
    }
    return { ...base, role: "STAFF", teacherId: null };
  }

  if (
    row.role === "TEACHER" &&
    row.teacherId &&
    row.teacher?.id === row.teacherId &&
    row.teacher.isActive
  ) {
    return { ...base, role: "TEACHER", teacherId: row.teacherId };
  }

  return null;
}

/**
 * 운영 가드 통과 principal 판정. isOperationalRole의 역할 열거를 principal 수준의
 * 타입 가드로 승격한 것으로, 가드 반환 타입을 좁히는 데 사용한다.
 */
export function isOperationalPrincipal(
  principal: CurrentPrincipal,
): principal is SuperAdminPrincipal | AdminPrincipal | ManagerPrincipal {
  return isOperationalRole(principal.role);
}

/**
 * Rehydrates authorization state from the database. Returning null is
 * intentional fail-close behavior for stale sessions and inconsistent rows.
 */
export async function resolveSessionPrincipal(
  identity: SessionPrincipalIdentity,
  client: PrincipalLookupClient = prisma as unknown as PrincipalLookupClient,
): Promise<CurrentPrincipal | null> {
  if (!hasValidIdentity(identity)) {
    return null;
  }

  const user = await client.user.findUnique({
    where: { id: identity.userId },
    select: principalSelect,
  });

  return user ? toPrincipal(user, identity.authVersion) : null;
}

export function principalHasRole<R extends UserRole>(
  principal: CurrentPrincipal,
  role: R,
): principal is Extract<CurrentPrincipal, { role: R }> {
  return principal.role === role;
}
