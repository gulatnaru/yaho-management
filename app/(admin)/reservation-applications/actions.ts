"use server";

import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { getApplicationReturn, listApplicationReturns, WORKFLOW_LEDGER_SELECT } from "@/lib/reservation-applications/return-queries";
import { z } from "zod";
import { summarizeDetailLedger } from "@/lib/reservation-applications/ledger-summary";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { ChildPersonalDataPurgedError } from "@/lib/children/errors";
import { prisma } from "@/lib/db/prisma";
import { readFormString } from "@/lib/forms/form-data";
import { NEW_CHILD_CHOICE } from "@/lib/reservation-applications/constants";
import {
  ApplicationDepositNotConfirmedError,
  ApplicationLinkClassClosedError,
  ApplicationLinkNotFoundError,
  ApplicationNotFoundError,
  ApplicationNotPendingError,
  classifyInfrastructureError,
  describeErrorForLog,
} from "@/lib/reservation-applications/errors";
import {
  ChildNotActiveError,
  ChildNotFoundError,
  ClassNotFoundError,
  ClassNotScheduledError,
  DuplicateReservationError,
  OverbookingConfirmationRequiredError,
  TerminalReservationError,
} from "@/lib/reservations/errors";
import {
  applicationConfirmSchema,
  applicationResolutionSchema,
} from "@/lib/validation/reservation-application";
import { confirmReservationApplicationCore } from "@/server/reservation-applications/confirm";
import { issueApplicationLinkCore, stopApplicationLinkCore, upgradeLegacyApplicationLinkCore } from "@/server/reservation-applications/links";
import { classLinkOperationSchema, issueClassLinkOperationCore, LinkOperationConflictError, LinkRevisionConflictError, LinkSettingsNotReadyError, type ClassLinkReceipt, updateApplicationGroupCore } from "@/server/reservation-applications/groups";
import { reservationApplicationSettingsSchema, groupCreateSchema, submissionConfirmationSchema } from "@/lib/reservation-applications/phase20-validation";
import { getReservationApplicationSettings, importLegacyReservationApplicationSettingsCore, isReservationApplicationSettingsReady, saveReservationApplicationSettingsCore } from "@/server/reservation-applications/settings";
import { ApplicationPaymentAlreadyExistsError, InsufficientApplicationDepositError, ApplicationReturnAmountExceededError, ApplicationSubmissionOverbookingConfirmationError, SuspectedDuplicateApplicationDepositError, closeApplicationWithReturnCore, confirmApplicationSubmissionCore, recordApplicationDepositCore, recordApplicationReturnCore } from "@/server/reservation-applications/finance";
import { depositInputSchema, returnInputSchema } from "@/lib/reservation-applications/phase20-validation";
import {
  closeReservationApplicationCore,
  confirmApplicationDepositCore,
  type ApplicationClosingStatus,
} from "@/server/reservation-applications/resolve";
import {
  purgeExpiredPersonalDataCore,
  type PersonalDataPurgeResult,
} from "@/server/reservation-applications/retention";

/**
 * 예약 신청 관리 action 은 모두 ADMIN 전용이다(ADR-053). 입금 확인은 재무정보라 MANAGER 에게 허용하지 않는다.
 * 각 action 이 requireAdminPrincipal() 을 먼저 호출해 MANAGER/TEACHER 의 직접 호출을 차단한다.
 */

export type ApplicationActionResult = { error?: string };

/** Preview-only group marking remains ADMIN-only under ADR-053, matching the hosting page. */
export async function markGroupManualTestSession(groupId: string): Promise<{ error?: string; runId?: string }> {
  await requireAdminPrincipal();
  if (process.env.VERCEL_ENV !== "preview") return { error: "Preview 환경에서만 사용할 수 있습니다." };
  const parsed = z.string().trim().min(1).safeParse(groupId);
  if (!parsed.success) return { error: "잘못된 요청입니다." };
  const group = await prisma.reservationApplicationGroup.findUnique({ where: { id: parsed.data }, select: { id: true, syntheticRunId: true, isActive: true } });
  if (!group) return { error: "그룹을 찾을 수 없습니다." };
  if (group.syntheticRunId) return { error: "이미 테스트 세션으로 지정된 그룹입니다." };
  const settings = await getReservationApplicationSettings(prisma);
  const checked = reservationApplicationSettingsSchema.safeParse(settings);
  if (!checked.success || !isReservationApplicationSettingsReady(settings)) return { error: "예약 신청 설정을 먼저 완료해주세요." };
  const runId = `manual-${randomBytes(17).toString("base64url").slice(0, 22)}`;
  const updated = await prisma.reservationApplicationGroup.updateMany({
    where: { id: group.id, syntheticRunId: null },
    data: { syntheticRunId: runId, syntheticSettings: checked.data },
  });
  if (updated.count !== 1) return { error: "이미 테스트 세션으로 지정된 그룹입니다." };
  return { runId };
}

/** Phase 20 group creation is ADMIN-only and uses the schedule's explicit applicationPrice. */
export async function createApplicationGroup(_formData: FormData): Promise<{ error?: string; groupId?: string }> {
  await requireAdminPrincipal();
  void _formData;
  return { error: "그룹과 첫 링크를 함께 발급하도록 새 화면을 다시 불러와 주세요." };
}

