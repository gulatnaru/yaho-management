import { compare } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { isOperationalRole, isUserRole } from "@/lib/auth/roles";
import { credentialsSchema } from "@/lib/validation/auth";

// bcrypt cost 12로 미리 생성한 고정 dummy hash다. 존재하지 않거나 password가 없는
// 계정도 실제 credential 검증과 같은 bcrypt work를 한 번 수행하되 성공할 수는 없다.
export const INVALID_CREDENTIAL_PASSWORD_HASH =
  "$2a$12$kfqC442cBAgoJFeIkCnaOuY44AYOb.aJ/0skM1ykHLFc0.0/1oew2";

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

  const passwordHash = user?.password ?? INVALID_CREDENTIAL_PASSWORD_HASH;
  const passwordMatches = await comparePassword(password, passwordHash);

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
