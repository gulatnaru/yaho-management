import { expect, it, vi } from "vitest";

const findFirst = vi.fn();
const updateMany = vi.fn();
const record = vi.fn();
const correct = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({ requireCurrentPrincipal: async () => ({ role: "STAFF", userId: "staff-1" }) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { reservation: { findFirst, updateMany } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/reservations/attendance", () => ({
  AttendanceNotRecordableError: class extends Error {}, ClassNotEndedError: class extends Error {},
  recordAttendanceCore: record, correctAttendanceCore: correct,
}));

const { recordAttendanceAction } = await import("@/app/(admin)/reservations/attendance-actions");

it("rejects STAFF at the server action before either attendance core or any DB access", async () => {
  const data = new FormData();
  data.set("reservationId", "valid-reservation-id");
  data.set("attendance", "PRESENT");
  await expect(recordAttendanceAction({}, data)).rejects.toThrow("NOT_FOUND");
  expect(record).not.toHaveBeenCalled();
  expect(correct).not.toHaveBeenCalled();
  expect(findFirst).not.toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
});
