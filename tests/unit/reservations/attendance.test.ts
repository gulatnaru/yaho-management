import { describe, expect, it, vi } from "vitest";
import { AttendanceNotRecordableError, correctAttendanceCore, recordAttendanceCore } from "@/lib/reservations/attendance";

function client(count: number) {
  return { reservation: { updateMany: vi.fn().mockResolvedValue({ count }) } } as never;
}

describe("attendance", () => {
  it("records PRESENT and transitions RESERVED to COMPLETED", async () => {
    const db = client(1);
    await recordAttendanceCore(db, { reservationId: "r1", attendance: "PRESENT", recordedById: "u1" });
    expect((db as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", status: "RESERVED" }, data: expect.objectContaining({ attendance: "PRESENT", status: "COMPLETED", attendanceRecordedById: "u1" }) }));
  });

  it("allows correction only for terminal attendance statuses", async () => {
    const db = client(1);
    await correctAttendanceCore(db, { reservationId: "r1", attendance: "ABSENT", recordedById: "u1" });
    expect((db as { reservation: { updateMany: ReturnType<typeof vi.fn> } }).reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", status: { in: ["COMPLETED", "NO_SHOW"] } }, data: expect.objectContaining({ status: "NO_SHOW" }) }));
  });

  it("rejects a race or an ineligible reservation", async () => {
    await expect(recordAttendanceCore(client(0), { reservationId: "r1", attendance: "PRESENT", recordedById: "u1" })).rejects.toBeInstanceOf(AttendanceNotRecordableError);
    await expect(correctAttendanceCore(client(0), { reservationId: "r1", attendance: "PRESENT", recordedById: "u1" })).rejects.toBeInstanceOf(AttendanceNotRecordableError);
  });
});
