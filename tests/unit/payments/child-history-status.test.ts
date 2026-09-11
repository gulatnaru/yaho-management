import { describe, expect, it } from "vitest";
import { getChildHistoryPaymentLabel } from "@/lib/payments/child-history-status";

describe("child history payment status", () => {
  it.each([
    ["PAID", "결제완료"],
    ["PARTIAL_REFUNDED", "부분환불"],
    ["REFUNDED", "전액환불"],
    ["CANCELLED", "미결제"],
    [null, "미결제"],
    [undefined, "미결제"],
  ] as const)("maps %s without changing the Phase 12 summary", (status, label) => {
    expect(getChildHistoryPaymentLabel(status)).toBe(label);
  });
});
