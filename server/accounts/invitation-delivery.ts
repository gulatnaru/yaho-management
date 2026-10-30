import { prisma } from "@/lib/db/prisma";
import { deliveryConfig } from "@/lib/invitations/config";
import type { InvitationDelivery } from "@/lib/invitations/delivery";
import { resendDelivery } from "@/lib/invitations/resend";
import type { IssueInvitationResult } from "./invitations";

/** Called only after issuance committed. Never retry a SENDING attempt: its outcome may be unknown. */
export async function deliverIssuedInvitation(issued: IssueInvitationResult, override?: InvitationDelivery) {
  const config = deliveryConfig();
  const invitation = await prisma.adminInvitation.findUniqueOrThrow({ where: { id: issued.invitationId }, select: { email: true, expiresAt: true } });
  let attempt;
  try {
    attempt = await prisma.invitationDeliveryAttempt.create({ data: { invitationId: issued.invitationId, provider: config.kind, status: "PENDING" } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return "UNKNOWN" as const;
    throw error;
  }
  if (config.kind === "off") {
    await prisma.invitationDeliveryAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCategory: "INACTIVE", completedAt: new Date() } });
    return "FAILED" as const;
  }
  const claimed = await prisma.invitationDeliveryAttempt.updateMany({ where: { id: attempt.id, status: "PENDING" }, data: { status: "SENDING", attemptedAt: new Date() } });
  if (claimed.count !== 1) return "UNKNOWN" as const;
  const adapter = (config.kind === "fake" ? override : undefined) ?? (config.kind === "resend" ? resendDelivery(config.apiKey, config.sender) : { async sendInvitation() { return process.env.YAHO_P4_FAKE_RESULT === "accepted" ? { status: "ACCEPTED" as const, providerMessageId: "fake-message" } : { status: "FAILED" as const, errorCategory: "FAKE_FAILURE" }; } });
  let result;
  try {
    result = await adapter.sendInvitation({ email: invitation.email, acceptUrl: `${config.origin}/invite/${encodeURIComponent(issued.token)}`, expiresAt: invitation.expiresAt, invitationId: issued.invitationId, attemptId: attempt.id });
  } catch { result = { status: "UNKNOWN" as const, errorCategory: "NETWORK" }; }
  result ??= { status: "UNKNOWN" as const, errorCategory: "INVALID_RESPONSE" };
  try {
    await prisma.invitationDeliveryAttempt.update({ where: { id: attempt.id }, data: { status: result.status, providerMessageId: result.status === "ACCEPTED" ? result.providerMessageId : null, errorCategory: result.status === "ACCEPTED" ? null : result.errorCategory, completedAt: new Date() } });
  } catch {
    // A result-record failure leaves SENDING. Never resend its raw token.
    return "UNKNOWN" as const;
  }
  return result.status;
}
