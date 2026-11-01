import { prisma } from "@/lib/db/prisma";
import { lockAccountMutations } from "@/lib/auth/account-lock";
import { resolveAccountCutoverMode } from "@/lib/auth/cutover-mode";
import { Prisma } from "@prisma/client";
import { deliveryConfig } from "@/lib/invitations/config";
import { resendDelivery } from "@/lib/invitations/resend";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import type { AdminPrincipal } from "@/lib/auth/principal";
import { createFirstSuperAdminCore } from "./first-super-admin-core";
import { firstSuperAdminOpsEnabled } from "./first-super-admin-ops-gate";
import { bootstrapEmail, BOOTSTRAP_TEMPLATE_APPROVED } from "./first-super-admin-ops-template";
import { deliverOpsFake, opsFakeEnabled } from "./first-super-admin-ops-fake";

const core = createFirstSuperAdminCore({ enabled: firstSuperAdminOpsEnabled, approverId: () => process.env.YAHO_P7_OPS_APPROVER_USER_ID, strictPrincipal: true });
export const { prepareFirstSuperAdmin: prepareOps, revokeFirstSuperAdmin: revokeOps, acceptFirstSuperAdmin: acceptOps, executeFirstSuperAdmin: executeOps, getFirstSuperAdminAcceptanceState: getOpsAcceptanceState } = core;

async function updateAttempt(principal: AdminPrincipal, id: string, data: Prisma.BootstrapDeliveryAttemptUpdateManyMutationInput): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await lockAccountMutations(tx);
    if (!firstSuperAdminOpsEnabled() || resolveAccountCutoverMode() !== "LEGACY_ADMIN" || principal.userId !== process.env.YAHO_P7_OPS_APPROVER_USER_ID || principal.role !== "ADMIN") return false;
    const actor = await tx.user.findUnique({ where: { id: principal.userId } });
    if (!actor || actor.role !== "ADMIN" || !actor.isActive || actor.mustChangePassword || principal.mustChangePassword !== actor.mustChangePassword || actor.authVersion !== principal.authVersion) return false;
    if (await tx.bootstrapCompletion.findUnique({ where: { id: "FIRST_SUPER_ADMIN" } }) || await tx.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } })) return false;
    const expected = data.status === "SENDING" || data.status === "FAILED" && data.errorCategory === "INACTIVE" ? "PENDING" : "SENDING";
    const changed = await tx.bootstrapDeliveryAttempt.updateMany({ where: { id, status: expected }, data });
    return changed.count === 1;
  });
}

/** Issues a fresh token and a PENDING record together. The raw token never leaves this function. */
export async function issueAndDeliverOps(principal: AdminPrincipal, approvalId: string): Promise<"ACCEPTED" | "FAILED" | "UNKNOWN"> {
  const config = deliveryConfig();
  const fake = opsFakeEnabled();
  const provider = fake ? "fake" : config.kind === "resend" && BOOTSTRAP_TEMPLATE_APPROVED ? "resend" : "off";
  const token = await core.issueFirstSuperAdminToken(principal, approvalId, prisma, provider);
  const acceptance = await prisma.bootstrapAcceptance.findUniqueOrThrow({ where: { tokenHash: hashApplicationCapabilityToken(token) }, select: { id: true, targetEmail: true, expiresAt: true } });
  const attempt = await prisma.bootstrapDeliveryAttempt.findUniqueOrThrow({ where: { acceptanceId: acceptance.id } });
  if (provider === "off") {
    return await updateAttempt(principal, attempt.id, { status: "FAILED", errorCategory: "INACTIVE", completedAt: new Date() }) ? "FAILED" : "UNKNOWN";
  }
  const claimed = await updateAttempt(principal, attempt.id, { status: "SENDING", attemptedAt: new Date() });
  if (!claimed) return "UNKNOWN";
  let result: { status: "ACCEPTED"; providerMessageId: string } | { status: "FAILED" | "UNKNOWN"; errorCategory: string };
  try {
    if (provider === "fake") {
      deliverOpsFake(token);
      result = { status: "ACCEPTED", providerMessageId: "isolated-fake" };
    } else if (config.kind === "resend") {
      result = await resendDelivery(config.apiKey, config.sender, fetch, { subject: "YAHO 최초 최고관리자 등록 수락 안내", template: bootstrapEmail, namespace: "bootstrap" }).sendInvitation({ email: acceptance.targetEmail, acceptUrl: `${config.origin}/first-super-admin-ops/${encodeURIComponent(token)}`, expiresAt: acceptance.expiresAt, invitationId: acceptance.id, attemptId: attempt.id }) ?? { status: "UNKNOWN", errorCategory: "INVALID_RESPONSE" };
    } else return "UNKNOWN";
  } catch { result = { status: "UNKNOWN", errorCategory: "NETWORK" }; }
  if (result.status === "ACCEPTED" && (!/^[A-Za-z0-9_-]{1,128}$/.test(result.providerMessageId) || result.providerMessageId.includes(token))) result = { status: "UNKNOWN", errorCategory: "INVALID_RESPONSE" };
  try {
    if (!await updateAttempt(principal, attempt.id, { status: result.status, providerMessageId: result.status === "ACCEPTED" ? result.providerMessageId : null, errorCategory: result.status === "ACCEPTED" ? null : result.errorCategory, completedAt: new Date() })) return "UNKNOWN";
  } catch { return "UNKNOWN"; }
  return result.status;
}
