/**
 * 클래스 "종료" 여부는 DB 에 쓰지 않는다. ClassSchedule.status 는 계속 SCHEDULED 로 남아 있고,
 * endsAt 이 현재 시각보다 과거면 화면에서만 "종료됨"으로 계산해서 보여준다.
 * (analyst 확정 결정: docs/DECISIONS.md 참고 — 이 파일에서는 로직만 구현한다.)
 */
export type ClassDisplayStatus = "SCHEDULED" | "CANCELLED" | "ENDED";

export function getClassDisplayStatus(
  classSchedule: { status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; endsAt: Date },
  now: Date = new Date(),
): ClassDisplayStatus {
  if (classSchedule.status === "CANCELLED") return "CANCELLED";
  if (classSchedule.endsAt < now) return "ENDED";
  return "SCHEDULED";
}
