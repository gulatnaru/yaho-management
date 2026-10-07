"use server";

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
import { createApplicationGroupCore, issueApplicationGroupLinkCore, stopApplicationGroupCore, updateApplicationGroupCore } from "@/server/reservation-applications/groups";
import { reservationApplicationSettingsSchema, groupCreateSchema, submissionConfirmationSchema } from "@/lib/reservation-applications/phase20-validation";
import { getReservationApplicationSettings, importLegacyReservationApplicationSettingsCore, isReservationApplicationSettingsReady, saveReservationApplicationSettingsCore } from "@/server/reservation-applications/settings";
import { ApplicationSubmissionOverbookingConfirmationError, closeApplicationWithReturnCore, confirmApplicationSubmissionCore, recordApplicationDepositCore, recordApplicationReturnCore } from "@/server/reservation-applications/finance";
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

/** Phase 20 group creation is ADMIN-only and uses the schedule's explicit applicationPrice. */
export async function createApplicationGroup(formData: FormData): Promise<{ error?: string; groupId?: string }> {
  const principal = await requireAdminPrincipal();
  const parsed = groupCreateSchema.safeParse({ classScheduleIds: formData.getAll("classScheduleId") });
  if (!parsed.success) return { error: "하나 이상의 중복되지 않은 클래스를 선택해주세요." };
  try {
    const result = await createApplicationGroupCore(prisma, { classScheduleIds: parsed.data.classScheduleIds, actorUserId: principal.userId, now: new Date() });
    revalidatePath("/reservation-applications/groups");
    return result;
  } catch (error) {
    console.error("[reservation-applications] failed to create group:", describeErrorForLog(error));
    return { error: "가격이 설정된 미래 예정 클래스만 그룹에 넣을 수 있습니다." };
  }
}

export async function issueApplicationGroupLink(groupId: string): Promise<{ error?: string; token?: string }> {
  const principal = await requireAdminPrincipal();
  try {
    const result = await issueApplicationGroupLinkCore(prisma, { groupId, actorUserId: principal.userId, now: new Date() });
    revalidatePath(`/reservation-applications/groups/${groupId}`);
    return result;
  } catch (error) {
    console.error("[reservation-applications] failed to issue group link:", describeErrorForLog(error));
    return { error: "가격이 설정된 미래 예정 클래스 그룹만 접수 링크를 만들 수 있습니다." };
  }
}

/** Membership edits affect only future submissions. Existing submitted quotes remain immutable. */
export async function updateApplicationGroup(groupId: string, formData: FormData): Promise<{ error?: string }> {
  await requireAdminPrincipal();
  const parsed = groupCreateSchema.safeParse({ classScheduleIds: formData.getAll("classScheduleId") });
  if (!parsed.success) return { error: "하나 이상의 중복되지 않은 클래스를 선택해주세요." };
  try {
    await updateApplicationGroupCore(prisma, { groupId, classScheduleIds: parsed.data.classScheduleIds, now: new Date() });
    revalidatePath(`/reservation-applications/groups/${groupId}`);
    revalidatePath("/reservation-applications/groups");
    return {};
  } catch (error) {
    console.error("[reservation-applications] failed to update group:", describeErrorForLog(error));
    return { error: "가격이 설정된 미래 예정 클래스만 그룹에 넣을 수 있습니다." };
  }
}

