"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/authorization";
import { hasCapacity, resolveReservationWriteMode } from "@/lib/reservations/capacity";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import { getClassDisplayStatus } from "@/lib/classes/status";
import {
  cancelReservationInputSchema,
  reservationInputSchema,
} from "@/lib/validation/reservation";
import {
  CapacityFullError,
  ChildNotActiveError,
  ChildNotFoundError,
  ClassNotFoundError,
  ClassNotScheduledError,
  DuplicateReservationError,
  TerminalReservationError,
} from "@/lib/reservations/errors";

// "use server" 파일은 async 함수만 export 할 수 있어, createReservationCore 가 던지는 에러
// 클래스들은 lib/reservations/errors.ts 에 정의하고 여기서는 가져와서만 쓴다(재수출하지 않는다).
class ReservationNotCancellableError extends Error {}

// ADR-023: ClassSchedule 행 잠금(FOR UPDATE) 때문에 동시 요청은 커밋 순서대로 직렬화되어 대기한다.
// Prisma 기본값(maxWait 2s / timeout 5s)은 원격 DB(Supabase) 왕복 지연이 있는 환경에서 클래스당
// 최대 8명(capacity 상한, ADR-004)이 동시에 몰리는 최악의 경우 대기 중인 트랜잭션이 timeout 에
// 걸려 "Transaction not found" 같은 불투명한 인프라 에러로 실패할 수 있음을 실측 검증 스크립트로
// 확인했다(정원 자체는 초과되지 않았다 — 대기가 timeout 을 넘긴 트랜잭션만 실패). 대기 여유를
// 넉넉히 준다.
const RESERVATION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export type CreateReservationCoreInput = {
  classScheduleId: string;
  childId: string;
  memo?: string;
};

/**
 * 예약 생성/재활성화의 실제 트랜잭션 로직.
 * requireAdmin() 을 호출하지 않는다 — 인증은 이미 됐다고 가정한다. Server Action(createReservation)
 * 이 얇은 wrapper 로 이 함수를 감싼다. 이렇게 분리하는 이유는, Next.js 요청 컨텍스트 없이도 실제
 * DB 에 대고 동시 요청(Promise.all)을 재현하는 검증 스크립트가 이 함수를 직접 여러 번 병렬 호출할
 * 수 있게 하기 위함이다.
 *
 * ADR-023: ClassSchedule 행을 SELECT ... FOR UPDATE 로 잠그고, 같은 트랜잭션 안에서 RESERVED
 * 예약 수를 세어 capacity 와 비교한 뒤 예약을 쓴다. 카운터 컬럼을 두지 않는다.
 * ADR-024: 기존 (classScheduleId, childId) 행이 CANCELLED 면 새 행을 만들지 않고 재활성화한다.
 * ADR-025: 비활성 아이의 신규 예약은 서버가 하드 블로킹한다.
 */
export async function createReservationCore(
  client: PrismaClient,
  input: CreateReservationCoreInput,
  // 현재 Reservation 모델에는 createdById 류 필드가 없어 예약 생성 자체에는 쓰이지 않는다.
  // 검증 스크립트가 인증 컨텍스트 없이 이 함수를 직접 호출할 수 있도록 시그니처만 예약해둔다.
  actorContext?: { userId: string },
): Promise<{ id: string }> {
  void actorContext;
  return client.$transaction(async (tx) => {
    const [classRow] = await tx.$queryRaw<
      { status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; capacity: number; endsAt: Date }[]
    >`
      SELECT "status", "capacity", "endsAt" FROM "ClassSchedule" WHERE "id" = ${input.classScheduleId} FOR UPDATE
    `;
    if (!classRow) {
      throw new ClassNotFoundError();
    }
    if (classRow.status !== "SCHEDULED") {
      throw new ClassNotScheduledError();
    }
    // ADR-026/027: DB status 는 클래스가 끝나도 SCHEDULED 로 남는다 — endsAt 을 함께 봐야
    // 이미 종료된(표시상 ENDED) 클래스에 새로 예약하는 것도 취소/완료된 클래스와 동일하게 막을 수 있다.
    if (getClassDisplayStatus(classRow) !== "SCHEDULED") {
      throw new ClassNotScheduledError();
    }

    const child = await tx.child.findUnique({
      where: { id: input.childId },
      select: { isActive: true },
    });
    if (!child) {
      throw new ChildNotFoundError();
    }
    if (!child.isActive) {
      throw new ChildNotActiveError();
    }

    const existing = await tx.reservation.findUnique({
      where: {
        classScheduleId_childId: { classScheduleId: input.classScheduleId, childId: input.childId },
      },
      select: { id: true, status: true },
    });
    const mode = resolveReservationWriteMode(existing?.status ?? null);
    if (mode === "BLOCKED_DUPLICATE") {
      throw new DuplicateReservationError();
    }
    if (mode === "BLOCKED_TERMINAL") {
      throw new TerminalReservationError();
    }

    const reservedCount = await tx.reservation.count({
      where: { classScheduleId: input.classScheduleId, status: "RESERVED" },
    });
    if (!hasCapacity(reservedCount, classRow.capacity)) {
      throw new CapacityFullError();
    }

    if (mode === "CREATE") {
      return tx.reservation.create({
        data: {
          classScheduleId: input.classScheduleId,
          childId: input.childId,
          memo: input.memo || null,
          status: "RESERVED",
        },
        select: { id: true },
      });
    }

    // REACTIVATE: 기존 취소 이력 필드는 초기화한다(ADR-024, 이전 취소 이력은 보존하지 않는다).
    return tx.reservation.update({
      where: { id: existing!.id },
      data: {
        status: "RESERVED",
        reservedAt: new Date(),
        memo: input.memo || null,
        cancelledAt: null,
        cancelReason: null,
        cancelDetail: null,
        cancelledById: null,
      },
      select: { id: true },
    });
  }, RESERVATION_TRANSACTION_OPTIONS);
}

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
  await requireAdmin();

  const result = reservationInputSchema.safeParse({
    classScheduleId: formData.get("classScheduleId"),
    childId: formData.get("childId"),
    memo: formData.get("memo") || undefined,
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
    if (error instanceof CapacityFullError) {
      return {
        formError: "정원이 가득 찼습니다.",
        values: readReservationFormValues(formData),
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
  const session = await requireAdmin();

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
        cancelledById: session.user.id,
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
