"use server";
import { invitationAcceptSchema } from "@/lib/validation/accounts";
import { acceptOps } from "@/server/accounts/first-super-admin-ops";
export async function acceptAction(token: string, form: FormData): Promise<void> {
  const result = invitationAcceptSchema.parse({ password: form.get("password"), confirmPassword: form.get("confirmPassword") });
  await acceptOps(token, result.password);
}
