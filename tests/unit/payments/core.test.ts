import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculatePaidAmount,
  createPaymentCore,
  createRefundCore,
  resolvePaymentStatus,
} from "@/lib/payments/core";
import {
  DuplicatePaymentError,
  NoShowRefundDetailRequiredError,
  RefundAmountExceededError,
} from "@/lib/payments/errors";

const transactionMock = vi.fn();
const reservationFindUniqueMock = vi.fn();
const paymentItemFindUniqueMock = vi.fn();
const paymentCreateMock = vi.fn();
const paymentItemCreateMock = vi.fn();
const queryRawMock = vi.fn();
const refundCreateMock = vi.fn();
const paymentItemUpdateMock = vi.fn();
const paymentItemAggregateMock = vi.fn();
const paymentUpdateMock = vi.fn();

const tx = {
  $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  reservation: { findUnique: (...args: unknown[]) => reservationFindUniqueMock(...args) },
  paymentItem: {
    findUnique: (...args: unknown[]) => paymentItemFindUniqueMock(...args),
    create: (...args: unknown[]) => paymentItemCreateMock(...args),
    update: (...args: unknown[]) => paymentItemUpdateMock(...args),
    aggregate: (...args: unknown[]) => paymentItemAggregateMock(...args),
  },
  payment: {
    create: (...args: unknown[]) => paymentCreateMock(...args),
    update: (...args: unknown[]) => paymentUpdateMock(...args),
  },
  refund: { create: (...args: unknown[]) => refundCreateMock(...args) },
};

const client = { $transaction: (...args: unknown[]) => transactionMock(...args) } as never;

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
});

describe("payment core", () => {
  it("calculates paidAmount only on the server", () => {
    expect(calculatePaidAmount(40000, 5000)).toBe(35000);
  });

  it("creates Payment and PaymentItem atomically with the calculated paidAmount", async () => {
    reservationFindUniqueMock.mockResolvedValue({ id: "reservation-1" });
    paymentItemFindUniqueMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({ id: "payment-1" });
    paymentItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await createPaymentCore(client, {
      reservationId: "reservation-1",
      amount: 40000,
      discountAmount: 5000,
      method: "CARD",
    });

    expect(result.paidAmount).toBe(35000);
    expect(paymentCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: 35000 }) }));
    expect(paymentItemCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paidAmount: 35000 }) }));
  });

  it("rejects a duplicate payment for the same reservation", async () => {
    reservationFindUniqueMock.mockResolvedValue({ id: "reservation-1" });
    paymentItemFindUniqueMock.mockResolvedValue({ id: "existing" });
    await expect(createPaymentCore(client, {
      reservationId: "reservation-1", amount: 10000, discountAmount: 0, method: "CASH",
    })).rejects.toBeInstanceOf(DuplicatePaymentError);
    expect(paymentCreateMock).not.toHaveBeenCalled();
  });
});

describe("refund core", () => {
  function lockedItem(
    status: "RESERVED" | "COMPLETED" | "NO_SHOW" | "CANCELLED",
    refundedAmount = 10000,
    attendance: "PRESENT" | "ABSENT" | null = null,
  ) {
    return [{ id: "item-1", paymentId: "payment-1", paidAmount: 40000, refundedAmount, reservationStatus: status, reservationAttendance: attendance }];
  }

  it.each(["RESERVED", "COMPLETED", "CANCELLED"] as const)("allows a manual refund for %s", async (status) => {
    queryRawMock.mockResolvedValue(lockedItem(status));
    refundCreateMock.mockResolvedValue({ id: "refund-1" });
    paymentItemAggregateMock.mockResolvedValue({ _sum: { paidAmount: 40000, refundedAmount: 20000 } });

    const result = await createRefundCore(client, {
      paymentItemId: "item-1", amount: 10000, reason: "OTHER", processedById: "admin-1",
    });

    expect(result.paymentStatus).toBe("PARTIAL_REFUNDED");
    expect(refundCreateMock).toHaveBeenCalled();
    expect(paymentItemUpdateMock).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { refundedAmount: 20000 } });
  });

  it("allows NO_SHOW only with detailed reason", async () => {
    queryRawMock.mockResolvedValue(lockedItem("NO_SHOW"));
    await expect(createRefundCore(client, {
      paymentItemId: "item-1", amount: 10000, reason: "OTHER", processedById: "admin-1",
    })).rejects.toBeInstanceOf(NoShowRefundDetailRequiredError);
    expect(refundCreateMock).not.toHaveBeenCalled();

    queryRawMock.mockResolvedValue(lockedItem("NO_SHOW"));
    refundCreateMock.mockResolvedValue({ id: "refund-1" });
    paymentItemAggregateMock.mockResolvedValue({ _sum: { paidAmount: 40000, refundedAmount: 20000 } });
    await expect(createRefundCore(client, {
      paymentItemId: "item-1", amount: 10000, reason: "OTHER", reasonDetail: "예외 환불", processedById: "admin-1",
    })).resolves.toMatchObject({ refundId: "refund-1" });
  });

  it("still requires detail after a NO_SHOW reservation is cancelled", async () => {
    queryRawMock.mockResolvedValue(lockedItem("CANCELLED", 10000, "ABSENT"));

    await expect(createRefundCore(client, {
      paymentItemId: "item-1", amount: 10000, reason: "OTHER", processedById: "admin-1",
    })).rejects.toBeInstanceOf(NoShowRefundDetailRequiredError);
    expect(refundCreateMock).not.toHaveBeenCalled();
  });

  it("rolls back before writes when cumulative refunds exceed paidAmount", async () => {
    queryRawMock.mockResolvedValue(lockedItem("CANCELLED", 35000));
    await expect(createRefundCore(client, {
      paymentItemId: "item-1", amount: 5001, reason: "OTHER", processedById: "admin-1",
    })).rejects.toBeInstanceOf(RefundAmountExceededError);
    expect(refundCreateMock).not.toHaveBeenCalled();
    expect(paymentItemUpdateMock).not.toHaveBeenCalled();
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("resolves payment statuses from aggregate item totals", () => {
    expect(resolvePaymentStatus(40000, 0)).toBe("PAID");
    expect(resolvePaymentStatus(40000, 10000)).toBe("PARTIAL_REFUNDED");
    expect(resolvePaymentStatus(40000, 40000)).toBe("REFUNDED");
  });
});
