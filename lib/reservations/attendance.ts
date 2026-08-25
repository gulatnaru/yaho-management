import type { Prisma, PrismaClient } from "@prisma/client";

export type AttendanceValue = "PRESENT" | "ABSENT";
type ReservationStatusValue = "RESERVED" | "COMPLETED" | "NO_SHOW";
type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class AttendanceNotRecordableError extends Error {}

export type RecordAttendanceInput = {
  reservationId: string;
  attendance: AttendanceValue;
  recordedById: string;
};

export async function recordAttendanceCore(client: PrismaLike, input: RecordAttendanceInput) {
  const nextStatus: ReservationStatusValue = input.attendance === "PRESENT" ? "COMPLETED" : "NO_SHOW";
  const result = await client.reservation.updateMany({
    where: { id: input.reservationId, status: "RESERVED" },
    data: {
      attendance: input.attendance,
      status: nextStatus,
      attendanceRecordedById: input.recordedById,
      attendanceRecordedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new AttendanceNotRecordableError();
  }
  return { status: nextStatus };
}

export async function correctAttendanceCore(client: PrismaLike, input: RecordAttendanceInput) {
  const nextStatus: ReservationStatusValue = input.attendance === "PRESENT" ? "COMPLETED" : "NO_SHOW";
  const result = await client.reservation.updateMany({
    where: { id: input.reservationId, status: { in: ["COMPLETED", "NO_SHOW"] } },
    data: {
      attendance: input.attendance,
      status: nextStatus,
      attendanceRecordedById: input.recordedById,
      attendanceRecordedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new AttendanceNotRecordableError();
  }
  return { status: nextStatus };
}
