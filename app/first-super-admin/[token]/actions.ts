"use server";
import { invitationAcceptSchema } from "@/lib/validation/accounts";
import { acceptFirstSuperAdmin } from "@/server/accounts/first-super-admin";
export async function acceptAction(token: string, form: FormData): Promise<void> {
  const result = invitationAcceptSchema.parse({ password: form.get("password"), confirmPassword: form.get("confirmPassword") });
  await acceptFirstSuperAdmin(token, result.password);
}
