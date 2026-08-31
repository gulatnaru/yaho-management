import { describe, expect, it } from "vitest";
import { canCancelReservation } from "@/lib/reservations/cancellation";

const endedClass = { status: "SCHEDULED" as const, endsAt: new Date("2020-01-01T00:00:00Z") };
const futureClass = { status: "SCHEDULED" as const, endsAt: new Date("2099-01-01T00:00:00Z") };

describe("canCancelReservation", () => {
  it("allows RESERVED only before its class ends", () => {
    expect(canCancelReservation({ status: "RESERVED" }, futureClass)).toBe(true);
    expect(canCancelReservation({ status: "RESERVED" }, endedClass)).toBe(false);
  });

  it("allows COMPLETED and NO_SHOW even after the class ends", () => {
    expect(canCancelReservation({ status: "COMPLETED" }, endedClass)).toBe(true);
    expect(canCancelReservation({ status: "NO_SHOW" }, endedClass)).toBe(true);
  });

  it("never allows an already CANCELLED reservation", () => {
    expect(canCancelReservation({ status: "CANCELLED" }, futureClass)).toBe(false);
  });
});
