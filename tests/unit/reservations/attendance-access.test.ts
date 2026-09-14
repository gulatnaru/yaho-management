import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentPrincipalMock = vi.fn();
const findFirstMock = vi.fn();
const updateManyMock = vi.fn();

vi.mock("@/lib/auth/authorization", () => ({
  requireCurrentPrincipal: (...args: unknown[]) => requireCurrentPrincipalMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    reservation: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordAttendanceAction } = await import(
  "@/app/(admin)/reservations/attendance-actions"
);

function formData() {
  const value = new FormData();
  value.set("reservationId", "reservation-1");
  value.set("attendance", "PRESENT");
  return value;
}

const teacherPrincipal = {
  userId: "teacher-user-1",
  name: "선생님",
  email: "teacher@yaho.test",
  role: "TEACHER" as const,
  teacherId: "teacher-1",
  authVersion: 1,
  mustChangePassword: false,
};

describe("attendance role authorization", () => {
  beforeEach(() => {
    requireCurrentPrincipalMock.mockReset();
    requireCurrentPrincipalMock.mockResolvedValue(teacherPrincipal);
    findFirstMock.mockReset();
    updateManyMock.mockReset();
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it("derives TEACHER scope from the live principal and assigned ClassTeacher relation", async () => {
    findFirstMock.mockResolvedValue({
      classScheduleId: "class-1",
      status: "RESERVED",
      classSchedule: { endsAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    await expect(recordAttendanceAction({}, formData())).resolves.toEqual({ success: true });

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        classSchedule: { teachers: { some: { teacherId: "teacher-1" } } },
      },
      select: {
        classScheduleId: true,
        status: true,
        classSchedule: { select: { endsAt: true } },
      },
    });
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reservation-1", status: "RESERVED" },
      data: expect.objectContaining({ attendanceRecordedById: "teacher-user-1" }),
    }));
  });

  it("returns a safe not-found result and writes nothing for an unassigned reservation id", async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(recordAttendanceAction({}, formData())).resolves.toEqual({
      error: "예약을 찾을 수 없습니다.",
    });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("does not query or write when live-principal authorization rejects the request", async () => {
    requireCurrentPrincipalMock.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(recordAttendanceAction({}, formData())).rejects.toThrow("UNAUTHORIZED");
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
