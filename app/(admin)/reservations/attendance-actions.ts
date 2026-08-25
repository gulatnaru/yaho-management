"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import {
  AttendanceNotRecordableError,
  ClassNotEndedError,
  correctAttendanceCore,
  recordAttendanceCore,
} from "@/lib/reservations/attendance";

const attendanceInputSchema = z.object({
  reservationId: z.string().trim().min(1),
  attendance: z.enum(["PRESENT", "ABSENT"]),
});

export type AttendanceFormState = { error?: string; success?: boolean };

export async function recordAttendanceAction(
  _previousState: AttendanceFormState,
  formData: FormData,
): Promise<AttendanceFormState> {
  const session = await requireAdmin();
  const parsed = attendanceInputSchema.safeParse({
    reservationId: formData.get("reservationId"),
    attendance: formData.get("attendance"),
  });
  if (!parsed.success) return { error: "출결 값을 확인해 주세요." };

  const reservation = await prisma.reservation.findUnique({
    where: { id: parsed.data.reservationId },
    select: { classScheduleId: true, status: true, classSchedule: { select: { endsAt: true } } },
  });
  if (!reservation) return { error: "예약을 찾을 수 없습니다." };

  try {
    const input = { ...parsed.data, recordedById: session.user.id, classEndsAt: reservation.classSchedule.endsAt };
    if (reservation.status === "RESERVED") {
      await recordAttendanceCore(prisma, input);
    } else if (reservation.status === "COMPLETED" || reservation.status === "NO_SHOW") {
      await correctAttendanceCore(prisma, input);
    } else {
      throw new AttendanceNotRecordableError();
    }
  } catch (error) {
    if (error instanceof ClassNotEndedError) {
      return { error: "아직 진행 중이거나 시작 전인 클래스는 출결을 기록할 수 없습니다." };
    }
    if (error instanceof AttendanceNotRecordableError) {
      return { error: "취소된 예약의 출결은 기록할 수 없습니다." };
    }
    // 예약 ID나 DB 오류 세부정보는 로그에 남기지 않는다(개인정보 최소화 원칙).
    console.error("[attendance] failed to record attendance");
    return { error: "출결 기록에 실패했습니다. 다시 시도해 주세요." };
  }

  revalidatePath(`/classes/${reservation.classScheduleId}`);
  revalidatePath(`/reservations/${parsed.data.reservationId}`);
  revalidatePath("/reservations");
  return { success: true };
}
