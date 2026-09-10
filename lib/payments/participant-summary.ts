export type ParticipantPaymentStatus = "PAID" | "PARTIAL_REFUNDED" | "REFUNDED" | "CANCELLED";

export function getParticipantPaymentLabel(
  paymentStatus: ParticipantPaymentStatus | null | undefined,
): "결제완료" | "미결제" {
  if (
    paymentStatus === "PAID" ||
    paymentStatus === "PARTIAL_REFUNDED" ||
    paymentStatus === "REFUNDED"
  ) {
    return "결제완료";
  }
  return "미결제";
}
