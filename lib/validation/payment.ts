import { z } from "zod";

const integerAmount = z.coerce.number().int("금액은 원 단위 정수로 입력해주세요.");

export const paymentInputSchema = z
  .object({
    reservationId: z.string().trim().min(1, "예약을 선택해주세요."),
    amount: integerAmount.min(0, "정가는 0원 이상이어야 합니다."),
    discountAmount: integerAmount.min(0, "할인금액은 0원 이상이어야 합니다."),
    method: z.enum(["CARD", "TRANSFER", "CASH", "OTHER"], {
      required_error: "결제수단을 선택해주세요.",
    }),
    payerName: z.string().trim().optional(),
    memo: z.string().trim().optional(),
  })
  .refine((value) => value.discountAmount <= value.amount, {
    path: ["discountAmount"],
    message: "할인금액은 정가를 초과할 수 없습니다.",
  });

export const refundInputSchema = z.object({
  paymentItemId: z.string().trim().min(1, "결제 항목을 찾을 수 없습니다."),
  amount: integerAmount.min(1, "환불금액은 1원 이상이어야 합니다."),
  reason: z.enum([
    "PERSONAL",
    "ILLNESS",
    "WEATHER",
    "SCHEDULE",
    "DUPLICATE_PAYMENT",
    "CLASS_CANCELLED",
    "OPERATION",
    "OTHER",
  ]),
  reasonDetail: z.string().trim().optional(),
});