export async function issueApplicationGroupLink(_groupId: string): Promise<{ error?: string; token?: string }> {
  await requireAdminPrincipal();
  void _groupId;
  return { error: "링크 작업과 현재 범위를 확인하도록 화면을 다시 불러와 주세요." };
}

/** Membership edits affect only future submissions. Existing submitted quotes remain immutable. */
export async function updateApplicationGroup(groupId: string, formData: FormData): Promise<{ error?: string }> {
  await requireAdminPrincipal();
  const parsed = groupCreateSchema.safeParse({ classScheduleIds: formData.getAll("classScheduleId") });
  if (!parsed.success) return { error: "하나 이상의 중복되지 않은 클래스를 선택해주세요." };
  try {
    const revision = z.string().regex(/^[a-f0-9]{64}$/).safeParse(formData.get("revision"));
    if (!revision.success) return { error: "구성 정보를 다시 불러와 주세요." };
    await updateApplicationGroupCore(prisma, { groupId, classScheduleIds: parsed.data.classScheduleIds, now: new Date(), revision: revision.data });
    revalidatePath("/classes", "layout");
    revalidatePath(`/reservation-applications/groups/${groupId}`);
    revalidatePath("/reservation-applications/groups");
    return {};
  } catch (error) {
    console.error("[reservation-applications] failed to update group:", describeErrorForLog(error));
    return { error: "가격이 설정된 미래 예정 클래스만 그룹에 넣을 수 있습니다." };
  }
}

/** Stopping a group invalidates every issued group capability. */
export async function stopApplicationGroup(_groupId: string): Promise<{ error?: string }> {
  await requireAdminPrincipal();
  void _groupId;
  return { error: "중지할 클래스 범위와 현재 상태를 확인하도록 화면을 다시 불러와 주세요." };
}

export async function saveReservationApplicationSettings(formData: FormData): Promise<ApplicationActionResult> {
  const principal = await requireAdminPrincipal();
  const parsed = reservationApplicationSettingsSchema.safeParse({
    bankName: formData.get("bankName"), accountNumber: formData.get("accountNumber"), accountHolder: formData.get("accountHolder"),
    blogUrl: formData.get("blogUrl"), instagramUrl: formData.get("instagramUrl"), kakaoChannelUrl: formData.get("kakaoChannelUrl"),
  });
  if (!parsed.success) return { error: "은행 정보와 HTTPS 채널 주소를 모두 입력해주세요." };
  try {
    await saveReservationApplicationSettingsCore(prisma, { values: parsed.data, actorUserId: principal.userId });
    revalidatePath("/reservation-applications/settings");
    return {};
  } catch (error) {
    console.error("[reservation-applications] failed to save settings:", describeErrorForLog(error));
    return { error: "운영 설정을 저장하지 못했습니다." };
  }
}

export async function importLegacyReservationApplicationSettings(): Promise<ApplicationActionResult> {
  const principal = await requireAdminPrincipal();
  try {
    const imported = await importLegacyReservationApplicationSettingsCore(prisma, { actorUserId: principal.userId });
    revalidatePath("/reservation-applications/settings");
    return imported ? {} : { error: "가져올 수 있는 기존 설정이 없거나 이미 데이터베이스 설정이 있습니다." };
  } catch (error) {
    console.error("[reservation-applications] failed to import legacy settings:", describeErrorForLog(error));
    return { error: "기존 설정을 가져오지 못했습니다." };
  }
}

export type WorkflowActionResult = {
  status: "success" | "failure" | "result-unknown";
  error?: string;
  errors?: Record<string, string[]>;
  code?: "not-found" | "suspected-duplicate-deposit";
  receiptId?: string;
  submissionId?: string;
  applicationIds?: string[];
  reservationIds?: string[];
  paymentId?: string;
  verified?: boolean;
};
const workflowId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const transactionKey = z.string().trim().min(16).max(200);
class WorkflowConflict extends Error {}
class WorkflowLedgerUnavailable extends Error {}
async function assertWorkflowLedger(tx: Prisma.TransactionClient, submissionId: string) {
  const records = await tx.reservationApplicationSubmission.findUnique({ where: { id: submissionId }, select: WORKFLOW_LEDGER_SELECT });
  if (!records || summarizeDetailLedger(records).state !== "available") throw new WorkflowLedgerUnavailable();
}

/** Join an existing transaction without changing the finance cores or their lock order. */
function financeInTransaction(tx: Prisma.TransactionClient) {
  return { $transaction: async (callback: (value: Prisma.TransactionClient) => Promise<unknown>) => callback(tx) } as Pick<PrismaClient, "$transaction">;
}
async function lockWorkflowSubmission(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length !== 1) throw new WorkflowConflict();
}
function invalidateWorkflow(submissionId: string) {
  revalidatePath(`/reservation-applications/submissions/${submissionId}`);
  revalidatePath("/reservation-applications");
  revalidatePath("/reservation-applications/returns");
}
export async function refreshApplicationWorkflow(submissionId: string) {
  await requireAdminPrincipal();
  if (!workflowId.safeParse(submissionId).success) return null;
  try { return await getApplicationWorkflowDetail(submissionId); } catch { return null; }
}
export async function refreshApplicationReturn(obligationId: string) {
  await requireAdminPrincipal();
  if (!workflowId.safeParse(obligationId).success) return null;
  try { return await getApplicationReturn(obligationId); } catch { return null; }
}
export async function refreshApplicationReturns() {
  await requireAdminPrincipal();
  try { return await listApplicationReturns(); } catch { return null; }
}

