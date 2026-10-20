import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { APPLICATION_CONSENT_CONTENT } from "./consent-content";
import { loadConfirmedCustomerFacts } from "./last-reserved-class";
import { summarizeDetailLedger } from "./ledger-summary";
import { familyDetailHref, type ApplicationSearchParams } from "./navigation";
import { APPLICATION_DETAIL_SELECT } from "./queries";
import { computeApplicationRetention, computeConfirmedCustomerRetention } from "./retention";

const safeId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const CONSENT_HISTORY_SELECT = { id: true, consentType: true, action: true, recordedAt: true, consentVersion: true } as const;
export const WORKFLOW_APPLICATION_SELECT = {
  ...APPLICATION_DETAIL_SELECT,
  quotedAmount: true, requestedChildId: true, requestedChildPurgedAt: true,
  child: { select: { id: true, name: true, consents: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }], select: CONSENT_HISTORY_SELECT } } },
  reservation: { select: { id: true, memo: true, paymentItem: { select: { id: true, paymentId: true, refunds: { select: { id: true, amount: true, status: true, refundedAt: true }, orderBy: [{ refundedAt: "asc" }, { id: "asc" }] } } } } },
  paymentMapping: { select: { id: true, paymentItem: { select: { id: true, paymentId: true, paidAmount: true } } } },
} as const satisfies Prisma.ReservationApplicationSelect;

export function applicationReviewAnchor(applicationId: string) { return `application-${safeId.parse(applicationId)}`; }
/** Query parameters are hints only. A different family's application is never focused or read. */
export function resolveApplicationFocus(input: unknown, applicationIds: readonly string[]) {
  const parsed = safeId.safeParse(input);
  return parsed.success && applicationIds.includes(parsed.data) ? parsed.data : null;
}
export function applicationReviewHref(submissionId: string, applicationId: string, context: ApplicationSearchParams = {}) {
  const base = familyDetailHref("submission", submissionId, context);
  const query = new URLSearchParams(base.split("?")[1]);
  query.set("applicationId", safeId.parse(applicationId));
  return `${base.split("?")[0]}?${query}#${applicationReviewAnchor(applicationId)}`;
}

/** ADMIN-only detail boundary. All reads, including candidates/retention, share a snapshot.
 * No other Submission is found or merged by guardian identity. */
export async function getApplicationWorkflowDetail(id: string, applicationId?: unknown) {
  await requireAdminPrincipal();
  const parsed = safeId.safeParse(id);
  if (!parsed.success) return null;
  return prisma.$transaction(async (tx) => {
    const submission = await tx.reservationApplicationSubmission.findUnique({ where: { id: parsed.data }, select: {
      id: true, guardianName: true, guardianPhone: true, guardianRelationship: true, declaredPayerName: true,
      submittedAt: true, depositNotifiedAt: true, personalDataPurgedAt: true,
      applications: { orderBy: [{ submittedAt: "asc" }, { id: "asc" }], select: WORKFLOW_APPLICATION_SELECT },
      deposits: { orderBy: [{ confirmedAt: "asc" }, { id: "asc" }], select: {
        id: true, amount: true, payerName: true, depositedAt: true, confirmedAt: true, confirmedBy: { select: { name: true } },
        allocations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, depositId: true, amount: true, paymentMappingId: true, returnObligationId: true, createdAt: true } },
      } },
      returnObligations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: {
        id: true, applicationId: true, kind: true, amount: true, returnedAmount: true, resolvedAt: true, createdAt: true,
        returns: { orderBy: [{ returnedAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, returnedAt: true, createdAt: true, reason: true, processedBy: { select: { name: true } } } },
      } },
    } });
    if (!submission) return null;
    // Preserve the exact existing confirmation candidate policy. Read-only review candidates
    // are projected separately below and never create a new confirmation choice/default.
    const identities = submission.personalDataPurgedAt || !submission.guardianName || !submission.guardianPhone ? [] : submission.applications.filter((row) => !row.personalDataPurgedAt && row.childName && row.childBirthDate && row.childGender);
    const childIds = submission.applications.flatMap((row) => row.status === "CONFIRMED" && row.childId ? [row.childId] : []);
    const [candidates, retentionFacts] = await Promise.all([
      identities.length ? tx.child.findMany({ where: { isActive: true, personalDataPurgedAt: null, guardianName: submission.guardianName!, guardianPhone: submission.guardianPhone!, OR: identities.map((row) => ({ name: row.childName!, birthDate: row.childBirthDate!, gender: row.childGender! })) }, select: { id: true, name: true, birthDate: true, gender: true }, orderBy: { id: "asc" } }) : [],
      loadConfirmedCustomerFacts(tx, { now: new Date(), childIds, includePurged: true }),
    ]);
    const applications = submission.applications.map((row) => {
      const purged = Boolean(submission.personalDataPurgedAt || row.personalDataPurgedAt);
      const matching = purged ? [] : candidates.filter((child) => child.name === row.childName && child.birthDate?.getTime() === row.childBirthDate?.getTime() && child.gender === row.childGender);
      const fact = retentionFacts.find((item) => item.id === row.childId);
      const retention = row.status === "CONFIRMED" && row.childId ? computeConfirmedCustomerRetention({ lastReservedClassAt: fact?.lastReservedClassAt ?? null, fallbackClassAt: fact?.latestConfirmedClassAt ?? row.classSchedule.startsAt })! : computeApplicationRetention({ status: row.status, classStartsAt: row.classSchedule.startsAt, lastReservedClassAt: null });
      return { ...row,
        // Defensive masking uses the existing purge state; it never repairs stored records.
        childName: purged ? null : row.childName, childBirthDate: purged ? null : row.childBirthDate,
        childGender: purged ? null : row.childGender, requestNote: purged ? null : row.requestNote,
        resolutionNote: purged ? null : row.resolutionNote,
        isPurged: purged, retention,
        consentOriginal: row.consentVersion === APPLICATION_CONSENT_CONTENT.version ? APPLICATION_CONSENT_CONTENT : null,
        consentHistory: purged ? null : row.child?.consents ?? null,
        reviewCandidates: matching.map((child) => ({ id: child.id, name: child.name, birthDate: child.birthDate, gender: child.gender, isRequested: child.id === row.requestedChildId })),
        confirmationCandidates: row.status === "SUBMITTED" ? matching.map((child) => ({ id: child.id, label: `${child.name} · ${child.gender} · 기존 아이`, isRequested: child.id === row.requestedChildId })) : [],
      };
    });
    return { kind: "submission" as const, ...submission, applications,
      ledger: summarizeDetailLedger(submission),
      focusedApplicationId: resolveApplicationFocus(applicationId, applications.map((row) => row.id)),
      invalidApplicationFocus: applicationId !== undefined && !resolveApplicationFocus(applicationId, applications.map((row) => row.id)),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export type ApplicationWorkflowDetail = NonNullable<Awaited<ReturnType<typeof getApplicationWorkflowDetail>>>;
export type ApplicationReview = ApplicationWorkflowDetail["applications"][number];
