import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentPrincipal } from "@/lib/auth/principal";

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
const redirectMock = vi.fn((destination: string) => {
  throw new Error(`REDIRECT:${destination}`);
});

vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const {
  requireAssignedClass,
  requireAssignedReservation,
  requireOwnTeacher,
} = await import("@/lib/auth/authorization");

const teacherPrincipal: CurrentPrincipal = {
  userId: "user-1",
  name: "선생님",
  email: "teacher@yaho.test",
  role: "TEACHER",
  teacherId: "teacher-1",
  authVersion: 1,
  mustChangePassword: false,
};

function resourceClient(options?: { classAssigned?: boolean; reservationAssigned?: boolean }) {
  return {
    user: { findUnique: vi.fn() },
    classTeacher: {
      findUnique: vi.fn().mockResolvedValue(options?.classAssigned === false ? null : { id: "assignment-1" }),
    },
    reservation: {
      findFirst: vi.fn().mockResolvedValue(options?.reservationAssigned === false ? null : { id: "reservation-1" }),
    },
  };
}

describe("assignment authorization", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    redirectMock.mockClear();
  });

  it("allows only a TEACHER assigned to the requested class", async () => {
    const client = resourceClient();

    await expect(requireAssignedClass("class-1", teacherPrincipal, client as never)).resolves.toBe(
      teacherPrincipal,
    );
    expect(client.classTeacher.findUnique).toHaveBeenCalledWith({
      where: {
        classScheduleId_teacherId: {
          classScheduleId: "class-1",
          teacherId: "teacher-1",
        },
      },
      select: { id: true },
    });

    await expect(
      requireAssignedClass("class-2", teacherPrincipal, resourceClient({ classAssigned: false }) as never),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("scopes reservation access through ClassTeacher assignment", async () => {
    const client = resourceClient();

    await expect(
      requireAssignedReservation("reservation-1", teacherPrincipal, client as never),
    ).resolves.toBe(teacherPrincipal);
    expect(client.reservation.findFirst).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        classSchedule: { teachers: { some: { teacherId: "teacher-1" } } },
      },
      select: { id: true },
    });

    await expect(
      requireAssignedReservation(
        "reservation-2",
        teacherPrincipal,
        resourceClient({ reservationAssigned: false }) as never,
      ),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("prevents a TEACHER from reading another Teacher identity", async () => {
    await expect(requireOwnTeacher("teacher-1", teacherPrincipal)).resolves.toBe(teacherPrincipal);
    await expect(requireOwnTeacher("teacher-2", teacherPrincipal)).rejects.toThrow("NOT_FOUND");
  });

  it("never lets a forced-password principal bypass a resource helper", async () => {
    await expect(
      requireAssignedClass(
        "class-1",
        { ...teacherPrincipal, mustChangePassword: true },
        resourceClient() as never,
      ),
    ).rejects.toThrow("REDIRECT:/account/password");
  });
});
