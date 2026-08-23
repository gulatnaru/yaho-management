import { describe, expect, it } from "vitest";
import { hasCapacity, resolveReservationWriteMode } from "@/lib/reservations/capacity";

describe("hasCapacity", () => {
  it("returns true when reservedCount is one below capacity (last available seat)", () => {
    expect(hasCapacity(7, 8)).toBe(true);
  });

  it("returns false when reservedCount equals capacity (full)", () => {
    expect(hasCapacity(8, 8)).toBe(false);
  });

  it("returns false when reservedCount exceeds capacity", () => {
    expect(hasCapacity(9, 8)).toBe(false);
  });

  it("returns true when reservedCount is 0 and capacity is 1", () => {
    expect(hasCapacity(0, 1)).toBe(true);
  });
});

describe("resolveReservationWriteMode", () => {
  it("returns CREATE when there is no existing reservation", () => {
    expect(resolveReservationWriteMode(null)).toBe("CREATE");
  });

  it("returns REACTIVATE when the existing reservation was CANCELLED", () => {
    expect(resolveReservationWriteMode("CANCELLED")).toBe("REACTIVATE");
  });

  it("returns BLOCKED_DUPLICATE when the existing reservation is still RESERVED", () => {
    expect(resolveReservationWriteMode("RESERVED")).toBe("BLOCKED_DUPLICATE");
  });

  it("returns BLOCKED_TERMINAL when the existing reservation is COMPLETED", () => {
    expect(resolveReservationWriteMode("COMPLETED")).toBe("BLOCKED_TERMINAL");
  });

  it("returns BLOCKED_TERMINAL when the existing reservation is NO_SHOW", () => {
    expect(resolveReservationWriteMode("NO_SHOW")).toBe("BLOCKED_TERMINAL");
  });
});
