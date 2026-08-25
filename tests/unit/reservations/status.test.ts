import { describe, expect, it } from "vitest";
import { getReservationDisplayStatus } from "@/lib/reservations/status";

const now = new Date("2026-08-23T12:00:00Z");
const futureClass = { status: "SCHEDULED" as const, endsAt: new Date("2026-08-24T12:00:00Z") };
const pastClass = { status: "SCHEDULED" as const, endsAt: new Date("2026-08-01T12:00:00Z") };
const cancelledClass = { status: "CANCELLED" as const, endsAt: new Date("2026-08-24T12:00:00Z") };

describe("getReservationDisplayStatus", () => {
  it("returns CANCELLED when the reservation itself is cancelled, regardless of class status", () => {
    expect(getReservationDisplayStatus({ status: "CANCELLED" }, futureClass, now)).toBe("CANCELLED");
    expect(getReservationDisplayStatus({ status: "CANCELLED" }, pastClass, now)).toBe("CANCELLED");
    expect(getReservationDisplayStatus({ status: "CANCELLED" }, cancelledClass, now)).toBe("CANCELLED");
  });

  it("returns ENDED when RESERVED but the class has ended", () => {
    expect(getReservationDisplayStatus({ status: "RESERVED" }, pastClass, now)).toBe("ENDED");
  });

  it("returns RESERVED when RESERVED and the class is still scheduled", () => {
    expect(getReservationDisplayStatus({ status: "RESERVED" }, futureClass, now)).toBe("RESERVED");
  });

  it("preserves actual COMPLETED and NO_SHOW attendance states", () => {
    expect(getReservationDisplayStatus({ status: "COMPLETED" }, futureClass, now)).toBe("COMPLETED");
    expect(getReservationDisplayStatus({ status: "NO_SHOW" }, futureClass, now)).toBe("NO_SHOW");
  });
});
