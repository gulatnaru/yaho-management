import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DuplicatePaymentError,
  NoShowRefundDetailRequiredError,
  PaymentItemNotFoundError,
  RefundAmountExceededError,
  ReservationNotFoundError,
} from "@/lib/payments/errors";

export type PaymentMethodValue = "CARD" | "TRANSFER" | "CASH" | "OTHER";
export type RefundReasonValue =
  | "PERSONAL"
  | "ILLNESS"
  | "WEATHER"
  | "SCHEDULE"
  | "DUPLICATE_PAYMENT"
  | "CLASS_CANCELLED"
  | "OPERATION"
  | "OTHER";

const FINANCIAL_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export function calculatePaidAmount(amount: number, discountAmount: number) {
  return amount - discountAmount;
}

export function resolvePaymentStatus(totalPaid: number, totalRefunded: number) {
  if (totalRefunded <= 0) return "PAID" as const;
  if (totalRefunded >= totalPaid) return "REFUNDED" as const;
  return "PARTIAL_REFUNDED" as const;
}

export type CreatePaymentCoreInput = {
  reservationId: string;
  amount: number;
  discountAmount: number;
  method: PaymentMethodValue;
  payerName?: string;
  memo?: string;
};

export async function createPaymentCore(client: PrismaClient, input: CreatePaymentCoreInput) {
  try {
    return await client.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: input.reservationId },
        select: { id: true },
      });
      if (!reservation) throw new ReservationNotFoundError();

      const existing = await tx.paymentItem.findUnique({
        where: { reservationId: input.reservationId },
        select: { id: true },
      });
      if (existing) throw new DuplicatePaymentError();

      const paidAmount = calculatePaidAmount(input.amount, input.discountAmount);
      const payment = await tx.payment.create({
        data: {
          payerType: "GUARDIAN",
          payerName: input.payerName || null,
          method: input.method,
          status: "PAID",
          totalAmount: paidAmount,
          memo: input.memo || null,
        },
        select: { id: true },
      });
      const item = await tx.paymentItem.create({
        data: {
          paymentId: payment.id,
          reservationId: input.reservationId,
          amount: input.amount,
          discountAmount: input.discountAmount,
          paidAmount,
        },
        select: { id: true },
      });

      return { paymentId: payment.id, paymentItemId: item.id, paidAmount };
    }, FINANCIAL_TRANSACTION_OPTIONS);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicatePaymentError();
    }
    throw error;
  }
}

export type CreateRefundCoreInput = {
  paymentItemId: string;
  amount: number;
  reason: RefundReasonValue;
  reasonDetail?: string;
  processedById: string;
};

type LockedPaymentItem = {
  id: string;
  paymentId: string;
  paidAmount: number;
  refundedAmount: number;
  reservationStatus: "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  reservationAttendance: "PRESENT" | "ABSENT" | null;
};

export async function createRefundCore(client: PrismaClient, input: CreateRefundCoreInput) {
  return client.$transaction(async (tx) => {
    // ADR-007: 동일 PaymentItem 환불 요청을 직렬화한다. 예약 상태는 ADR-039에 따라
    // 환불 자격 조건으로 사용하지 않고, NO_SHOW 상세 사유 검증에만 사용한다.
    const [item] = await tx.$queryRaw<LockedPaymentItem[]>`
      SELECT pi."id", pi."paymentId", pi."paidAmount", pi."refundedAmount",
             r."status" AS "reservationStatus", r."attendance" AS "reservationAttendance"
      FROM "PaymentItem" pi
      JOIN "Reservation" r ON r."id" = pi."reservationId"
      WHERE pi."id" = ${input.paymentItemId}
      FOR UPDATE OF pi
    `;
    if (!item) throw new PaymentItemNotFoundError();

    const detail = input.reasonDetail?.trim() || "";
    // ADR-033에 따라 NO_SHOW가 CANCELLED로 바뀌어도 attendance=ABSENT 이력은 보존된다.
    // 따라서 취소 후 환불에서도 ADR-034의 노쇼 상세 사유 의무를 우회할 수 없다.
    if ((item.reservationStatus === "NO_SHOW" || item.reservationAttendance === "ABSENT") && !detail) {
      throw new NoShowRefundDetailRequiredError();
    }

    const nextRefundedAmount = item.refundedAmount + input.amount;
    if (input.amount <= 0 || nextRefundedAmount > item.paidAmount) {
      throw new RefundAmountExceededError();
    }

    const refund = await tx.refund.create({
      data: {
        paymentItemId: item.id,
        amount: input.amount,
        reason: input.reason,
        reasonDetail: detail || null,
        status: "COMPLETED",
        processedById: input.processedById,
      },
      select: { id: true },
    });
    await tx.paymentItem.update({
      where: { id: item.id },
      data: { refundedAmount: nextRefundedAmount },
    });

    const totals = await tx.paymentItem.aggregate({
      where: { paymentId: item.paymentId },
      _sum: { paidAmount: true, refundedAmount: true },
    });
    const totalPaid = totals._sum.paidAmount ?? 0;
    const totalRefunded = totals._sum.refundedAmount ?? 0;
    const paymentStatus = resolvePaymentStatus(totalPaid, totalRefunded);
    await tx.payment.update({
      where: { id: item.paymentId },
      data: { status: paymentStatus },
    });

    return {
      refundId: refund.id,
      paymentId: item.paymentId,
      refundedAmount: nextRefundedAmount,
      paymentStatus,
    };
  }, FINANCIAL_TRANSACTION_OPTIONS);
}
