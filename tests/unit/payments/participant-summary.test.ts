import { describe, expect, it } from "vitest";
import { getParticipantPaymentLabel } from "@/lib/payments/participant-summary";

describe("participant payment summary", () => {
  it.each(["PAID", "PARTIAL_REFUNDED", "REFUNDED"] as const)(
    "shows %s as paid",
    (status) => expect(getParticipantPaymentLabel(status)).toBe("결제완료"),
  );

  it.each(["CANCELLED", null] as const)("shows %s as unpaid", (status) => {
    expect(getParticipantPaymentLabel(status)).toBe("미결제");
  });
});
