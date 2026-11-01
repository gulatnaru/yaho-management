"use server";
import { z } from "zod";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prepareOps, issueAndDeliverOps, revokeOps, executeOps } from "@/server/accounts/first-super-admin-ops";

const idSchema = z.string().min(1).max(128);

export async function prepareAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const prepared = await prepareOps(principal, { name: form.get("name"), email: form.get("email"), identityAt: form.get("identityAt") });
  await issueAndDeliverOps(principal, prepared.approvalId);
}
export async function reissueAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const id = idSchema.parse(form.get("approvalId"));
  await issueAndDeliverOps(principal, id);
}
export async function revokeAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const id = idSchema.parse(form.get("approvalId"));
  await revokeOps(principal, id);
}
export async function executeAction(form: FormData): Promise<void> {
  const principal = await requireAdminPrincipal();
  const a = idSchema.parse(form.get("approvalId")), b = idSchema.parse(form.get("acceptanceId"));
  await executeOps(principal, a, b);
}