/** Receipt lookup is read-only. An unclear financial request is never replayed here. */
export async function lookupWorkflowReceipt(kind: "deposit" | "return", targetId: string, key: string, formData?: FormData): Promise<WorkflowActionResult> {
  await requireAdminPrincipal();
  if (!z.enum(["deposit", "return"]).safeParse(kind).success || !workflowId.safeParse(targetId).success || !transactionKey.safeParse(key).success) return { status: "failure", error: "거래 식별자를 확인해주세요." };
  try {
    if (kind === "deposit") {
      const record = await prisma.applicationDeposit.findUnique({ where: { idempotencyKey: key }, select: { id: true, submissionId: true, amount: true, payerName: true, depositedAt: true } });
      if (record && formData) {
        const parsed = depositInputSchema.safeParse(Object.fromEntries(formData));
        if (!parsed.success || parsed.data.amount !== record.amount || parsed.data.payerName !== record.payerName || parsed.data.depositedAt.getTime() !== record.depositedAt.getTime()) return { status: "failure", error: "같은 거래 식별자의 입력이 다릅니다. 원래 거래를 확인해주세요." };
      }
      if (record && record.submissionId !== targetId) return { status: "failure", error: "거래 대상이 일치하지 않습니다." };
      return record ? { status: "success", receiptId: record.id, submissionId: record.submissionId } : { status: "failure", code: "not-found", error: "저장 기록이 없습니다. 같은 거래 식별자와 입력으로만 다시 시도하세요." };
    }
    const record = await prisma.applicationReturn.findUnique({ where: { idempotencyKey: key }, select: { id: true, amount: true, reason: true, returnedAt: true, returnObligationId: true, returnObligation: { select: { submissionId: true } } } });
    if (record && formData) {
      const parsed = returnInputSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success || parsed.data.amount !== record.amount || parsed.data.reason !== record.reason || parsed.data.returnedAt.getTime() !== record.returnedAt.getTime()) return { status: "failure", error: "같은 거래 식별자의 입력이 다릅니다. 원래 거래를 확인해주세요." };
    }
    if (record && record.returnObligationId !== targetId) return { status: "failure", error: "거래 대상이 일치하지 않습니다." };
    return record ? { status: "success", receiptId: record.id, submissionId: record.returnObligation.submissionId } : { status: "failure", code: "not-found", error: "저장 기록이 없습니다. 같은 거래 식별자와 입력으로만 다시 시도하세요." };
  } catch { return { status: "result-unknown", error: "저장 결과를 확인하지 못했습니다. 금융 요청을 반복하지 말고 결과를 다시 조회하세요." }; }
}

/** Compare the complete immutable bank payload under the same Submission lock as the core. */
export async function recordApplicationDeposit(submissionId: string, formData: FormData): Promise<WorkflowActionResult> {
  const principal = await requireAdminPrincipal();
  const parsed = depositInputSchema.extend({ idempotencyKey: transactionKey }).safeParse({ amount: formData.get("amount"), payerName: formData.get("payerName"), depositedAt: formData.get("depositedAt"), idempotencyKey: formData.get("idempotencyKey") });
  if (!workflowId.safeParse(submissionId).success || !parsed.success) return { status: "failure", error: "실제 입금액·입금자명·입금일시를 확인해주세요.", errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors };
  let receiptId: string;
  try {
    receiptId = await prisma.$transaction(async (tx) => {
      await lockWorkflowSubmission(tx, submissionId);
      await assertWorkflowLedger(tx, submissionId);
      const prior = await tx.applicationDeposit.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, submissionId: true, amount: true, payerName: true, depositedAt: true } });
      if (prior && (prior.submissionId !== submissionId || prior.amount !== parsed.data.amount || prior.payerName !== parsed.data.payerName || prior.depositedAt.getTime() !== parsed.data.depositedAt.getTime())) throw new WorkflowConflict();
      const result = await recordApplicationDepositCore(financeInTransaction(tx), { submissionId, ...parsed.data, actorUserId: principal.userId, now: new Date() });
      await assertWorkflowLedger(tx, submissionId);
      return result.depositId;
    }, { maxWait: 10000, timeout: 20000 });
  } catch (error) {
    if (error instanceof SuspectedDuplicateApplicationDepositError) {
      return {
        status: "failure", code: error.code, submissionId: error.submissionId,
        error: `동일한 신청·금액·입금자명·입금일시의 입금 기록이 있어 새 기록을 저장하지 않았습니다. 기존 입금 기록과 은행 거래를 확인해주세요. 일치 후보 ${error.candidateDepositIds.length}건: ${error.candidateDepositIds.join(", ")}. 가족 상세: /reservation-applications/submissions/${error.submissionId}. 정상 별도 입금으로 확인되어도 별도 절차가 필요합니다.`,
      };
    }
    return { status: error instanceof WorkflowLedgerUnavailable || error instanceof WorkflowConflict || error instanceof InsufficientApplicationDepositError || error instanceof ApplicationReturnAmountExceededError || error instanceof ApplicationNotPendingError ? "failure" : "result-unknown", error: error instanceof WorkflowLedgerUnavailable ? "원장을 검증할 수 없어 처리를 차단했습니다. 최신 서버 기록을 확인해주세요." : error instanceof WorkflowConflict ? "같은 거래 식별자의 대상·금액·입금자·일시를 변경할 수 없습니다." : "입금 저장 결과를 확인해주세요. 결과 조회 전에는 다시 기록하지 마세요." };
  }
  // Invalidation is advisory; only a separate successful authoritative read proves freshness.
  try { invalidateWorkflow(submissionId); } catch { /* receipt remains committed */ }
  return { status: "success", receiptId, submissionId };
}

