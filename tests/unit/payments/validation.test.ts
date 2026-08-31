import { describe, expect, it } from "vitest";
import { paymentInputSchema, refundInputSchema } from "@/lib/validation/payment";

const validPayment = {
  reservationId: "reservation-1",
  amount: "40000",
  discountAmount: "5000",
  method: "CARD",
};

describe("paymentInputSchema", () => {
  it("accepts administrator-entered discount and calculates with validated integer inputs", () => {
    const result = paymentInputSchema.parse(validPayment);
    expect(result.amount).toBe(40000);
    expect(result.discountAmount).toBe(5000);
  });

  it("accepts zero and full discounts", () => {
    expect(paymentInputSchema.safeParse({ ...validPayment, discountAmount: "0" }).success).toBe(true);
    expect(paymentInputSchema.safeParse({ ...validPayment, discountAmount: "40000" }).success).toBe(true);
  });

  it("rejects negative or over-price discounts", () => {
    expect(paymentInputSchema.safeParse({ ...validPayment, discountAmount: "-1" }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ ...validPayment, discountAmount: "40001" }).success).toBe(false);
  });

  it("rejects non-integer amounts", () => {
    expect(paymentInputSchema.safeParse({ ...validPayment, amount: "10.5" }).success).toBe(false);
  });
});

describe("refundInputSchema", () => {
  it("accepts a positive integer refund", () => {
    expect(refundInputSchema.safeParse({ paymentItemId: "item-1", amount: "10000", reason: "OTHER" }).success).toBe(true);
  });

  it("rejects zero, negative, and unknown reasons", () => {
    expect(refundInputSchema.safeParse({ paymentItemId: "item-1", amount: "0", reason: "OTHER" }).success).toBe(false);
    expect(refundInputSchema.safeParse({ paymentItemId: "item-1", amount: "-1", reason: "OTHER" }).success).toBe(false);
    expect(refundInputSchema.safeParse({ paymentItemId: "item-1", amount: "1", reason: "INVALID" }).success).toBe(false);
  });
});
