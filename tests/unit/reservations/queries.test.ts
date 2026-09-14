import { beforeEach, describe, expect, it, vi } from "vitest";

const reservationFindManyMock = vi.fn();
const reservationCountMock = vi.fn();
const reservationFindUniqueMock = vi.fn();
const requireAdminPrincipalMock = vi.fn();
const requireOperationalPrincipalMock = vi.fn();
const requireAssignedClassMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireAdminPrincipal: (...args: unknown[]) => requireAdminPrincipalMock(...args),
  requireOperationalPrincipal: (...args: unknown[]) => requireOperationalPrincipalMock(...args),
  requireAssignedClass: (...args: unknown[]) => requireAssignedClassMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: {
      findMany: (...args: unknown[]) => reservationFindManyMock(...args),
      count: (...args: unknown[]) => reservationCountMock(...args),
      findUnique: (...args: unknown[]) => reservationFindUniqueMock(...args),
    },
  },
}));

const {
  getReservationDetail,
  getReservationOperationalDetail,
  listOperationalReservationsByClassSchedule,
  listReservations,
  listReservationsByClassSchedule,
  listTeacherReservationsByClassSchedule,
} = await import("@/lib/reservations/queries");

beforeEach(() => {
  requireAdminPrincipalMock.mockReset();
  requireAdminPrincipalMock.mockResolvedValue({ role: "ADMIN" });
  requireOperationalPrincipalMock.mockReset();
  requireOperationalPrincipalMock.mockResolvedValue({ role: "MANAGER" });
  requireAssignedClassMock.mockReset();
  requireAssignedClassMock.mockResolvedValue({ role: "TEACHER", teacherId: "teacher-1" });
});

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

  it("selects attendance and payment fields for the reservation detail", async () => {
    reservationFindUniqueMock.mockResolvedValue({ id: "reservation-1" });

    await getReservationDetail("reservation-1");

    const [[callArg]] = reservationFindUniqueMock.mock.calls;
    expect(callArg.select.paymentItem.select).toEqual(
      expect.objectContaining({
        id: true,
        paidAmount: true,
        refundedAmount: true,
        payment: { select: { id: true, status: true, method: true, paidAt: true } },
      }),
    );
    expect(callArg.select).toHaveProperty("attendance", true);
    expect(callArg.select).toHaveProperty("attendanceRecordedAt", true);
    expect(callArg.select).toEqual(
      expect.objectContaining({
        id: true,
        status: true,
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

  it("uses a non-financial projection for MANAGER reservation detail", async () => {
    reservationFindUniqueMock.mockResolvedValue({ id: "reservation-1" });

    await getReservationOperationalDetail("reservation-1");

    const [[callArg]] = reservationFindUniqueMock.mock.calls;
    expect(callArg.select).not.toHaveProperty("paymentItem");
    const serialized = JSON.stringify(callArg.select);
    for (const forbidden of ["amount", "payment", "refund", "method", "paidAmount", "refundedAmount"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("listReservationsByClassSchedule", () => {
  beforeEach(() => {
    reservationFindManyMock.mockReset();
    reservationFindManyMock.mockResolvedValue([]);
  });

  it("loads participant safety fields in the class-detail query", async () => {
    await listReservationsByClassSchedule("class-1");

    expect(reservationFindManyMock).toHaveBeenCalledTimes(1);
    const [[callArg]] = reservationFindManyMock.mock.calls;
    expect(callArg.select.child.select.safetyInfo.select).toEqual({
      allergies: true,
      emergencyNotes: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
    });
  });

  it("loads only payment status for each participant without refund or amount fields", async () => {
    await listReservationsByClassSchedule("class-1");

    const [[callArg]] = reservationFindManyMock.mock.calls;
    expect(callArg.select.paymentItem).toEqual({
      select: { payment: { select: { status: true } } },
    });
    expect(reservationFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("omits the payment relation from MANAGER class participants", async () => {
    await listOperationalReservationsByClassSchedule("class-1");

    const [[callArg]] = reservationFindManyMock.mock.calls;
    expect(callArg.select).not.toHaveProperty("paymentItem");
    expect(JSON.stringify(callArg.select)).not.toContain("payment");
  });

  it("checks ADMIN access before selecting participant payment status", async () => {
    requireAdminPrincipalMock.mockRejectedValueOnce(new Error("FORBIDDEN"));

    await expect(listReservationsByClassSchedule("class-1")).rejects.toThrow("FORBIDDEN");
    expect(reservationFindManyMock).not.toHaveBeenCalled();
  });

  it("scopes TEACHER participant data through assignment and returns no financial relation", async () => {
    const principal = {
      userId: "teacher-user-1",
      name: "선생님",
      email: "teacher@yaho.test",
      role: "TEACHER" as const,
      teacherId: "teacher-1",
      authVersion: 1,
      mustChangePassword: false,
    };

    await listTeacherReservationsByClassSchedule("class-1", principal);

    expect(requireAssignedClassMock).toHaveBeenCalledWith("class-1", principal);
    const [[callArg]] = reservationFindManyMock.mock.calls;
    expect(callArg.where).toEqual({
      classScheduleId: "class-1",
      classSchedule: { teachers: { some: { teacherId: "teacher-1" } } },
    });
    expect(callArg.select).not.toHaveProperty("paymentItem");
    expect(callArg.select.child.select).toEqual(expect.objectContaining({
      id: true,
      name: true,
      guardianName: true,
      guardianPhone: true,
      safetyInfo: expect.any(Object),
    }));
  });
});
