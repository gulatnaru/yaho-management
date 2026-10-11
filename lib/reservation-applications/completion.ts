import { prisma } from "@/lib/db/prisma";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";

export const COMPLETION_COOKIE_NAME = "yaho_application_completion";
export const COMPLETION_TTL_MS = 30 * 60 * 1000;

export type ApplicationCompletionView = {
  submissionId: string;
  declaredPayerName: string | null;
  syntheticRunId: string | null;
  syntheticSettings: unknown;
  applications: Array<{ id: string; childName: string | null; quotedAmount: number }>;
};

/** Only a valid short-lived completion capability may obtain the submitting family's transfer guide. */
export async function loadApplicationCompletionView(token: string | undefined, now = new Date()): Promise<ApplicationCompletionView | null> {
  if (!token) return null;
  const submission = await prisma.reservationApplicationSubmission.findFirst({
    where: { completionTokenHash: hashApplicationCapabilityToken(token), completionExpiresAt: { gt: now }, personalDataPurgedAt: null },
    select: { id: true, declaredPayerName: true, group: { select: { syntheticRunId: true, syntheticSettings: true } }, applications: { select: { id: true, childName: true, quotedAmount: true, status: true } } },
  });
  if (!submission) return null;
  return {
    submissionId: submission.id,
    declaredPayerName: submission.declaredPayerName,
    syntheticRunId: submission.group?.syntheticRunId ?? null,
    syntheticSettings: submission.group?.syntheticSettings ?? null,
    applications: submission.applications.filter((application) => application.status === "SUBMITTED" && application.quotedAmount !== null).map((application) => ({ id: application.id, childName: application.childName, quotedAmount: application.quotedAmount! })),
  };
}

/** A Phase 20 guide is capability-only. Synthetic fixtures are never visible in Production. */
export function canShowApplicationCompletionGuide({
  completion,
  vercelEnv,
  previewAllowed,
}: {
  completion: ApplicationCompletionView | null;
  vercelEnv: string | undefined;
  previewAllowed: boolean;
}): boolean {
  if (!completion || completion.applications.length === 0) return false;
  if (vercelEnv === "production" && completion.syntheticRunId) return false;
  return vercelEnv !== "preview" || previewAllowed;
}

/** Generic bank guidance remains only for ordinary non-Preview legacy visits without a completion capability. */
export function canShowGenericApplicationCompletionGuide({
  completion,
  vercelEnv,
}: {
  completion: ApplicationCompletionView | null;
  vercelEnv: string | undefined;
}): boolean {
  return completion === null && vercelEnv !== "preview";
}

/** The guardian notification is intentionally idempotent and does not create a financial record. */
export async function markApplicationDepositNotified(
  token: string | undefined,
  now = new Date(),
  client: Pick<typeof prisma, "reservationApplicationSubmission"> = prisma,
): Promise<boolean> {
  if (!token) return false;
  const eligible = {
    completionTokenHash: hashApplicationCapabilityToken(token),
    completionExpiresAt: { gt: now },
    personalDataPurgedAt: null,
    applications: { some: { status: "SUBMITTED" as const, quotedAmount: { not: null } } },
  };
  const result = await client.reservationApplicationSubmission.updateMany({
    where: { ...eligible, depositNotifiedAt: null },
    data: { depositNotifiedAt: now },
  });
  if (result.count === 1) return true;
  // A second click is an eligible success without another write. Terminal,
  // purged, expired and unknown capabilities cannot satisfy this predicate.
  return Boolean(await client.reservationApplicationSubmission.findFirst({
    where: { ...eligible, depositNotifiedAt: { not: null } },
    select: { id: true },
  }));
}
