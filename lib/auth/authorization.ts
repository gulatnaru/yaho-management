import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import {
  resolveSessionPrincipal,
  type AdminPrincipal,
  type CurrentPrincipal,
  type PrincipalLookupClient,
} from "@/lib/auth/principal";

export { isAdmin } from "@/lib/auth/roles";
export type { AdminPrincipal, CurrentPrincipal, ManagerPrincipal, TeacherPrincipal } from "@/lib/auth/principal";

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

export async function requireOperationalPrincipal(): Promise<AdminPrincipal | Extract<CurrentPrincipal, { role: "MANAGER" }>> {
  const principal = await requireCurrentPrincipal();
  if (principal.role === "TEACHER") {
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
