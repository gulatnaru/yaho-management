import type { Prisma, PrismaClient } from "@prisma/client";
import { getCapacityState } from "@/lib/classes/capacity";
import { getClassDisplayStatus } from "@/lib/classes/status";
import { resolveReservationWriteMode } from "@/lib/reservations/capacity";
import {
  ChildNotActiveError,
  ChildNotFoundError,
  ClassNotFoundError,
  ClassNotScheduledError,
  DuplicateReservationError,
  OverbookingConfirmationRequiredError,
  TerminalReservationError,
} from "@/lib/reservations/errors";

// ADR-023: ClassSchedule 행 잠금 때문에 같은 클래스의 동시 요청은 커밋 순서대로 대기한다.
export const RESERVATION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export type CreateReservationCoreInput = {
  classScheduleId: string;
  childId: string;
  memo?: string;
  confirmOverbooking?: "true";
  confirmedClassScheduleId?: string;
  confirmedChildId?: string;
};

/**
 * 이미 열린 트랜잭션 안에서 예약을 쓴다. 예약 신청 확정(Phase 18)처럼 아이 생성·동의 기록과
 * 원자적으로 묶어야 하는 호출자가 사용한다. 검증 규칙은 createReservationCore 와 완전히 같다.
 */
export async function createReservationInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateReservationCoreInput,
): Promise<{ id: string }> {
  const [classRow] = await tx.$queryRaw<
    { status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; capacity: number; endsAt: Date }[]
  >`
    SELECT "status", "capacity", "endsAt" FROM "ClassSchedule" WHERE "id" = ${input.classScheduleId} FOR UPDATE
  `;
  if (!classRow) throw new ClassNotFoundError();
  if (classRow.status !== "SCHEDULED" || getClassDisplayStatus(classRow) !== "SCHEDULED") {
    throw new ClassNotScheduledError();
  }

  const child = await tx.child.findUnique({
    where: { id: input.childId },
    select: { isActive: true },
  });
  if (!child) throw new ChildNotFoundError();
  if (!child.isActive) throw new ChildNotActiveError();

  const existing = await tx.reservation.findUnique({
    where: {
      classScheduleId_childId: {
        classScheduleId: input.classScheduleId,
        childId: input.childId,
      },
    },
    select: { id: true, status: true },
  });
  const mode = resolveReservationWriteMode(existing?.status ?? null);
  if (mode === "BLOCKED_DUPLICATE") throw new DuplicateReservationError();
  if (mode === "BLOCKED_TERMINAL") throw new TerminalReservationError();

  const reservedCount = await tx.reservation.count({
    where: { classScheduleId: input.classScheduleId, status: "RESERVED" },
  });
  const capacityState = getCapacityState(classRow.capacity, reservedCount);
  const hasValidOverbookingConfirmation =
    input.confirmOverbooking === "true" &&
    input.confirmedClassScheduleId === input.classScheduleId &&
    input.confirmedChildId === input.childId;
  if (capacityState.status !== "AVAILABLE" && !hasValidOverbookingConfirmation) {
    throw new OverbookingConfirmationRequiredError(classRow.capacity, reservedCount);
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
}

/** 인증이 끝난 뒤 Server Action과 로컬 동시성 검증이 함께 사용하는 예약 쓰기 코어. */
export async function createReservationCore(
  client: PrismaClient,
  input: CreateReservationCoreInput,
): Promise<{ id: string }> {
  return client.$transaction(
    (tx) => createReservationInTransaction(tx, input),
    RESERVATION_TRANSACTION_OPTIONS,
  );
}
