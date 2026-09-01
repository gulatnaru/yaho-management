import type { AttendanceStatus, ReservationStatus } from "@prisma/client";

export function getDashboardReservationLabel(status: ReservationStatus, attendance: AttendanceStatus | null) {
  if (status === "CANCELLED" && attendance === "PRESENT") return "참여완료 후 취소";
  if (status === "CANCELLED" && attendance === "ABSENT") return "노쇼 후 취소";
  if (status === "COMPLETED") return "참여완료";
  if (status === "NO_SHOW") return "노쇼";
  if (status === "RESERVED") return "예약됨";
  return "취소";
}
