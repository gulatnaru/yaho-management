export type ParticipantReservationStatus = "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
export type ParticipantAttendance = "PRESENT" | "ABSENT" | null;

export function groupClassParticipants<T extends { status: ParticipantReservationStatus }>(items: T[]) {
  return {
    participants: items.filter((item) => item.status !== "CANCELLED"),
    cancelled: items.filter((item) => item.status === "CANCELLED"),
  };
}

export function getAttendanceLabel(attendance: ParticipantAttendance): "참석" | "불참" | "출결 미처리" {
  if (attendance === "PRESENT") return "참석";
  if (attendance === "ABSENT") return "불참";
  return "출결 미처리";
}
