import { beforeEach, describe, expect, it, vi } from "vitest";

const countMock = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classSchedule: {
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { countFutureScheduledClasses } = await import("@/lib/programs/deactivation-warning");

describe("countFutureScheduledClasses", () => {
  beforeEach(() => {
    countMock.mockClear();
  });

  it("queries classSchedule.count with programId, SCHEDULED status, and startsAt > now", async () => {
    const now = new Date("2026-08-21T00:00:00.000Z");

    await countFutureScheduledClasses("program-1", now);

    expect(countMock).toHaveBeenCalledWith({
      where: {
        programId: "program-1",
        status: "SCHEDULED",
        startsAt: { gt: now },
      },
    });
  });

  it("returns whatever prisma.classSchedule.count resolves", async () => {
    countMock.mockResolvedValueOnce(3);

    const result = await countFutureScheduledClasses("program-1", new Date("2026-08-21T00:00:00.000Z"));

    expect(result).toBe(3);
  });

  it("defaults now to the current time when omitted", async () => {
    await countFutureScheduledClasses("program-1");

    const callArgs = countMock.mock.calls[0][0];
    expect(callArgs.where.programId).toBe("program-1");
    expect(callArgs.where.status).toBe("SCHEDULED");
    expect(callArgs.where.startsAt.gt).toBeInstanceOf(Date);
  });
});
