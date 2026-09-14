"use server";

import { signOut } from "@/auth";
import { requirePasswordChangePrincipal } from "@/lib/auth/authorization";
import { changeOwnPasswordSchema } from "@/lib/validation/auth";
import {
  changeOwnPasswordCore,
  CurrentPasswordInvalidError,
  PasswordChangeSessionInvalidError,
} from "@/server/auth/change-password";

export type ChangePasswordState = {
  error?: string;
  errors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string[]>>;
};

export async function changeOwnPasswordAction(
  _: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changeOwnPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const principal = await requirePasswordChangePrincipal();

  try {
    await changeOwnPasswordCore(principal, parsed.data);
  } catch (error) {
    if (error instanceof CurrentPasswordInvalidError) {
      return { errors: { currentPassword: ["현재 비밀번호가 올바르지 않습니다."] } };
    }
    if (error instanceof PasswordChangeSessionInvalidError) {
      await signOut({ redirectTo: "/login" });
      return {};
    }
    return { error: "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  await signOut({ redirectTo: "/login" });
  return {};
}
