"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import {
  cancelReservationInputSchema,
  reservationSubmissionSchema,
} from "@/lib/validation/reservation";
import {
  ChildNotActiveError,
  ChildNotFoundError,
  ClassNotFoundError,
  ClassNotScheduledError,
  DuplicateReservationError,
  OverbookingConfirmationRequiredError,
  TerminalReservationError,
} from "@/lib/reservations/errors";
import { createReservationCore } from "@/server/reservations/create";

// "use server" 파일은 async 함수만 export 할 수 있어, createReservationCore 가 던지는 에러
// 클래스들은 lib/reservations/errors.ts 에 정의하고 여기서는 가져와서만 쓴다(재수출하지 않는다).
class ReservationNotCancellableError extends Error {}

export type ReservationFormFieldKey = "classScheduleId" | "childId" | "memo";

export type ReservationFormValues = {
  classScheduleId?: string;
  childId?: string;
  memo?: string;
};

export type ReservationFormState = {
  errors?: Partial<Record<ReservationFormFieldKey, string[]>>;
  formError?: string;
  values?: ReservationFormValues;
  overbookingConfirmation?: {
    classScheduleId: string;
    childId: string;
    capacity: number;
    reservedCount: number;
    overByAfterCreate: number;
  };
};

function readReservationFormValues(formData: FormData): ReservationFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    classScheduleId: toStringOrUndefined(formData.get("classScheduleId")),
    childId: toStringOrUndefined(formData.get("childId")),
    memo: toStringOrUndefined(formData.get("memo")),
  };
}

export async function createReservation(
  _prevState: ReservationFormState,
  formData: FormData,
): Promise<ReservationFormState> {
  await requireOperationalPrincipal();

  const result = reservationSubmissionSchema.safeParse({
    classScheduleId: formData.get("classScheduleId"),
    childId: formData.get("childId"),
    memo: formData.get("memo") || undefined,
    confirmOverbooking: formData.get("confirmOverbooking") || undefined,
    confirmedClassScheduleId: formData.get("confirmedClassScheduleId") || undefined,
    confirmedChildId: formData.get("confirmedChildId") || undefined,
  });

  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: readReservationFormValues(formData),
    };
  }

  let createdId: string;
  try {
    const created = await createReservationCore(prisma, result.data);
    createdId = created.id;
  } catch (error) {
    if (error instanceof ClassNotScheduledError) {
      return {
        formError: "취소되었거나 완료된 클래스에는 예약할 수 없습니다.",
        values: readReservationFormValues(formData),
      };
    }
    if (error instanceof ChildNotActiveError) {
      return {
        formError: "비활성화된 아이는 새로 예약할 수 없습니다.",
        values: readReservationFormValues(formData),
      };
    }
    if (error instanceof DuplicateReservationError) {
      return {
        formError: "이미 이 클래스에 예약된 아이입니다.",
        values: readReservationFormValues(formData),
      };
    }
    if (error instanceof TerminalReservationError) {
      return {
        formError: "이미 종료된 예약입니다. 관리자에게 문의해주세요.",
        values: readReservationFormValues(formData),
      };
    }
    if (error instanceof OverbookingConfirmationRequiredError) {
      return {
        values: readReservationFormValues(formData),
        overbookingConfirmation: {
          classScheduleId: result.data.classScheduleId,
          childId: result.data.childId,
          capacity: error.capacity,
          reservedCount: error.reservedCount,
          overByAfterCreate: error.overByAfterCreate,
        },
      };
    }
    if (error instanceof ClassNotFoundError || error instanceof ChildNotFoundError) {
      return {
        formError: "선택한 클래스 또는 아이를 찾을 수 없습니다.",
        values: readReservationFormValues(formData),
      };
    }
    console.error(
      "[reservations] failed to create reservation:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      formError: "예약 생성에 실패했습니다. 다시 시도해주세요.",
      values: readReservationFormValues(formData),
    };
  }

  revalidatePath("/reservations");
  redirect(`/reservations/${createdId}`);
}

export type ReservationCancelFormFieldKey = "cancelReason" | "cancelDetail";

export type ReservationCancelFormValues = {
  cancelReason?: string;
  cancelDetail?: string;
};

export type ReservationCancelFormState = {
  errors?: Partial<Record<ReservationCancelFormFieldKey, string[]>>;
  formError?: string;
  values?: ReservationCancelFormValues;
};

function readCancelReservationFormValues(formData: FormData): ReservationCancelFormValues {
  const toStringOrUndefined = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : undefined;

  return {
    cancelReason: toStringOrUndefined(formData.get("cancelReason")),
    cancelDetail: toStringOrUndefined(formData.get("cancelDetail")),
  };
}

export async function cancelReservation(
  id: string,
  _prevState: ReservationCancelFormState,
  formData: FormData,
): Promise<ReservationCancelFormState> {
  const principal = await requireOperationalPrincipal();

  const current = await prisma.reservation.findUnique({
    where: { id },
    select: { status: true, classSchedule: { select: { status: true, endsAt: true } } },
  });

  if (!current) {
    return { formError: "예약을 찾을 수 없습니다.", values: readCancelReservationFormValues(formData) };
  }

  if (!canCancelReservation(current, current.classSchedule)) {
    return {
      formError: "이미 취소되었거나 취소할 수 없는 예약입니다.",
      values: readCancelReservationFormValues(formData),
    };
  }

  const result = cancelReservationInputSchema.safeParse({
    cancelReason: formData.get("cancelReason"),
    cancelDetail: formData.get("cancelDetail") || undefined,
  });

  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: readCancelReservationFormValues(formData),
    };
  }

  try {
    const cancelledAt = new Date();
    const updateResult = await prisma.reservation.updateMany({
      where: {
        id,
        OR: [
          {
            status: "RESERVED",
            classSchedule: { status: "SCHEDULED", endsAt: { gte: cancelledAt } },
          },
          { status: { in: ["COMPLETED", "NO_SHOW"] } },
        ],
      },
      data: {
        status: "CANCELLED",
        cancelledAt,
        cancelReason: result.data.cancelReason,
        cancelDetail: result.data.cancelDetail || null,
        cancelledById: principal.userId,
      },
    });

    if (updateResult.count === 0) {
      throw new ReservationNotCancellableError();
    }
  } catch (error) {
    if (error instanceof ReservationNotCancellableError) {
      return {
        formError: "이미 취소되었거나 취소할 수 없는 예약입니다.",
        values: readCancelReservationFormValues(formData),
      };
    }
    console.error(
      "[reservations] failed to cancel reservation:",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      formError: "예약 취소에 실패했습니다. 다시 시도해주세요.",
      values: readCancelReservationFormValues(formData),
    };
  }

  revalidatePath("/reservations");
  revalidatePath(`/reservations/${id}`);
  redirect(`/reservations/${id}`);
}
