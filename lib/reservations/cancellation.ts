import { getReservationDisplayStatus } from "@/lib/reservations/status";

type ReservationStatusValue = "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
type ClassStatusValue = "SCHEDULED" | "CANCELLED" | "COMPLETED";

export function canCancelReservation(
  reservation: { status: ReservationStatusValue },
  classSchedule: { status: ClassStatusValue; endsAt: Date },
  now: Date = new Date(),
) {
  if (reservation.status === "COMPLETED" || reservation.status === "NO_SHOW") return true;
  if (reservation.status !== "RESERVED") return false;
  return getReservationDisplayStatus(reservation, classSchedule, now) === "RESERVED";
}