export async function recordApplicationReturn(obligationId: string, formData: FormData): Promise<WorkflowActionResult> {
  const principal = await requireAdminPrincipal();
  const parsed = returnInputSchema.safeParse({ amount: formData.get("amount"), reason: formData.get("reason"), returnedAt: formData.get("returnedAt"), idempotencyKey: formData.get("idempotencyKey") });
  const observed = z.object({ amount: z.coerce.number().int().positive().max(2147483647), returnedAmount: z.coerce.number().int().nonnegative().max(2147483647) }).safeParse({ amount: formData.get("observedAmount"), returnedAmount: formData.get("observedReturnedAmount") });
  if (!workflowId.safeParse(obligationId).success || !parsed.success || !observed.success) return { status: "failure", error: "반환 금액·사유·실제 반환일시와 최신 반환 대상을 확인해주세요.", errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors };
  let saved: { receiptId: string; submissionId: string };
  try {
    saved = await prisma.$transaction(async (tx) => {
      const target = await tx.returnObligation.findUnique({ where: { id: obligationId }, select: { submissionId: true } });
      if (!target) throw new WorkflowConflict();
      await lockWorkflowSubmission(tx, target.submissionId);
      await assertWorkflowLedger(tx, target.submissionId);
      const [obligation] = await tx.$queryRaw<{ id: string; amount: number; returnedAmount: number; resolvedAt: Date | null }[]>`SELECT "id", "amount", "returnedAmount", "resolvedAt" FROM "ReturnObligation" WHERE "id" = ${obligationId} FOR UPDATE`;
      const prior = await tx.applicationReturn.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, returnObligationId: true, amount: true, reason: true, returnedAt: true } });
      if (prior && (prior.returnObligationId !== obligationId || prior.amount !== parsed.data.amount || prior.reason !== parsed.data.reason || prior.returnedAt.getTime() !== parsed.data.returnedAt.getTime())) throw new WorkflowConflict();
      if (!obligation || (!prior && (obligation.resolvedAt || obligation.amount !== observed.data.amount || obligation.returnedAmount !== observed.data.returnedAmount))) throw new WorkflowConflict();
      const result = await recordApplicationReturnCore(financeInTransaction(tx), { obligationId, ...parsed.data, actorUserId: principal.userId, now: new Date() });
      await assertWorkflowLedger(tx, target.submissionId);
      return { receiptId: result.returnId, submissionId: target.submissionId };
    }, { maxWait: 10000, timeout: 20000 });
  } catch (error) {
    return { status: error instanceof WorkflowLedgerUnavailable || error instanceof WorkflowConflict || error instanceof InsufficientApplicationDepositError || error instanceof ApplicationReturnAmountExceededError || error instanceof ApplicationNotPendingError ? "failure" : "result-unknown", error: error instanceof WorkflowLedgerUnavailable ? "원장을 검증할 수 없어 처리를 차단했습니다. 최신 서버 기록을 확인해주세요." : error instanceof WorkflowConflict ? "반환 대상이 변경되었거나 같은 거래의 입력이 다릅니다. 최신 기록을 확인해주세요." : "반환 저장 결과를 확인해주세요. 결과 조회 전에는 다시 기록하지 마세요." };
  }
  try { invalidateWorkflow(saved.submissionId); } catch { /* receipt remains committed */ }
  return { status: "success", ...saved };
}

