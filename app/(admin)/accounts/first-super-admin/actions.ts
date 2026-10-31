"use server";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prepareFirstSuperAdmin, issueFirstSuperAdminToken, revokeFirstSuperAdmin, executeFirstSuperAdmin } from "@/server/accounts/first-super-admin";
import { fakeDeliverFirstSuperAdminToken } from "@/server/accounts/first-super-admin-fake-delivery";

export async function prepareAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const prepared = await prepareFirstSuperAdmin(principal, { name: form.get("name"), email: form.get("email"), identityAt: form.get("identityAt") });
  fakeDeliverFirstSuperAdminToken(await issueFirstSuperAdminToken(principal, prepared.approvalId));
}
export async function reissueAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const id = form.get("approvalId"); if (typeof id !== "string") throw new Error("Invalid request");
  fakeDeliverFirstSuperAdminToken(await issueFirstSuperAdminToken(principal, id));
}
export async function revokeAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const id = form.get("approvalId"); if (typeof id !== "string") throw new Error("Invalid request");
  await revokeFirstSuperAdmin(principal, id);
}
export async function executeAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const a = form.get("approvalId"), b = form.get("acceptanceId");
  if (typeof a !== "string" || typeof b !== "string") throw new Error("Invalid request");
  await executeFirstSuperAdmin(principal, a, b);
}
