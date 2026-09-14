import { compare } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { isOperationalRole, isUserRole } from "@/lib/auth/roles";
import { credentialsSchema } from "@/lib/validation/auth";

export type CredentialsInput = ReturnType<typeof credentialsSchema.parse>;

type CredentialUser = {
  id: string;
  name: string;
  email: string;
  password: string | null;
  role: unknown;
  isActive: boolean;
  teacherId: string | null;
  authVersion: number;
  teacher: { id: string; isActive: boolean } | null;
};

export type CredentialLookupClient = {
  user: {
    findUnique(args: {
      where: { email: string };
      select: {
        id: true;
        name: true;
        email: true;
        password: true;
        role: true;
        isActive: true;
        teacherId: true;
        authVersion: true;
        teacher: { select: { id: true; isActive: true } };
      };
    }): Promise<CredentialUser | null>;
  };
};

export async function authenticateOperator(
  { email, password }: CredentialsInput,
  client: CredentialLookupClient = prisma as unknown as CredentialLookupClient,
  comparePassword: (password: string, hash: string) => Promise<boolean> = compare,
) {
  const user = await client.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      isActive: true,
      teacherId: true,
      authVersion: true,
      teacher: { select: { id: true, isActive: true } },
    },
  });

  if (
    !user?.isActive ||
    !user.password ||
    !isUserRole(user.role) ||
    !Number.isSafeInteger(user.authVersion) ||
    user.authVersion < 1
  ) {
    return null;
  }

  if (isOperationalRole(user.role) && user.teacherId !== null) {
    return null;
  }

  if (
    user.role === "TEACHER" &&
    (!user.teacherId || user.teacher?.id !== user.teacherId || !user.teacher.isActive)
  ) {
    return null;
  }

  const passwordMatches = await comparePassword(password, user.password);
  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    authVersion: user.authVersion,
  };
}
