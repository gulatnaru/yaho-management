import { compare } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { credentialsSchema } from "@/lib/validation/auth";

export type CredentialsInput = ReturnType<typeof credentialsSchema.parse>;

export async function authenticateOperator({ email, password }: CredentialsInput) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user?.isActive || !user.password) {
    return null;
  }

  const passwordMatches = await compare(password, user.password);
  if (!passwordMatches) {
    return null;
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
