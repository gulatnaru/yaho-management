import { describe, expect, it } from "vitest";
import { resolveReservationWriteMode } from "@/lib/reservations/capacity";

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
