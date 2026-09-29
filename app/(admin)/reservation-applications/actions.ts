"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
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
import { issueApplicationLinkCore, stopApplicationLinkCore } from "@/server/reservation-applications/links";
import {
  closeReservationApplicationCore,
  confirmApplicationDepositCore,
  type ApplicationClosingStatus,
} from "@/server/reservation-applications/resolve";
import { purgeExpiredApplicationsCore } from "@/server/reservation-applications/retention";

/**
 * 예약 신청 관리 action 은 모두 ADMIN 전용이다(ADR-053). 입금 확인은 재무정보라 MANAGER 에게 허용하지 않는다.
 * 각 action 이 requireAdminPrincipal() 을 먼저 호출해 MANAGER/TEACHER 의 직접 호출을 차단한다.
 */

export type ApplicationActionResult = { error?: string };

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
    await closeReservationApplicationCore(prisma, {
      applicationId,
      status,
      resolutionNote: parsed.data.resolutionNote,
      actorUserId: principal.userId,
      now: new Date(),
    });
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

export type ApplicationPurgeResult = { error?: string; purgedCount?: number };

/**
 * 보관기간이 지난 신청의 개인정보를 파기한다(ADR-055). 자동 배치 없이 ADMIN 이 직접 실행한다.
 * 서버가 실행 시점 기준으로 대상을 다시 계산하므로 화면에서 본 목록과 달라도 만료된 신청만 파기한다.
 */
export async function purgeExpiredApplications(): Promise<ApplicationPurgeResult> {
  const principal = await requireAdminPrincipal();
  let purgedCount: number;
  try {
    const result = await purgeExpiredApplicationsCore(prisma, { actorUserId: principal.userId, now: new Date() });
    purgedCount = result.purgedCount;
  } catch (error) {
    console.error("[reservation-applications] failed to purge expired applications:", describeErrorForLog(error));
    return { error: "개인정보를 파기하지 못했습니다. 다시 시도해주세요." };
  }
  revalidatePath("/reservation-applications");
  revalidatePath("/reservation-applications/retention");
  return { purgedCount };
}
