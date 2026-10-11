"use server";

import { cookies, headers } from "next/headers";
import { markApplicationDepositNotified, COMPLETION_COOKIE_NAME } from "@/lib/reservation-applications/completion";
import { prisma } from "@/lib/db/prisma";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { issueCompanionInviteCore, revokeCompanionInviteCore } from "@/server/reservation-applications/groups";
import { hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_HEADER } from "@/lib/e2e/phase20-lease";

/** This only records the first guardian notification timestamp; it never changes finance or reservations. */
export async function notifyApplicationDeposit(): Promise<{ notified: boolean }> {
  const jar = await cookies();
  const submission = await currentCompletionSubmission(new Date());
  if (!submission || !await completionPreviewAllowed(submission.group?.syntheticRunId ?? null)) return { notified: false };
  return { notified: await markApplicationDepositNotified(jar.get(COMPLETION_COOKIE_NAME)?.value) };
}

async function currentCompletionSubmission(now: Date) {
  const jar = await cookies();
  const token = jar.get(COMPLETION_COOKIE_NAME)?.value;
  if (!token) return null;
  return prisma.reservationApplicationSubmission.findFirst({
    where: { completionTokenHash: hashApplicationCapabilityToken(token), completionExpiresAt: { gt: now }, personalDataPurgedAt: null },
    select: { id: true, group: { select: { syntheticRunId: true } }, applications: { select: { classSchedule: { select: { endsAt: true } } } } },
  });
}

async function completionPreviewAllowed(syntheticRunId: string | null): Promise<boolean> {
  if (process.env.VERCEL_ENV === "production" && syntheticRunId) return false;
  if (process.env.VERCEL_ENV !== "preview") return true;
  return hasActivePhase20PreviewLease(prisma, { signed: parseAndVerifySignedPreviewRun((await headers()).get(PHASE20_PREVIEW_HEADER), process.env), syntheticRunId, now: new Date() });
}

/** Completion capability can issue an opaque companion URL, without exposing another family's data. */
export async function createCompanionInvitation(): Promise<{ url?: string; error?: string }> {
  const now = new Date();
  const submission = await currentCompletionSubmission(now);
  const endsAt = submission?.applications.map((application) => application.classSchedule.endsAt).sort((a, b) => a.getTime() - b.getTime())[0];
  if (!submission || !endsAt || !await completionPreviewAllowed(submission.group?.syntheticRunId ?? null)) return { error: "동행 초대장을 만들 수 없습니다." };
  try {
    const invite = await issueCompanionInviteCore(prisma, { submissionId: submission.id, now, classEndsAt: endsAt });
    return { url: `/apply/companion/${invite.token}` };
  } catch { return { error: "동행 초대장을 만들 수 없습니다." }; }
}

/** Revocation is constrained by the issuer's short-lived completion capability. */
export async function revokeCompanionInvitation(inviteUrl: string): Promise<{ revoked: boolean }> {
  const token = inviteUrl.split("/").filter(Boolean).at(-1);
  const submission = await currentCompletionSubmission(new Date());
  if (!token || !submission || !await completionPreviewAllowed(submission.group?.syntheticRunId ?? null)) return { revoked: false };
  return { revoked: await revokeCompanionInviteCore(prisma, { inviteToken: token, issuerSubmissionId: submission.id, now: new Date() }) };
}
