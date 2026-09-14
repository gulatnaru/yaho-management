import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import {
  lockAccountMutations,
  type AccountMutationLockClient,
} from "@/lib/auth/account-lock";
import { isOperationalRole, isUserRole } from "@/lib/auth/roles";
import type { CurrentPrincipal } from "@/lib/auth/principal";
import type { ChangeOwnPasswordInput } from "@/lib/validation/auth";

type PasswordUserRow = {
  id: string;
  password: string | null;
  role: unknown;
  isActive: boolean;
  teacherId: string | null;
  authVersion: number;
  teacherIsActive: boolean | null;
};

type PasswordChangeTransaction = AccountMutationLockClient & {
  user: {
    update(args: {
      where: { id: string };
      data: {
        password: string;
        mustChangePassword: false;
        authVersion: { increment: 1 };
      };
      select: { authVersion: true };
    }): Promise<{ authVersion: number }>;
  };
};

export type PasswordChangeClient = {
  $transaction<T>(callback: (transaction: PasswordChangeTransaction) => Promise<T>): Promise<T>;
};

type PasswordFunctions = {
  comparePassword(password: string, hash: string): Promise<boolean>;
  hashPassword(password: string, rounds: number): Promise<string>;
};

const defaultPasswordFunctions: PasswordFunctions = {
  comparePassword: compare,
  hashPassword: hash,
};

export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super("CURRENT_PASSWORD_INVALID");
    this.name = "CurrentPasswordInvalidError";
  }
}

export class PasswordChangeSessionInvalidError extends Error {
  constructor() {
    super("PASSWORD_CHANGE_SESSION_INVALID");
    this.name = "PasswordChangeSessionInvalidError";
  }
}

function isLivePasswordRow(row: PasswordUserRow, principal: CurrentPrincipal): boolean {
  if (
    row.id !== principal.userId ||
    !row.isActive ||
    !isUserRole(row.role) ||
    row.role !== principal.role ||
    row.authVersion !== principal.authVersion
  ) {
    return false;
  }

  if (isOperationalRole(row.role)) {
    return row.teacherId === null;
  }

  return Boolean(
    row.role === "TEACHER" &&
      row.teacherId &&
      row.teacherId === principal.teacherId &&
      row.teacherIsActive,
  );
}

/**
 * Changes a password under the same advisory lock used by ADMIN account
 * mutations. If a reset wins the race, the stale session version is rejected
 * and cannot overwrite the reset credential.
 */
export async function changeOwnPasswordCore(
  principal: CurrentPrincipal,
  input: ChangeOwnPasswordInput,
  client: PasswordChangeClient = prisma as unknown as PasswordChangeClient,
  passwordFunctions: PasswordFunctions = defaultPasswordFunctions,
): Promise<{ authVersion: number }> {
  const nextPasswordHash = await passwordFunctions.hashPassword(input.newPassword, 12);

  return client.$transaction(async (transaction) => {
    await lockAccountMutations(transaction);

    const users = await transaction.$queryRaw<PasswordUserRow[]>`
      SELECT
        u."id",
        u."password",
        u."role",
        u."isActive",
        u."teacherId",
        u."authVersion",
        t."isActive" AS "teacherIsActive"
      FROM "User" u
      LEFT JOIN "Teacher" t ON t."id" = u."teacherId"
      WHERE u."id" = ${principal.userId}
      FOR UPDATE OF u
    `;
    const user = users[0];

    if (!user || !isLivePasswordRow(user, principal)) {
      throw new PasswordChangeSessionInvalidError();
    }

    if (!user.password || !(await passwordFunctions.comparePassword(input.currentPassword, user.password))) {
      throw new CurrentPasswordInvalidError();
    }

    return transaction.user.update({
      where: { id: principal.userId },
      data: {
        password: nextPasswordHash,
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
      select: { authVersion: true },
    });
  });
}
