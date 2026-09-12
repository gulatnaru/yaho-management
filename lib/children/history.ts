import type { ClassStatus, ReservationStatus } from "@prisma/client";
import { getClassDisplayStatus } from "@/lib/classes/status";

export const CHILD_HISTORY_PAGE_SIZE = 10;
export const MAX_CHILD_HISTORY_PAGE = 100;

const RESERVATION_LABELS = {
  RESERVED: "예약됨",
  CANCELLED: "예약 취소",
  COMPLETED: "참여완료",
  NO_SHOW: "노쇼",
} as const satisfies Record<ReservationStatus, string>;

export type ChildHistoryClassLabel = "수업 예정" | "수업 완료" | "수업 취소";
export type ChildHistoryReservationLabel = (typeof RESERVATION_LABELS)[ReservationStatus];

export function getChildHistoryClassLabel(
  classSchedule: { status: ClassStatus; endsAt: Date },
  now: Date,
): ChildHistoryClassLabel {
  const status = getClassDisplayStatus(classSchedule, now);
  if (status === "CANCELLED") return "수업 취소";
  if (status === "ENDED") return "수업 완료";
  return "수업 예정";
}

export function getChildHistoryReservationLabel(
  status: ReservationStatus,
): ChildHistoryReservationLabel {
  return RESERVATION_LABELS[status];
}
