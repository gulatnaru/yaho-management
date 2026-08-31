import { prisma } from "@/lib/db/prisma";

export const PAYMENT_LIST_PAGE_SIZE = 20;

const PAYMENT_ITEM_CONTEXT_SELECT = {
  id: true,
  amount: true,
  discountAmount: true,
  paidAmount: true,
  refundedAmount: true,
  reservation: {
    select: {
      id: true,
      status: true,
      child: { select: { id: true, name: true } },
      classSchedule: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          program: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

export async function listPayments(page = 1) {
  const safePage = page > 0 ? page : 1;
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      select: {
        id: true,
        status: true,
        method: true,
        paidAt: true,
        totalAmount: true,
        items: { select: PAYMENT_ITEM_CONTEXT_SELECT },
      },
      orderBy: { paidAt: "desc" },
      skip: (safePage - 1) * PAYMENT_LIST_PAGE_SIZE,
      take: PAYMENT_LIST_PAGE_SIZE,
    }),
    prisma.payment.count(),
  ]);
  return {
    payments,
    total,
    page: safePage,
    pageSize: PAYMENT_LIST_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAYMENT_LIST_PAGE_SIZE)),
  };
}

export async function getPaymentDetail(id: string) {
  return prisma.payment.findUnique({
    where: { id },
    select: {
      id: true,
      payerName: true,
      method: true,
      status: true,
      paidAt: true,
      totalAmount: true,
      memo: true,
      items: {
        select: {
          ...PAYMENT_ITEM_CONTEXT_SELECT,
          refunds: {
            select: {
              id: true,
              amount: true,
              reason: true,
              reasonDetail: true,
              status: true,
              refundedAt: true,
              processedBy: { select: { id: true, name: true } },
            },
            orderBy: { refundedAt: "desc" as const },
          },
        },
      },
    },
  });
}

export async function getPaymentRegistrationContext(reservationId: string) {
  return prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      status: true,
      child: { select: { id: true, name: true, guardianName: true } },
      classSchedule: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          program: { select: { name: true } },
        },
      },
      paymentItem: { select: { paymentId: true } },
    },
  });
}

export async function getRefundRegistrationContext(paymentItemId: string) {
  return prisma.paymentItem.findUnique({
    where: { id: paymentItemId },
    select: {
      ...PAYMENT_ITEM_CONTEXT_SELECT,
      reservation: {
        select: {
          ...PAYMENT_ITEM_CONTEXT_SELECT.reservation.select,
          attendance: true,
        },
      },
      payment: { select: { id: true, status: true, method: true } },
    },
  });
}

export async function listPaymentItemsByChild(childId: string) {
  return prisma.paymentItem.findMany({
    where: { reservation: { childId } },
    select: {
      ...PAYMENT_ITEM_CONTEXT_SELECT,
      payment: { select: { id: true, status: true, method: true, paidAt: true } },
      refunds: {
        select: { id: true, amount: true, reason: true, reasonDetail: true, refundedAt: true, status: true },
        orderBy: { refundedAt: "desc" },
      },
    },
    orderBy: { payment: { paidAt: "desc" } },
  });
}
