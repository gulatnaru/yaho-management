import { hash } from "bcryptjs";
import {
  lockAccountMutations,
  type AccountMutationLockClient,
} from "@/lib/auth/account-lock";

type BootstrapTransactionClient = AccountMutationLockClient & {
  user: {
    findFirst(args: { select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        email: string;
        name: string;
        password: string;
        role: "ADMIN";
        isActive: true;
        teacherId: null;
        mustChangePassword: false;
        authVersion: 1;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

export type BootstrapClient = {
  $transaction<T>(callback: (tx: BootstrapTransactionClient) => Promise<T>): Promise<T>;
};

type PasswordHasher = (password: string, rounds: number) => Promise<string>;

export type BootstrapAdminInput = {
  email: string;
  password: string;
};

export async function ensureBootstrapAdmin(
  client: BootstrapClient,
  input: BootstrapAdminInput,
  hashPassword: PasswordHasher = hash,
) {
  const password = await hashPassword(input.password, 12);
  return client.$transaction(async (tx) => {
    await lockAccountMutations(tx);

    const existingUser = await tx.user.findFirst({ select: { id: true } });
    if (existingUser) {
      return { created: false };
    }

    await tx.user.create({
      data: {
        email: input.email,
        name: "운영자",
        password,
        role: "ADMIN",
        isActive: true,
        teacherId: null,
        mustChangePassword: false,
        authVersion: 1,
      },
      select: { id: true },
    });

    return { created: true };
  });
}
