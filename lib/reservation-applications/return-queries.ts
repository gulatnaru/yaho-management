import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { summarizeDetailLedger } from "./ledger-summary";

/** No identity, contact, consent, safety or idempotency fields belong in the return workbench. */
export const APPLICATION_RETURN_SELECT = {
  id: true, submissionId: true, applicationId: true, kind: true, amount: true,
  returnedAmount: true, resolvedAt: true, createdAt: true,
  returns: { orderBy: [{ returnedAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, returnedAt: true, createdAt: true, reason: true, processedBy: { select: { name: true } } } },
} as const satisfies Prisma.ReturnObligationSelect;
export type ApplicationReturnView = Prisma.ReturnObligationGetPayload<{ select: typeof APPLICATION_RETURN_SELECT }> & { ledgerVerified?: boolean };
/** Shared minimal facts for authoritative server-side validation, without detail PII. */
export const WORKFLOW_LEDGER_SELECT = {
  applications: { select: { id: true, status: true, quotedAmount: true, paymentMapping: { select: { id: true, paymentItem: { select: { paidAmount: true } } } } } },
  deposits: { select: { id: true, amount: true, confirmedAt: true, allocations: { select: { depositId: true, amount: true, paymentMappingId: true, returnObligationId: true } } } },
  returnObligations: { select: { id: true, amount: true, returnedAmount: true, returns: { select: { amount: true } } } },
} as const satisfies Prisma.ReservationApplicationSubmissionSelect;
const returnSelect = { ...APPLICATION_RETURN_SELECT, submission: { select: { personalDataPurgedAt: true, ...WORKFLOW_LEDGER_SELECT } } } as const;
export function redactApplicationReturn<T extends ApplicationReturnView>(record: T, purged: boolean): T {
  return { ...record, returns: record.returns.map((item) => ({ ...item, reason: purged ? null : item.reason })) };
}
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
function projectReturn(row: Prisma.ReturnObligationGetPayload<{ select: typeof returnSelect }>): ApplicationReturnView {
  const { submission, ...record } = row;
  return redactApplicationReturn({ ...record, ledgerVerified: summarizeDetailLedger(submission).state === "available" }, Boolean(submission.personalDataPurgedAt));
}
export async function listApplicationReturns() {
  await requireAdminPrincipal();
  return prisma.$transaction(async (tx) => (await tx.returnObligation.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: returnSelect })).map(projectReturn), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getApplicationReturn(id: string) {
  await requireAdminPrincipal();
  if (!idSchema.safeParse(id).success) return null;
  return prisma.$transaction(async (tx) => {
    const row = await tx.returnObligation.findUnique({ where: { id }, select: returnSelect });
    return row ? projectReturn(row) : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
