import { describe, expect, it } from "vitest";
import { canCancelReservation } from "@/lib/reservations/cancellation";

const NOW = new Date("2026-09-12T03:00:00.000Z");
const endedClass = { status: "SCHEDULED" as const, endsAt: new Date(NOW.getTime() - 1) };
const endingNowClass = { status: "SCHEDULED" as const, endsAt: NOW };
const futureClass = { status: "SCHEDULED" as const, endsAt: new Date(NOW.getTime() + 1) };
const cancelledFutureClass = { ...futureClass, status: "CANCELLED" as const };

describe("canCancelReservation", () => {
  it("allows RESERVED only for a scheduled class whose inclusive end boundary has not passed", () => {
    expect(canCancelReservation({ status: "RESERVED" }, futureClass, NOW)).toBe(true);
    expect(canCancelReservation({ status: "RESERVED" }, endingNowClass, NOW)).toBe(true);
    expect(canCancelReservation({ status: "RESERVED" }, endedClass, NOW)).toBe(false);
  });

  it("rejects RESERVED when its class is cancelled", () => {
    expect(canCancelReservation({ status: "RESERVED" }, cancelledFutureClass, NOW)).toBe(false);
  });

  it("allows COMPLETED and NO_SHOW even after the class ends", () => {
    expect(canCancelReservation({ status: "COMPLETED" }, endedClass, NOW)).toBe(true);
    expect(canCancelReservation({ status: "NO_SHOW" }, endedClass, NOW)).toBe(true);
  });

  it("never allows an already CANCELLED reservation", () => {
    expect(canCancelReservation({ status: "CANCELLED" }, futureClass, NOW)).toBe(false);
  });
});
