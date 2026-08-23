/**
 * 예약 정원/쓰기 모드 판정 순수 함수. DB 에 접근하지 않는다.
 * ADR-023: 정원 동시성 제어는 ClassSchedule 행 잠금(SELECT ... FOR UPDATE) + COUNT 비교로 처리한다.
 * ADR-024: 취소된 예약에 대한 재예약은 새 행이 아니라 기존 행을 RESERVED 로 되돌린다.
 */

/** reservedCount(현재 RESERVED 예약 수)가 capacity 미만이면 자리가 있다. */
export function hasCapacity(reservedCount: number, capacity: number): boolean {
  return reservedCount < capacity;
}

export type ReservationWriteMode = "CREATE" | "REACTIVATE" | "BLOCKED_DUPLICATE" | "BLOCKED_TERMINAL";

export type ExistingReservationStatus = "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | null;

/**
 * 같은 (classScheduleId, childId) 조합의 기존 예약 상태를 보고 이번 요청을 어떻게 처리할지 정한다.
 * - 기존 행이 없으면 새로 생성한다.
 * - CANCELLED 였으면 재활성화(REACTIVATE)한다 — 새 행을 만들지 않는다(ADR-024).
 * - RESERVED 면 중복 예약으로 차단한다.
 * - COMPLETED/NO_SHOW 처럼 이미 종료된 예약이면 차단한다.
 */
export function resolveReservationWriteMode(existingStatus: ExistingReservationStatus): ReservationWriteMode {
  if (existingStatus === null) return "CREATE";
  if (existingStatus === "CANCELLED") return "REACTIVATE";
  if (existingStatus === "RESERVED") return "BLOCKED_DUPLICATE";
  return "BLOCKED_TERMINAL"; // COMPLETED | NO_SHOW
}
