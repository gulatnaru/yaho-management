import { describe, expect, it } from "vitest";
import { revenueFilterSchema } from "@/lib/validation/revenue";

describe("revenueFilterSchema", () => {
  it("accepts the supported GET filters", () => {
    expect(
      revenueFilterSchema.parse({
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
        programId: "program-1",
        classScheduleId: "class-1",
        paymentMethod: "CARD",
        refundState: "PARTIAL",
      }),
    ).toEqual({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      programId: "program-1",
      classScheduleId: "class-1",
      paymentMethod: "CARD",
      refundState: "PARTIAL",
    });
  });

  it("normalizes empty optional values and unknown enums", () => {
    expect(
      revenueFilterSchema.parse({ programId: "", classScheduleId: " ", paymentMethod: "COUPON", refundState: "X" }),
    ).toEqual({ paymentMethod: "all", refundState: "all" });
  });

  it("rejects malformed date strings", () => {
    expect(revenueFilterSchema.safeParse({ dateFrom: "2026/08/01" }).success).toBe(false);
  });
});