/** Stopping a group invalidates every issued group capability. */
export async function stopApplicationGroup(groupId: string): Promise<{ error?: string }> {
  await requireAdminPrincipal();
  try {
    await stopApplicationGroupCore(prisma, { groupId });
    revalidatePath(`/reservation-applications/groups/${groupId}`);
    revalidatePath("/reservation-applications/groups");
    return {};
  } catch (error) {
    console.error("[reservation-applications] failed to stop group:", describeErrorForLog(error));
    return { error: "이미 중지되었거나 없는 그룹입니다." };
  }
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

/** Actual bank transactions are ADMIN-only and remain separate from Payment until confirmation. */
export async function recordApplicationDeposit(submissionId: string, formData: FormData): Promise<{ error?: string; availableAmount?: number }> {
  const principal = await requireAdminPrincipal();
  const parsed = depositInputSchema.safeParse({ amount: formData.get("amount"), payerName: formData.get("payerName"), depositedAt: formData.get("depositedAt"), idempotencyKey: formData.get("idempotencyKey") || undefined });
  if (!parsed.success) return { error: "실제 입금액·입금자명·입금일시를 확인해주세요." };
  try {
    const result = await recordApplicationDepositCore(prisma, { submissionId, ...parsed.data, actorUserId: principal.userId, now: new Date() });
    revalidatePath(`/reservation-applications/submissions/${submissionId}`);
    revalidatePath("/reservation-applications/returns");
    return { availableAmount: result.availableAmount };
  } catch (error) {
    console.error("[reservation-applications] failed to record deposit:", describeErrorForLog(error));
    return { error: "입금을 기록하지 못했습니다. 같은 거래를 다시 입력하지 않았는지 확인해주세요." };
  }
}

export async function recordApplicationReturn(obligationId: string, formData: FormData): Promise<{ error?: string; remainingAmount?: number }> {
  const principal = await requireAdminPrincipal();
  const parsed = returnInputSchema.safeParse({ amount: formData.get("amount"), reason: formData.get("reason"), returnedAt: formData.get("returnedAt"), idempotencyKey: formData.get("idempotencyKey") });
  if (!parsed.success) return { error: "반환 금액·사유·실제 반환일시를 확인해주세요." };
  try {
    const result = await recordApplicationReturnCore(prisma, { obligationId, ...parsed.data, actorUserId: principal.userId, now: new Date() });
    revalidatePath("/reservation-applications/returns");
    return { remainingAmount: result.remainingAmount };
  } catch (error) {
    console.error("[reservation-applications] failed to record return:", describeErrorForLog(error));
    return { error: "남은 반환 필요 금액을 초과했거나 처리할 수 없습니다." };
  }
}

/** Selected siblings are one atomic financial confirmation: no partial Payment mapping is left behind. */
export type SubmissionConfirmationActionResult = {
  error?: string;
  reservationIds?: string[];
  overbookingConfirmation?: { applicationId: string; classScheduleId: string; childChoice: string; selectionFingerprint: string; capacity: number; reservedCount: number; overByAfterCreate: number };
};

export async function confirmApplicationSubmission(formData: FormData): Promise<SubmissionConfirmationActionResult> {
  const principal = await requireAdminPrincipal();
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload") ?? "")); } catch { return { error: "확정할 아이를 다시 선택해주세요." }; }
  const parsed = submissionConfirmationSchema.safeParse(payload);
  if (!parsed.success) return { error: "확정할 아이를 다시 선택해주세요." };
  try {
    const result = await confirmApplicationSubmissionCore(prisma, { ...parsed.data, actorUserId: principal.userId, now: new Date() });
    revalidatePath(`/reservation-applications/submissions/${parsed.data.submissionId}`);
    revalidatePath("/reservation-applications");
    revalidatePath("/reservations");
    return { reservationIds: result.reservationIds };
  } catch (error) {
    if (error instanceof ApplicationSubmissionOverbookingConfirmationError) {
      return {
        overbookingConfirmation: {
          applicationId: error.applicationId,
          classScheduleId: error.classScheduleId,
          childChoice: error.childChoice,
          selectionFingerprint: error.selectionFingerprint,
          capacity: error.capacity,
          reservedCount: error.reservedCount,
          overByAfterCreate: error.overByAfterCreate,
        },
      };
    }
    console.error("[reservation-applications] failed to confirm submission:", describeErrorForLog(error));
    return { error: "가용 입금액, 아이 정보, 클래스 상태와 정원을 다시 확인해주세요." };
  }
}

function revalidateApplication(applicationId: string) {
  revalidatePath("/reservation-applications");
  revalidatePath(`/reservation-applications/${applicationId}`);
}

/** 클래스 신청 링크 만들기·재발급(ADR-052). 재발급하면 이전 링크는 즉시 무효가 된다. */
export async function issueApplicationLink(classScheduleId: string): Promise<ApplicationActionResult> {
  const principal = await requireAdminPrincipal();
  try {
    await issueApplicationLinkCore(prisma, { classScheduleId, actorUserId: principal.userId, now: new Date() });
  } catch (error) {
    if (error instanceof ApplicationLinkNotFoundError) return { error: "클래스를 찾을 수 없습니다." };
    if (error instanceof ApplicationLinkClassClosedError) {
      return { error: "취소되었거나 이미 시작한 클래스는 신청 링크를 만들 수 없습니다." };
    }
    console.error("[reservation-applications] failed to issue link:", describeErrorForLog(error));
    return { error: "신청 링크를 만들지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath(`/classes/${classScheduleId}`);
  return {};
}

export async function stopApplicationLink(classScheduleId: string): Promise<ApplicationActionResult> {
  await requireAdminPrincipal();
  try {
    await stopApplicationLinkCore(prisma, { classScheduleId });
  } catch (error) {
    if (error instanceof ApplicationLinkNotFoundError) return { error: "이미 중지되었거나 없는 링크입니다." };
    console.error("[reservation-applications] failed to stop link:", describeErrorForLog(error));
    return { error: "신청 링크를 중지하지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath(`/classes/${classScheduleId}`);
  return {};
}

/** ADMIN explicitly upgrades a priced legacy class URL while preserving the same raw capability. */
export async function upgradeLegacyApplicationLink(classScheduleId: string): Promise<{ error?: string; groupId?: string }> {
  const principal = await requireAdminPrincipal();
  try {
    const settings = await getReservationApplicationSettings(prisma);
    const result = await upgradeLegacyApplicationLinkCore(prisma, { classScheduleId, actorUserId: principal.userId, now: new Date(), configReady: Boolean(settings && isReservationApplicationSettingsReady(settings)) });
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
    return { formError: "예약 확정에 실패했습니다. 다시 시도해주세요.", values };
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
