import { beforeEach, describe, expect, it, vi } from "vitest";

const countMock = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classTeacher: {
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { countFutureScheduledAssignments } = await import("@/lib/teachers/deactivation-warning");

describe("countFutureScheduledAssignments", () => {
  beforeEach(() => {
    countMock.mockClear();
  });

  it("queries classTeacher.count with teacherId, SCHEDULED status, and startsAt > now", async () => {
    const now = new Date("2026-08-21T00:00:00.000Z");

    await countFutureScheduledAssignments("teacher-1", now);

    expect(countMock).toHaveBeenCalledWith({
      where: {
        teacherId: "teacher-1",
        classSchedule: {
          status: "SCHEDULED",
          startsAt: { gt: now },
        },
      },
    });
  });

  it("returns whatever prisma.classTeacher.count resolves", async () => {
    countMock.mockResolvedValueOnce(3);

    const result = await countFutureScheduledAssignments("teacher-1", new Date("2026-08-21T00:00:00.000Z"));

    expect(result).toBe(3);
  });

  it("defaults now to the current time when omitted", async () => {
    await countFutureScheduledAssignments("teacher-1");

    const callArgs = countMock.mock.calls[0][0];
    expect(callArgs.where.teacherId).toBe("teacher-1");
    expect(callArgs.where.classSchedule.status).toBe("SCHEDULED");
    expect(callArgs.where.classSchedule.startsAt.gt).toBeInstanceOf(Date);
  });
});
