import { beforeEach, describe, expect, it, vi } from "vitest";

const paymentFindManyMock = vi.fn();
const paymentCountMock = vi.fn();
const paymentFindUniqueMock = vi.fn();
const paymentItemFindManyMock = vi.fn();
const paymentItemFindUniqueMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    payment: {
      findMany: (...args: unknown[]) => paymentFindManyMock(...args),
      count: (...args: unknown[]) => paymentCountMock(...args),
      findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args),
    },
    paymentItem: {
      findMany: (...args: unknown[]) => paymentItemFindManyMock(...args),
      findUnique: (...args: unknown[]) => paymentItemFindUniqueMock(...args),
    },
  },
}));

const { getPaymentDetail, getRefundRegistrationContext, listPaymentItemsByChild, listPayments } = await import("@/lib/payments/queries");

beforeEach(() => {
  vi.clearAllMocks();
  paymentFindManyMock.mockResolvedValue([]);
  paymentCountMock.mockResolvedValue(0);
  paymentFindUniqueMock.mockResolvedValue(null);
  paymentItemFindManyMock.mockResolvedValue([]);
  paymentItemFindUniqueMock.mockResolvedValue(null);
});

describe("payment queries", () => {
  it("paginates payments and explicitly selects reservation context", async () => {
    await listPayments(2);

    const [[callArg]] = paymentFindManyMock.mock.calls;
    expect(callArg).toEqual(expect.objectContaining({ skip: 20, take: 20, orderBy: { paidAt: "desc" } }));
    expect(callArg.select.items.select.reservation.select).toEqual(
      expect.objectContaining({
        id: true,
        status: true,
        child: { select: { id: true, name: true } },
      }),
    );
    expect(callArg.select.items.select.reservation.select.child.select).not.toHaveProperty("safetyInfo");
  });

  it("loads refund history and processor without selecting unrelated personal fields", async () => {
    await getPaymentDetail("payment-1");

    const [[callArg]] = paymentFindUniqueMock.mock.calls;
    expect(callArg.select.items.select.refunds.select).toEqual(
      expect.objectContaining({
        amount: true,
        reason: true,
        reasonDetail: true,
        processedBy: { select: { id: true, name: true } },
      }),
    );
    expect(callArg.select.items.select.reservation.select.child.select).toEqual({ id: true, name: true });
  });

  it("loads child payment history in one bounded query", async () => {
    await listPaymentItemsByChild("child-1");

    expect(paymentItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reservation: { childId: "child-1" } },
        orderBy: { payment: { paidAt: "desc" } },
      }),
    );
  });

  it("selects attendance only for refund eligibility context", async () => {
    await getRefundRegistrationContext("item-1");

    const [[callArg]] = paymentItemFindUniqueMock.mock.calls;
    expect(callArg.select.reservation.select.attendance).toBe(true);
    expect(paymentFindManyMock).not.toHaveBeenCalled();
  });
});
