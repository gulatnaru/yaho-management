import type { PaymentStatus } from "@prisma/client";

const CHILD_HISTORY_PAYMENT_LABELS = {
  PAID: "결제완료",
  PARTIAL_REFUNDED: "부분환불",
  REFUNDED: "전액환불",
  CANCELLED: "미결제",
} as const satisfies Record<PaymentStatus, string>;

export type ChildHistoryPaymentLabel =
  (typeof CHILD_HISTORY_PAYMENT_LABELS)[PaymentStatus];

export function getChildHistoryPaymentLabel(
  status: PaymentStatus | null | undefined,
): ChildHistoryPaymentLabel {
  return status ? CHILD_HISTORY_PAYMENT_LABELS[status] : "미결제";
}
