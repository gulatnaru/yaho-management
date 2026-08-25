import { describe, expect, it, vi } from "vitest";
import { AttendanceNotRecordableError, ClassNotEndedError, correctAttendanceCore, recordAttendanceCore } from "@/lib/reservations/attendance";

const PAST_ENDS_AT = new Date("2020-01-01T00:00:00Z");
const FUTURE_ENDS_AT = new Date("2099-01-01T00:00:00Z");
const FIXED_NOW = new Date("2026-06-01T00:00:00Z");

function client(count: number) {
  return { reservation: { updateMany: vi.fn().mockResolvedValue({ count }) } } as never;
}

describe("attendance", () => {
  it("records PRESENT and transitions RESERVED to COMPLETED", async () => {
    const db = client(1);
    await recordAttendanceCore(db, { reservationId: "r1", attendance: "PRESENT", recordedById: "u1", classEndsAt: PAST_ENDS_AT });
    expect((db as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", status: "RESERVED" }, data: expect.objectContaining({ attendance: "PRESENT", status: "COMPLETED", attendanceRecordedById: "u1" }) }));
  });

  it("allows correction only for terminal attendance statuses", async () => {
    const db = client(1);
    await correctAttendanceCore(db, { reservationId: "r1", attendance: "ABSENT", recordedById: "u1", classEndsAt: PAST_ENDS_AT });
    expect((db as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", status: { in: ["COMPLETED", "NO_SHOW"] } }, data: expect.objectContaining({ status: "NO_SHOW" }) }));
  });

  it("rejects a race or an ineligible reservation", async () => {
    await expect(recordAttendanceCore(client(0), { reservationId: "r1", attendance: "PRESENT", recordedById: "u1", classEndsAt: PAST_ENDS_AT })).rejects.toBeInstanceOf(AttendanceNotRecordableError);
    await expect(correctAttendanceCore(client(0), { reservationId: "r1", attendance: "PRESENT", recordedById: "u1", classEndsAt: PAST_ENDS_AT })).rejects.toBeInstanceOf(AttendanceNotRecordableError);
  });

  it("rejects recording or correcting attendance before the class has ended", async () => {
    const recordDb = client(1);
    await expect(
      recordAttendanceCore(recordDb, { reservationId: "r1", attendance: "PRESENT", recordedById: "u1", classEndsAt: FUTURE_ENDS_AT }, FIXED_NOW),
    ).rejects.toBeInstanceOf(ClassNotEndedError);
    expect((recordDb as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).not.toHaveBeenCalled();

    const correctDb = client(1);
    await expect(
      correctAttendanceCore(correctDb, { reservationId: "r1", attendance: "PRESENT", recordedById: "u1", classEndsAt: FUTURE_ENDS_AT }, FIXED_NOW),
    ).rejects.toBeInstanceOf(ClassNotEndedError);
    expect((correctDb as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).not.toHaveBeenCalled();
  });
});