/** Family route adapter: preserve the existing child route actions and finance-aware core. */
export async function resolveApplicationWorkflow(applicationId: string, kind: "REJECTED" | "CANCELLED", formData: FormData): Promise<WorkflowActionResult> {
  const principal = await requireAdminPrincipal();
  const parsed = applicationResolutionSchema.safeParse({ resolutionNote: formData.get("resolutionNote") });
  if (!workflowId.safeParse(applicationId).success || !z.enum(["REJECTED", "CANCELLED"]).safeParse(kind).success || !parsed.success) return { status: "failure", error: "대상과 필수 사유를 확인해주세요.", errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors };
  let submissionId: string | undefined;
  try {
    const application = await prisma.reservationApplication.findUnique({ where: { id: applicationId }, select: { submissionId: true } });
    if (!application?.submissionId) return { status: "failure", error: "가족 신청 대상을 찾을 수 없습니다." };
    submissionId = application.submissionId;
    await prisma.$transaction(async (tx) => {
      await lockWorkflowSubmission(tx, application.submissionId!);
      await assertWorkflowLedger(tx, application.submissionId!);
      await closeApplicationWithReturnCore(financeInTransaction(tx), { applicationId, status: kind, resolutionNote: parsed.data.resolutionNote, actorUserId: principal.userId, now: new Date() });
      await assertWorkflowLedger(tx, application.submissionId!);
    }, { maxWait: 10000, timeout: 20000 });
    try { invalidateWorkflow(application.submissionId); revalidateApplication(applicationId); } catch { /* committed */ }
    return { status: "success", receiptId: applicationId, submissionId: application.submissionId };
  } catch (error) {
    return { submissionId, status: error instanceof ApplicationNotPendingError || error instanceof WorkflowLedgerUnavailable ? "failure" : "result-unknown", error: error instanceof WorkflowLedgerUnavailable ? "원장을 검증할 수 없어 처리를 차단했습니다." : error instanceof ApplicationNotPendingError ? "이미 처리가 끝난 신청입니다." : "처리 결과가 불명확합니다. 최신 신청 상태를 조회해주세요." };
  }
}

/** Selected siblings are one atomic financial confirmation: no partial Payment mapping is left behind. */
export type SubmissionConfirmationActionResult = WorkflowActionResult & {
  error?: string;
  reservationIds?: string[];
  overbookingConfirmation?: { applicationId: string; classScheduleId: string; childChoice: string; selectionFingerprint: string; classState: string; capacity: number; reservedCount: number; overByAfterCreate: number };
};

export async function confirmApplicationSubmission(formData: FormData): Promise<SubmissionConfirmationActionResult> {
  const principal = await requireAdminPrincipal();
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload") ?? "")); } catch { return { status: "failure", error: "확정할 아이를 다시 선택해주세요." }; }
  const parsed = submissionConfirmationSchema.safeParse(payload);
  if (!parsed.success) return { status: "failure", error: "확정할 아이와 기존 아이 연결 또는 새 아이 등록을 명시적으로 선택해주세요." };
  const { submissionId } = parsed.data;
  const applicationIds = parsed.data.choices.map((choice) => choice.applicationId);
  const observedClassStates = new Map<string, string>();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Preserve parent -> application -> class -> child lock order. The existing
      // core takes the same (re-entrant) locks and still owns every financial write.
      await lockWorkflowSubmission(tx, submissionId);
      await assertWorkflowLedger(tx, submissionId);
      const choices = parsed.data.choices.map((choice) => ({ ...choice }));
      await tx.$queryRaw`SELECT "id" FROM "ReservationApplication" WHERE "id" IN (${Prisma.join(applicationIds)}) AND "submissionId" = ${submissionId} ORDER BY "id" FOR UPDATE`;
      const targets = await tx.reservationApplication.findMany({ where: { id: { in: applicationIds }, submissionId }, select: { id: true, classScheduleId: true, personalDataPurgedAt: true, status: true, programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true }, orderBy: { id: "asc" } });
      const submission = await tx.reservationApplicationSubmission.findUnique({ where: { id: submissionId }, select: { personalDataPurgedAt: true } });
      if (!submission || submission.personalDataPurgedAt || targets.length !== applicationIds.length || targets.some((row) => row.status !== "SUBMITTED" || row.personalDataPurgedAt || !row.programTermsAcknowledged || !row.privacyConsentAgreed || !row.legalGuardianConfirmed || !row.refundTermsAcknowledged)) throw new ApplicationNotPendingError();
      {
        const classIds = [...new Set(targets.map((row) => row.classScheduleId))].sort();
        if (classIds.length) await tx.$queryRaw`SELECT "id" FROM "ClassSchedule" WHERE "id" IN (${Prisma.join(classIds)}) ORDER BY "id" FOR UPDATE`;
        const classes = await tx.classSchedule.findMany({ where: { id: { in: classIds } }, select: { id: true, capacity: true, status: true, startsAt: true, endsAt: true, _count: { select: { reservations: { where: { status: "RESERVED" } } } } } });
        for (const schedule of classes) observedClassStates.set(schedule.id, JSON.stringify([schedule.id, schedule.status, schedule.startsAt, schedule.endsAt]));
        for (const choice of choices) {
          const binding = choice.overbookingConfirmation;
          if (!choice.confirmOverbooking || !binding) continue;
          const target = targets.find((row) => row.id === choice.applicationId);
          const schedule = classes.find((row) => row.id === target?.classScheduleId);
          // A warning may include earlier targets in this same atomic batch.
          const earlier = targets.slice(0, targets.findIndex((row) => row.id === choice.applicationId)).filter((row) => row.classScheduleId === target?.classScheduleId).length;
          if (!schedule || binding.classState !== observedClassStates.get(schedule.id) || binding.capacity !== schedule.capacity || binding.reservedCount !== schedule._count.reservations + earlier) {
            choice.confirmOverbooking = false; choice.overbookingConfirmation = undefined;
          }
        }
      }
      const confirmed = await confirmApplicationSubmissionCore(financeInTransaction(tx), { submissionId, choices, actorUserId: principal.userId, now: new Date() });
      await assertWorkflowLedger(tx, submissionId);
      return confirmed;
    }, { maxWait: 10000, timeout: 20000 });
    // A cache failure after commit must never be reported as a failed transaction.
    try { invalidateWorkflow(submissionId); revalidatePath("/reservations"); revalidatePath("/payments"); revalidatePath("/", "layout"); } catch { /* committed; authoritative read follows */ }
    return { status: "success", submissionId, applicationIds, reservationIds: result.reservationIds, paymentId: result.paymentId };
  } catch (error) {
    if (error instanceof ApplicationSubmissionOverbookingConfirmationError) {
      return { status: "failure", submissionId, applicationIds, overbookingConfirmation: {
        applicationId: error.applicationId, classScheduleId: error.classScheduleId,
        childChoice: error.childChoice, selectionFingerprint: error.selectionFingerprint, classState: observedClassStates.get(error.classScheduleId)!,
        capacity: error.capacity, reservedCount: error.reservedCount, overByAfterCreate: error.overByAfterCreate,
      } };
    }
    console.error("[reservation-applications] failed to confirm submission:", describeErrorForLog(error));
    const known = error instanceof ApplicationPaymentAlreadyExistsError || error instanceof WorkflowLedgerUnavailable || error instanceof WorkflowConflict || error instanceof InsufficientApplicationDepositError || error instanceof ApplicationNotPendingError || error instanceof ChildNotActiveError || error instanceof ChildNotFoundError || error instanceof ChildPersonalDataPurgedError || error instanceof ClassNotFoundError || error instanceof ClassNotScheduledError || error instanceof DuplicateReservationError || error instanceof TerminalReservationError;
    return { status: known ? "failure" : "result-unknown", submissionId, applicationIds,
      error: error instanceof ApplicationPaymentAlreadyExistsError ? "이미 연결된 결제가 있는 예약입니다. 기존 예약·결제 연결을 확인해주세요." : error instanceof WorkflowLedgerUnavailable ? "원장을 검증할 수 없어 예약 확정을 차단했습니다." : error instanceof InsufficientApplicationDepositError ? "선택한 아이의 청구액보다 가용 입금액이 부족합니다." : known ? "아이 연결, 중복 예약, 신청·클래스 상태를 다시 확인해주세요." : classifyInfrastructureError(error) ?? "예약 확정 결과가 불명확합니다. 재확정하지 말고 최신 예약·결제 상태를 조회해주세요." };
  }
}

