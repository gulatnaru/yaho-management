export const CLASS_CAPACITY_MIN = 1;
export const CLASS_CAPACITY_DEFAULT = 8;
export const CLASS_CAPACITY_MAX = 99;

export type CapacityState =
  | { status: "AVAILABLE"; remainingSeats: number; overCapacityBy: 0 }
  | { status: "FULL"; remainingSeats: 0; overCapacityBy: 0 }
  | { status: "OVER_CAPACITY"; remainingSeats: number; overCapacityBy: number };

/** RESERVED 예약 수만 전달받아 좌석 상태를 계산한다. */
export function getCapacityState(capacity: number, reservedCount: number): CapacityState {
  const remainingSeats = capacity - reservedCount;

  if (remainingSeats > 0) {
    return { status: "AVAILABLE", remainingSeats, overCapacityBy: 0 };
  }
  if (remainingSeats === 0) {
    return { status: "FULL", remainingSeats: 0, overCapacityBy: 0 };
  }
  return { status: "OVER_CAPACITY", remainingSeats, overCapacityBy: Math.abs(remainingSeats) };
}

export function formatCapacityState(capacity: number, reservedCount: number): string {
  const state = getCapacityState(capacity, reservedCount);

  if (state.status === "AVAILABLE") return `잔여 ${state.remainingSeats}석`;
  if (state.status === "FULL") return "만석";
  return `정원 초과 ${state.overCapacityBy}명`;
}
