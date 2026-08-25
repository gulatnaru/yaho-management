import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    classSchedule: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

const { getLatestInsurancePrefill } = await import("@/lib/classes/insurance-prefill");

describe("insurance prefill", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(null);
  });

  it("uses the latest class before the class being edited", async () => {
    const startsAt = new Date("2026-09-10T00:00:00.000Z");
    findUniqueMock.mockResolvedValue({ startsAt });

    await getLatestInsurancePrefill("class-2");

    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { startsAt: { lt: startsAt } },
      orderBy: { startsAt: "desc" },
    }));
  });

  it("uses the latest class overall for a new class", async () => {
    await getLatestInsurancePrefill();

    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});
