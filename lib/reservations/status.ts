import { getClassDisplayStatus } from "@/lib/classes/status";

/**
 * 예약 "종료" 여부도 DB 에 쓰지 않는다. Reservation.status 는 계속 RESERVED 로 남아 있고,
 * 소속 클래스가 종료됐으면(getClassDisplayStatus 기준) 화면에서만 "종료"로 계산해서 보여준다.
 * 단 예약이 이미 취소된 경우(CANCELLED)는 클래스 상태와 무관하게 항상 "취소"로 표시한다.
 * (analyst 확정 결정: docs/DECISIONS.md 참고 — 이 파일에서는 로직만 구현한다.)
 */
export type ReservationDisplayStatus = "RESERVED" | "CANCELLED" | "ENDED";

export function getReservationDisplayStatus(
  reservation: { status: "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" },
  classSchedule: { status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; endsAt: Date },
  now: Date = new Date(),
): ReservationDisplayStatus {
  if (reservation.status === "CANCELLED") return "CANCELLED";
  const classDisplay = getClassDisplayStatus(classSchedule, now);
  if (classDisplay === "ENDED") return "ENDED";
  return "RESERVED";
}
