import { describe, expect, it, vi } from "vitest";
import {
  createReservationCore,
  createReservationInTransaction,
  RESERVATION_TRANSACTION_OPTIONS,
} from "@/server/reservations/create";
import { OverbookingConfirmationRequiredError } from "@/lib/reservations/errors";

function createTx(options?: { reservedCount?: number; capacity?: number }) {
  return {
    $queryRaw: vi.fn(async () => [
      {
        status: "SCHEDULED",
        capacity: options?.capacity ?? 8,
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]),
    child: { findUnique: vi.fn(async () => ({ isActive: true })) },
    reservation: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => options?.reservedCount ?? 0),
      create: vi.fn(async () => ({ id: "reservation-1" })),
      update: vi.fn(),
    },
  };
}

describe("reservation write core composition", () => {
  it("createReservationCore opens one transaction with the ADR-023 options and delegates", async () => {
    const tx = createTx();
    const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual(RESERVATION_TRANSACTION_OPTIONS);
      return callback(tx);
    });

    const result = await createReservationCore({ $transaction: transaction } as never, {
      classScheduleId: "class-1",
      childId: "child-1",
    });

    expect(result).toEqual({ id: "reservation-1" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.reservation.create).toHaveBeenCalledTimes(1);
  });

  it("createReservationInTransaction applies the same capacity rule inside a caller transaction", async () => {
    const tx = createTx({ capacity: 2, reservedCount: 2 });

    await expect(
      createReservationInTransaction(tx as never, { classScheduleId: "class-1", childId: "child-1" }),
    ).rejects.toBeInstanceOf(OverbookingConfirmationRequiredError);
    expect(tx.reservation.create).not.toHaveBeenCalled();

    const confirmed = await createReservationInTransaction(tx as never, {
      classScheduleId: "class-1",
      childId: "child-1",
      confirmOverbooking: "true",
      confirmedClassScheduleId: "class-1",
      confirmedChildId: "child-1",
    });
    expect(confirmed).toEqual({ id: "reservation-1" });
  });
});
