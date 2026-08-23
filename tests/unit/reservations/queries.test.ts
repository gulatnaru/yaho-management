import { beforeEach, describe, expect, it, vi } from "vitest";

const reservationFindManyMock = vi.fn();
const reservationCountMock = vi.fn();
const reservationFindUniqueMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: {
      findMany: (...args: unknown[]) => reservationFindManyMock(...args),
      count: (...args: unknown[]) => reservationCountMock(...args),
      findUnique: (...args: unknown[]) => reservationFindUniqueMock(...args),
    },
  },
}));

const { listReservations, getReservationDetail } = await import("@/lib/reservations/queries");

describe("listReservations", () => {
  beforeEach(() => {
    reservationFindManyMock.mockReset();
    reservationCountMock.mockReset();
    reservationFindManyMock.mockResolvedValue([]);
    reservationCountMock.mockResolvedValue(0);
  });

  it("paginates 20 per page and sorts by classSchedule.startsAt asc", async () => {
    await listReservations({ status: "RESERVED" });

    expect(reservationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { classSchedule: { startsAt: "asc" } },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("advances the offset on page 2", async () => {
    await listReservations({ status: "RESERVED", page: 2 });

    expect(reservationFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  // 이번 Phase(예약 생성/취소) 스코프 회귀 테스트: 결제/환불(Phase 8)과 출결(Phase 6)은 이 Phase의
  // 소유가 아니다. select 에 paymentItem/attendance 관련 필드가 절대 섞이지 않아야 한다.
  it("never selects paymentItem or attendance fields in the list query (out of scope for this phase)", async () => {
    await listReservations({});

    const [[callArg]] = reservationFindManyMock.mock.calls;
    expect(callArg.select).not.toHaveProperty("paymentItem");
    expect(callArg.select).not.toHaveProperty("attendance");
    expect(callArg.select).toEqual(
      expect.objectContaining({
        id: true,
        status: true,
        reservedAt: true,
        child: expect.objectContaining({ select: { id: true, name: true } }),
        classSchedule: expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            startsAt: true,
            endsAt: true,
            program: { select: { id: true, name: true } },
          }),
        }),
      }),
    );
  });
});

describe("getReservationDetail", () => {
  beforeEach(() => {
    reservationFindUniqueMock.mockReset();
  });

  it("returns null when the reservation does not exist", async () => {
    reservationFindUniqueMock.mockResolvedValue(null);

    const result = await getReservationDetail("missing-id");

    expect(result).toBeNull();
  });

  // 회귀 테스트: 상세 조회도 이번 Phase 스코프 밖인 paymentItem 을 select 하지 않아야 한다.
  it("never selects paymentItem fields in the detail query (out of scope for this phase)", async () => {
    reservationFindUniqueMock.mockResolvedValue({ id: "reservation-1" });

    await getReservationDetail("reservation-1");

    const [[callArg]] = reservationFindUniqueMock.mock.calls;
    expect(callArg.select).not.toHaveProperty("paymentItem");
    expect(callArg.select).toEqual(
      expect.objectContaining({
        id: true,
        status: true,
        attendance: true,
        reservedAt: true,
        memo: true,
        cancelledAt: true,
        cancelReason: true,
        cancelDetail: true,
        cancelledById: true,
        child: { select: { id: true, name: true, isActive: true } },
        cancelledBy: { select: { id: true, name: true } },
      }),
    );
  });
});