function revalidateApplication(applicationId: string) {
  revalidatePath("/reservation-applications");
  revalidatePath(`/reservation-applications/${applicationId}`);
}

/** 클래스 신청 링크 만들기·재발급(ADR-052). 재발급하면 이전 링크는 즉시 무효가 된다. */
export async function issueApplicationLink(classScheduleId: string, revision?: string): Promise<ApplicationActionResult> {
  const principal = await requireAdminPrincipal();
  if (!z.string().min(1).max(200).safeParse(classScheduleId).success || !z.string().regex(/^[a-f0-9]{64}$/).safeParse(revision).success) return { error: "잘못된 요청입니다." };
  try {
    await issueApplicationLinkCore(prisma, { classScheduleId, revision: revision!, actorUserId: principal.userId, now: new Date() });
    revalidatePath(`/classes/${classScheduleId}`);
    return {};
  } catch (error) {
    if (error instanceof LinkRevisionConflictError) return { error: "링크 상태가 변경되었습니다. 다시 불러와 현재 주소를 확인해 주세요." };
    return { error: "기존 링크와 클래스 상태를 확인한 뒤 다시 불러와 주세요." };
  }
}

export async function stopApplicationLink(classScheduleId: string, revision?: string): Promise<ApplicationActionResult> {
  await requireAdminPrincipal();
  try {
    if (!z.string().min(1).max(200).safeParse(classScheduleId).success || !z.string().regex(/^[a-f0-9]{64}$/).safeParse(revision).success) return { error: "잘못된 요청입니다." };
    await stopApplicationLinkCore(prisma, { classScheduleId, revision });
  } catch (error) {
    if (error instanceof ApplicationLinkNotFoundError) return { error: "이미 중지되었거나 없는 링크입니다." };
    console.error("[reservation-applications] failed to stop link:", describeErrorForLog(error));
    return { error: "신청 링크를 중지하지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath(`/classes/${classScheduleId}`);
  return {};
}

/** ADMIN explicitly upgrades a priced legacy class URL while preserving the same raw capability. */
export async function upgradeLegacyApplicationLink(classScheduleId: string, revision?: string): Promise<{ error?: string; groupId?: string }> {
  const principal = await requireAdminPrincipal();
  try {
    const settings = await getReservationApplicationSettings(prisma);
    if (!z.string().min(1).max(200).safeParse(classScheduleId).success || !z.string().regex(/^[a-f0-9]{64}$/).safeParse(revision).success) return { error: "잘못된 요청입니다." };
    const result = await upgradeLegacyApplicationLinkCore(prisma, { revision, classScheduleId, actorUserId: principal.userId, now: new Date(), configReady: Boolean(settings && isReservationApplicationSettingsReady(settings)) });
    revalidatePath(`/classes/${classScheduleId}`);
    return result;
  } catch (error) {
    console.error("[reservation-applications] failed to upgrade legacy link:", describeErrorForLog(error));
    return { error: "운영 설정과 클래스 신청 금액, 기존 링크 상태를 확인해주세요." };
  }
}

/** 입금 확인 기록. Payment 를 만들지 않는다 — 결제는 확정 후 기존 결제 화면에서 등록한다. */
export async function confirmApplicationDeposit(applicationId: string): Promise<ApplicationActionResult> {
  const principal = await requireAdminPrincipal();
  try {
    await confirmApplicationDepositCore(prisma, { applicationId, actorUserId: principal.userId, now: new Date() });
  } catch (error) {
    if (error instanceof ApplicationNotPendingError) {
      return { error: "이미 입금 확인되었거나 처리가 끝난 신청입니다." };
    }
    console.error("[reservation-applications] failed to confirm deposit:", describeErrorForLog(error));
    return { error: "입금 확인을 기록하지 못했습니다. 다시 시도해주세요." };
  }
  revalidateApplication(applicationId);
  return {};
}

export type ApplicationConfirmFormState = {
  errors?: Partial<Record<"childChoice" | "memo", string[]>>;
  formError?: string;
  values?: { childChoice?: string; memo?: string };
  overbookingConfirmation?: {
    applicationId: string;
    childChoice: string;
    capacity: number;
    reservedCount: number;
    overByAfterCreate: number;
  };
};

function describeConfirmFailure(error: unknown): string | null {
  if (error instanceof ApplicationNotFoundError) return "신청을 찾을 수 없습니다.";
  if (error instanceof ApplicationNotPendingError) return "이미 처리가 끝난 신청입니다.";
  if (error instanceof ApplicationDepositNotConfirmedError) return "입금 확인을 먼저 기록해주세요.";
  if (error instanceof ClassNotScheduledError) {
    return "취소되었거나 종료된 클래스에는 예약할 수 없습니다. 신청을 반려해주세요.";
  }
  if (error instanceof ClassNotFoundError) return "클래스를 찾을 수 없습니다.";
  if (error instanceof ChildNotFoundError) return "선택한 아이를 찾을 수 없습니다.";
  if (error instanceof ChildPersonalDataPurgedError) {
    return "보관기간이 지나 개인정보를 파기한 아이에게는 예약할 수 없습니다. 새 아이로 등록해 확정해주세요.";
  }
  if (error instanceof ChildNotActiveError) {
    return "비활성화된 아이는 새로 예약할 수 없습니다. 아이 상세에서 다시 활성화한 뒤 확정해주세요.";
  }
  if (error instanceof DuplicateReservationError) return "이미 이 클래스에 예약된 아이입니다.";
  if (error instanceof TerminalReservationError) {
    return "이 아이의 해당 클래스 예약은 이미 참여완료·노쇼로 끝나 다시 예약할 수 없습니다.";
  }
  return null;
}

/**
 * 입금 확인된 신청을 기존 예약 규칙으로 확정한다(ADR-053). 정원 이상이면 기존 예약 화면과 같은
 * 2단계 확인을 거치며, 확인값은 (신청 id, 아이 선택)에 묶는다. 성공하면 예약 상세로 이동한다.
 */
export async function confirmReservationApplication(
  applicationId: string,
  _previousState: ApplicationConfirmFormState,
  formData: FormData,
): Promise<ApplicationConfirmFormState> {
  const principal = await requireAdminPrincipal();
  const values = { childChoice: readFormString(formData, "childChoice"), memo: readFormString(formData, "memo") };

  const parsed = applicationConfirmSchema.safeParse({
    childChoice: formData.get("childChoice"),
    memo: formData.get("memo"),
    confirmOverbooking: formData.get("confirmOverbooking") || undefined,
    confirmedApplicationId: formData.get("confirmedApplicationId") || undefined,
    confirmedChildChoice: formData.get("confirmedChildChoice") || undefined,
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }

  const { childChoice, memo } = parsed.data;
  const confirmOverbooking =
    parsed.data.confirmOverbooking === "true" &&
    parsed.data.confirmedApplicationId === applicationId &&
    parsed.data.confirmedChildChoice === childChoice;

  let reservationId: string;
  try {
    const result = await confirmReservationApplicationCore(prisma, {
      applicationId,
      childChoice: childChoice === NEW_CHILD_CHOICE ? { type: "NEW" } : { type: "EXISTING", childId: childChoice },
      memo,
      confirmOverbooking,
      actorUserId: principal.userId,
      now: new Date(),
    });
    reservationId = result.reservationId;
  } catch (error) {
    if (error instanceof OverbookingConfirmationRequiredError) {
      return {
        values,
        overbookingConfirmation: {
          applicationId,
          childChoice,
          capacity: error.capacity,
          reservedCount: error.reservedCount,
          overByAfterCreate: error.overByAfterCreate,
        },
      };
    }
    const message = describeConfirmFailure(error);
    if (message) return { formError: message, values };
    console.error("[reservation-applications] failed to confirm application:", describeErrorForLog(error));
    return {
      formError: classifyInfrastructureError(error) ?? "예약 확정에 실패했습니다. 다시 시도해주세요.",
      values,
    };
  }

  revalidateApplication(applicationId);
  revalidatePath("/reservations");
  redirect(`/reservations/${reservationId}`);
}

export type ApplicationResolveFormState = {
  errors?: { resolutionNote?: string[] };
  formError?: string;
  values?: { resolutionNote?: string };
};

async function closeApplication(
  applicationId: string,
  status: ApplicationClosingStatus,
  formData: FormData,
): Promise<ApplicationResolveFormState> {
  const principal = await requireAdminPrincipal();
  const values = { resolutionNote: readFormString(formData, "resolutionNote") };

  const parsed = applicationResolutionSchema.safeParse({ resolutionNote: formData.get("resolutionNote") });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, values };
  }

  try {
    const now = new Date();
    const application = await prisma.reservationApplication.findUnique({ where: { id: applicationId }, select: { submissionId: true } });
    if (application?.submissionId) {
      await closeApplicationWithReturnCore(prisma, { applicationId, status, resolutionNote: parsed.data.resolutionNote, actorUserId: principal.userId, now });
    } else {
      await closeReservationApplicationCore(prisma, { applicationId, status, resolutionNote: parsed.data.resolutionNote, actorUserId: principal.userId, now });
    }
  } catch (error) {
    if (error instanceof ApplicationNotPendingError) return { formError: "이미 처리가 끝난 신청입니다.", values };
    console.error("[reservation-applications] failed to close application:", describeErrorForLog(error));
    return { formError: "처리하지 못했습니다. 다시 시도해주세요.", values };
  }

  revalidateApplication(applicationId);
  redirect(`/reservation-applications/${applicationId}`);
}

/** 운영자 판단으로 신청을 반려한다(사유 필수). Reservation 을 만들지 않는다. */
export async function rejectReservationApplication(
  applicationId: string,
  _previousState: ApplicationResolveFormState,
  formData: FormData,
): Promise<ApplicationResolveFormState> {
  return closeApplication(applicationId, "REJECTED", formData);
}

/** 보호자 요청으로 신청을 취소한다(사유 필수). Reservation 을 만들지 않는다. */
export async function cancelReservationApplication(
  applicationId: string,
  _previousState: ApplicationResolveFormState,
  formData: FormData,
): Promise<ApplicationResolveFormState> {
  return closeApplication(applicationId, "CANCELLED", formData);
}

export type PersonalDataPurgeActionResult = {
  error?: string;
  purgedApplicationCount?: number;
  purgedChildCount?: number;
  /** 한 번에 처리하는 개수를 넘어 남은 대상이 있다. 다시 실행하면 이어서 파기한다. */
  hasMore?: boolean;
};

/**
 * 보관기간이 지난 신청·확정 고객의 개인정보를 파기한다(ADR-055~058). 자동 배치 없이 ADMIN 이 직접 실행한다.
 * 서버가 실행 시점 기준으로 대상을 다시 계산하고, 확정 고객은 행을 잠근 뒤 한 번 더 확인하므로
 * 화면에서 본 목록과 달라도 그 시점에 만료된 대상만 파기한다.
 */
export async function purgeExpiredPersonalData(): Promise<PersonalDataPurgeActionResult> {
  const principal = await requireAdminPrincipal();
  let result: PersonalDataPurgeResult;
  try {
    result = await purgeExpiredPersonalDataCore(prisma, { actorUserId: principal.userId, now: new Date() });
  } catch (error) {
    console.error("[reservation-applications] failed to purge expired applications:", describeErrorForLog(error));
    return { error: "개인정보를 파기하지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath("/reservation-applications");
  revalidatePath("/reservation-applications/retention");
  revalidatePath("/children");
  return result;
}


/** Capability writes are separate from copying/sharing/opening an already-issued address. */
export async function issueClassApplicationLink(input: unknown): Promise<Partial<ClassLinkReceipt> & { error?: string; conflict?: boolean }> {
  const principal = await requireAdminPrincipal();
  const parsed = classLinkOperationSchema.safeParse(input);
  if (!parsed.success) return { error: "잘못된 링크 작업입니다. 화면을 다시 불러와 주세요." };
  try {
    const result = await issueClassLinkOperationCore(prisma, { ...parsed.data, actorUserId: principal.userId, now: new Date() });
    revalidatePath("/classes", "layout");
    revalidatePath("/reservation-applications/groups", "layout");
    return result;
  } catch (error) {
    if (error instanceof LinkOperationConflictError) return { error: "같은 작업 번호에 다른 요청을 사용할 수 없습니다. 현재 상태를 확인해 주세요.", conflict: true };
    if (error instanceof LinkRevisionConflictError) return { error: "다른 관리자가 가격·구성·링크를 변경했습니다. 다시 불러와 현재 상태를 확인해 주세요.", conflict: true };
    if (error instanceof LinkSettingsNotReadyError) return { error: "입금 안내 설정과 동의 문구를 먼저 준비해 주세요." };
    if (error instanceof ApplicationLinkClassClosedError) return { error: "신청금액이 지정된 미래 예정 클래스만 링크를 발급할 수 있습니다." };
    return { error: "링크 작업 결과를 확인하지 못했습니다. 같은 작업으로 다시 시도하거나 현재 상태를 다시 불러와 주세요. 기존 유효 링크는 유지됩니다." };
  }
}
