import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";
import { prisma } from "@/lib/db/prisma";

export function firstSuperAdminOpsEnabled(): boolean {
  return process.env.YAHO_P7_OPS_ENABLED === "1" && !!process.env.YAHO_P7_OPS_APPROVER_USER_ID;
}

/** Page guard; all mutations recheck under the account advisory lock. */
export async function firstSuperAdminOpsPageAvailable(): Promise<boolean> {
  if (!firstSuperAdminOpsEnabled() || resolveAccountCutoverMode() !== "LEGACY_ADMIN") return false;
  const [completion, superAdmin] = await Promise.all([
    prisma.bootstrapCompletion.findUnique({ where: { id: "FIRST_SUPER_ADMIN" }, select: { id: true } }),
    prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } }),
  ]);
  return !completion && !superAdmin;
}
