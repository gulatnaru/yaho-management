import { describe, expect, it } from "vitest";
import { cancelReservationInputSchema, reservationInputSchema } from "@/lib/validation/reservation";

describe("reservationInputSchema", () => {
  it("accepts a valid input with memo", () => {
    const result = reservationInputSchema.safeParse({
      classScheduleId: "class-1",
      childId: "child-1",
      memo: "메모",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid input without memo", () => {
    const result = reservationInputSchema.safeParse({
      classScheduleId: "class-1",
      childId: "child-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing classScheduleId", () => {
    const result = reservationInputSchema.safeParse({ classScheduleId: "", childId: "child-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing childId", () => {
    const result = reservationInputSchema.safeParse({ classScheduleId: "class-1", childId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only classScheduleId", () => {
    const result = reservationInputSchema.safeParse({ classScheduleId: "   ", childId: "child-1" });
    expect(result.success).toBe(false);
  });
});

describe("cancelReservationInputSchema", () => {
  it.each(["PERSONAL", "ILLNESS", "SCHEDULE", "WEATHER", "DUPLICATE", "OPERATION", "OTHER"])(
    "accepts valid cancelReason %s",
    (cancelReason) => {
      const result = cancelReservationInputSchema.safeParse({ cancelReason });
      expect(result.success).toBe(true);
    },
  );

  it("accepts an optional cancelDetail", () => {
    const result = cancelReservationInputSchema.safeParse({ cancelReason: "OTHER", cancelDetail: "상세" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing cancelReason", () => {
    const result = cancelReservationInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an unknown cancelReason code", () => {
    const result = cancelReservationInputSchema.safeParse({ cancelReason: "NOT_A_REAL_REASON" });
    expect(result.success).toBe(false);
  });
});
