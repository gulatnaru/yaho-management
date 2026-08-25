import { getClassDisplayStatus } from "@/lib/classes/status";

/**
 * 아직 출결이 기록되지 않은 RESERVED 예약은 소속 클래스가 종료됐을 때 화면에서만
 * "종료"로 계산해서 보여준다. 출결이 기록된 COMPLETED/NO_SHOW는 실제 상태를 우선한다.
 * 취소된 예약(CANCELLED)은 클래스 상태와 무관하게 항상 "취소"로 표시한다.
 */
export type ReservationDisplayStatus = "RESERVED" | "CANCELLED" | "ENDED" | "COMPLETED" | "NO_SHOW";

export function getReservationDisplayStatus(
  reservation: { status: "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" },
  classSchedule: { status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; endsAt: Date },
  now: Date = new Date(),
): ReservationDisplayStatus {
  if (reservation.status === "CANCELLED") return "CANCELLED";
  if (reservation.status === "COMPLETED") return "COMPLETED";
  if (reservation.status === "NO_SHOW") return "NO_SHOW";
  const classDisplay = getClassDisplayStatus(classSchedule, now);
  if (classDisplay === "ENDED") return "ENDED";
  return "RESERVED";
}
