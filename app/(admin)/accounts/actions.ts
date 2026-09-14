"use server";

import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import {
  accountCreateSchema,
  accountUpdateSchema,
  adminPasswordResetSchema,
  type AccountCreateInput,
  type AccountUpdateInput,
} from "@/lib/validation/accounts";
import {
  AccountMutationError,
  createAccountCore,
  resetAccountPasswordCore,
  updateAccountCore,
} from "@/server/accounts/mutations";

export type AccountFormValues = {
  name?: string;
  email?: string;
  role?: string;
  teacherId?: string;
  isActive?: boolean;
};

export type AccountFormState = {
  errors?: Partial<Record<keyof AccountCreateInput | keyof AccountUpdateInput, string[]>>;
  formError?: string;
  values?: AccountFormValues;
};

export type PasswordResetState = {
  errors?: { temporaryPassword?: string[] };
  formError?: string;
  success?: boolean;
};

function readAccountValues(formData: FormData): AccountFormValues {
  const stringValue = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };

  return {
    name: stringValue("name"),
    email: stringValue("email"),
    role: stringValue("role"),
    teacherId: stringValue("teacherId"),
    isActive: formData.get("isActive") === "on",
  };
}

function parseAccountPayload(formData: FormData) {
  const values = readAccountValues(formData);
  return {
    ...values,
    teacherId: values.teacherId || null,
  };
}

function accountMutationMessage(error: AccountMutationError): string {
  switch (error.code) {
    case "ACCOUNT_NOT_FOUND":
      return "계정을 찾을 수 없습니다.";
    case "SELF_DEACTIVATION":
      return "본인 계정은 비활성화할 수 없습니다.";
    case "SELF_ROLE_CHANGE":
      return "본인의 관리자 역할은 변경할 수 없습니다.";
    case "LAST_ACTIVE_ADMIN":
      return "마지막 활성 관리자는 비활성화하거나 역할을 변경할 수 없습니다.";
    case "TEACHER_REQUIRED":
      return "선생님 계정에 연결할 선생님을 선택해주세요.";
    case "TEACHER_NOT_AVAILABLE":
      return "선택한 선생님을 계정에 연결할 수 없습니다. 활성 상태와 기존 연결을 확인해주세요.";
    case "ACTOR_NOT_ADMIN":
      return "계정 관리 권한을 다시 확인해주세요.";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createAccount(
  _previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const principal = await requireAdminPrincipal();
  const values = readAccountValues(formData);
  const result = accountCreateSchema.safeParse({
    ...parseAccountPayload(formData),
    temporaryPassword: formData.get("temporaryPassword"),
  });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values };
  }

  let createdId: string;
  try {
    const passwordHash = await hash(result.data.temporaryPassword, 12);
    const created = await createAccountCore(principal, {
      name: result.data.name,
      email: result.data.email,
      role: result.data.role,
      teacherId: result.data.teacherId,
      isActive: result.data.isActive,
      passwordHash,
    });
    createdId = created.id;
  } catch (error) {
    if (error instanceof AccountMutationError) {
      return { formError: accountMutationMessage(error), values };
    }
    if (isUniqueConstraintError(error)) {
      return { formError: "이미 사용 중인 이메일이거나 선생님 계정이 연결되어 있습니다.", values };
    }
    console.error("[accounts] failed to create account");
    return { formError: "계정 생성에 실패했습니다. 다시 시도해주세요.", values };
  }

  revalidatePath("/accounts");
  redirect(`/accounts/${createdId}`);
}

export async function updateAccount(
  id: string,
  _previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const principal = await requireAdminPrincipal();
  const values = readAccountValues(formData);
  const result = accountUpdateSchema.safeParse(parseAccountPayload(formData));

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors, values };
  }

  try {
    await updateAccountCore(principal, id, result.data);
  } catch (error) {
    if (error instanceof AccountMutationError) {
      return { formError: accountMutationMessage(error), values };
    }
    if (isUniqueConstraintError(error)) {
      return { formError: "이미 사용 중인 이메일이거나 선생님 계정이 연결되어 있습니다.", values };
    }
    console.error("[accounts] failed to update account");
    return { formError: "계정 수정에 실패했습니다. 다시 시도해주세요.", values };
  }

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  redirect(`/accounts/${id}`);
}

export async function resetAccountPassword(
  id: string,
  _previousState: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const principal = await requireAdminPrincipal();
  const result = adminPasswordResetSchema.safeParse({ temporaryPassword: formData.get("temporaryPassword") });

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  try {
    const passwordHash = await hash(result.data.temporaryPassword, 12);
    await resetAccountPasswordCore(principal, id, passwordHash);
  } catch (error) {
    if (error instanceof AccountMutationError) {
      return { formError: accountMutationMessage(error) };
    }
    console.error("[accounts] failed to reset password");
    return { formError: "비밀번호 재설정에 실패했습니다. 다시 시도해주세요." };
  }

  revalidatePath(`/accounts/${id}`);
  return { success: true };
}
