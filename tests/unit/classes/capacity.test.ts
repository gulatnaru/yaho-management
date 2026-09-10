import { describe, expect, it } from "vitest";
import {
  CLASS_CAPACITY_DEFAULT,
  CLASS_CAPACITY_MAX,
  CLASS_CAPACITY_MIN,
  formatCapacityState,
  getCapacityState,
} from "@/lib/classes/capacity";

describe("class capacity", () => {
  it("keeps the minimum, default, and maximum as separate policy constants", () => {
    expect(CLASS_CAPACITY_MIN).toBe(1);
    expect(CLASS_CAPACITY_DEFAULT).toBe(8);
    expect(CLASS_CAPACITY_MAX).toBe(99);
  });

  it.each([
    [8, 0, { status: "AVAILABLE", remainingSeats: 8, overCapacityBy: 0 }, "잔여 8석"],
    [8, 7, { status: "AVAILABLE", remainingSeats: 1, overCapacityBy: 0 }, "잔여 1석"],
    [8, 8, { status: "FULL", remainingSeats: 0, overCapacityBy: 0 }, "만석"],
    [8, 9, { status: "OVER_CAPACITY", remainingSeats: -1, overCapacityBy: 1 }, "정원 초과 1명"],
  ] as const)("capacity=%i, reserved=%i 상태를 계산한다", (capacity, reservedCount, expected, label) => {
    expect(getCapacityState(capacity, reservedCount)).toEqual(expected);
    expect(formatCapacityState(capacity, reservedCount)).toBe(label);
  });
});
