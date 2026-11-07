"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdminOrSuperAdminPrincipal, requireAdminPrincipal } from "@/lib/auth/authorization";
import { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";
import { PrismaRuntimeRepository } from "@/server/kakao/runtime-settings";
import { stopNewSends, type BlockResult } from "@/server/kakao/block-action-service";
import { executeClosure, pollRowDelivery, record7dReview, recordClosureApproval, recordLookupApproval, recordResponsibilityReview } from "@/server/kakao/review-actions";
import { readRealSendEnv } from "@/server/kakao/real-send-wiring";
import { revalidatePath } from "next/cache";

export async function blockAction(_previous: BlockResult | null, form: FormData): Promise<BlockResult> {
  const principal = await requireAdminPrincipal();
  const result = await stopNewSends({ actorId: principal.userId, reason: form.get("reason") }, {
    read: async () => {
      const rows = await prisma.$queryRaw<{ blocked: boolean; revision: number }[]>`SELECT "blocked", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
      return rows[0] ?? null;
    },
    repository: new PrismaRuntimeRepository(new PrismaDispatchRepository(prisma)),
  });
  revalidatePath("/reservation-applications/notifications");
  return result;
}

// --- G4 stage 3E: review / approval / closure / lookup wrappers ---
// Each wrapper authorizes at the page level, then calls the service function
// (which re-enforces the PLAN §2.13 guard scope), returns { ok, error },
// and revalidates the history page. commandId/approvalId are generated here
// with randomUUID(), never taken from the form. evidenceId (closure
// approval) comes from form input; the other approval/execution identifiers
// are resolved server-side from the stored approval rows.

export type ReviewActionResult = { ok: true; message: string } | { ok: false; error: string };
const historyPath = "/reservation-applications/notifications";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const dispatchForm = z.object({ dispatchId: identifier }).strict();
const slotForm = z.object({ slotId: identifier }).strict();
const closureApprovalForm = z.object({ dispatchId: identifier, evidenceId: identifier }).strict();
const REASON_MESSAGES: Record<string, string> = {
  not_unknown: "대상이 결과 불명 상태가 아닙니다",
  too_early: "아직 점검 시점이 되지 않았습니다",
  already_recorded: "이미 기록되었습니다",
  not_owner: "책임자만 수행할 수 있습니다",
  preconditions_unmet: "종결 전제 조건이 충족되지 않았습니다",
  already_approved: "이미 승인되었습니다",
  not_closure_executor: "종결 실행자로 지정되지 않았습니다",
  is_owner: "승인자는 종결을 실행할 수 없습니다",
  not_approved: "승인 기록이 없습니다",
  too_soon: "조회는 5분 간격으로만 가능합니다",
  lookup_in_flight: "진행 중인 조회가 있습니다",
  provider_unconfigured: "조회 제공자 설정이 없습니다",
  blocked: "승인이 만료되었습니다. 다시 승인해 주세요.",
};
function reasonMessage(reason: string): string {
  return REASON_MESSAGES[reason] ?? "처리에 실패했습니다";
}

export async function record7dReviewAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = dispatchForm.parse({ dispatchId: form.get("dispatchId") });
    const result = await record7dReview(new PrismaDispatchRepository(prisma), { dispatchId: input.dispatchId, commandId: randomUUID(), actorId: principal.userId, at: new Date() });
    revalidatePath(historyPath);
    return result.ok ? { ok: true, message: "7일 점검을 기록했습니다" } : { ok: false, error: reasonMessage(result.reason) };
  } catch {
    return { ok: false, error: "7일 점검을 기록하지 못했습니다. 권한과 대상 상태를 확인해주세요" };
  }
}

export async function recordResponsibilityReviewAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = dispatchForm.parse({ dispatchId: form.get("dispatchId") });
    const result = await recordResponsibilityReview(new PrismaDispatchRepository(prisma), { dispatchId: input.dispatchId, commandId: randomUUID(), actorId: principal.userId, at: new Date() });
    revalidatePath(historyPath);
    return result.ok ? { ok: true, message: "30일 재검토를 기록했습니다" } : { ok: false, error: reasonMessage(result.reason) };
  } catch {
    return { ok: false, error: "30일 재검토를 기록하지 못했습니다. 권한과 대상 상태를 확인해주세요" };
  }
}

export async function recordClosureApprovalAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = closureApprovalForm.parse({ dispatchId: form.get("dispatchId"), evidenceId: form.get("evidenceId") });
    const result = await recordClosureApproval(new PrismaDispatchRepository(prisma), { dispatchId: input.dispatchId, commandId: randomUUID(), approvalId: randomUUID(), evidenceId: input.evidenceId, actorId: principal.userId, at: new Date() });
    revalidatePath(historyPath);
    return result.ok ? { ok: true, message: "종결 승인을 기록했습니다" } : { ok: false, error: reasonMessage(result.reason) };
  } catch {
    return { ok: false, error: "종결 승인을 기록하지 못했습니다. 권한·증거 참조·대상 상태를 확인해주세요" };
  }
}

export async function executeClosureAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = dispatchForm.parse({ dispatchId: form.get("dispatchId") });
    const approval = await prisma.notificationAudit.findFirst({
      where: { environment: "preview", dispatchId: input.dispatchId, eventType: "closure_approved" },
      select: { eventId: true, commandId: true, evidenceId: true },
      orderBy: { occurredAt: "desc" },
    });
    if (!approval?.commandId || !approval.evidenceId) return { ok: false, error: reasonMessage("not_approved") };
    const result = await executeClosure(new PrismaDispatchRepository(prisma), { dispatchId: input.dispatchId, commandId: approval.commandId, actorId: principal.userId, approvalId: approval.eventId, evidenceId: approval.evidenceId, at: new Date() });
    revalidatePath(historyPath);
    return result.ok ? { ok: true, message: "미확정 건을 종결했습니다" } : { ok: false, error: reasonMessage(result.reason) };
  } catch {
    return { ok: false, error: "종결을 실행하지 못했습니다. 권한과 승인 상태를 확인해주세요" };
  }
}

export async function recordLookupApprovalAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = slotForm.parse({ slotId: form.get("slotId") });
    const runtime = await prisma.notificationRuntimeConfig.findUnique({ where: { environment: "preview" }, select: { costExecutorId: true } });
    if (!runtime?.costExecutorId) return { ok: false, error: "조회 실행자가 지정되지 않았습니다" };
    const result = await recordLookupApproval(new PrismaDispatchRepository(prisma), { slotId: input.slotId, commandId: randomUUID(), approvalId: randomUUID(), executorId: runtime.costExecutorId, actorId: principal.userId, at: new Date() });
    revalidatePath(historyPath);
    return result.ok ? { ok: true, message: "조회 승인을 기록했습니다. 승인 당일에만 유효합니다" } : { ok: false, error: reasonMessage(result.reason) };
  } catch {
    return { ok: false, error: "조회 승인을 기록하지 못했습니다. 권한과 대상 상태를 확인해주세요" };
  }
}

export async function pollRowDeliveryAction(_previous: ReviewActionResult | null, form: FormData): Promise<ReviewActionResult> {
  const principal = await requireAdminOrSuperAdminPrincipal();
  try {
    const input = slotForm.parse({ slotId: form.get("slotId") });
    const env = readRealSendEnv(process.env);
    if (!env) return { ok: false, error: reasonMessage("provider_unconfigured") };
    const approval = await prisma.notificationAudit.findFirst({
      where: { environment: "preview", slotId: input.slotId, eventType: "lookup_approved" },
      select: { eventId: true, commandId: true },
      orderBy: { occurredAt: "desc" },
    });
    if (!approval?.commandId) return { ok: false, error: reasonMessage("blocked") };
    const result = await pollRowDelivery(new PrismaDispatchRepository(prisma), env, { slotId: input.slotId, commandId: approval.commandId, approvalId: approval.eventId, actorId: principal.userId, at: new Date() });
    revalidatePath(historyPath);
    if (!result.ok) return { ok: false, error: reasonMessage(result.reason) };
    return { ok: true, message: result.result === "recorded" ? "조회 결과를 기록했습니다" : "조회 결과가 불명입니다" };
  } catch {
    return { ok: false, error: "결과 조회를 수행하지 못했습니다. 권한과 승인 상태를 확인해주세요" };
  }
}
