import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { reservationApplicationLink: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

const { findPublicApplicationLink, PUBLIC_APPLICATION_LINK_SELECT } = await import(
  "@/lib/reservation-applications/public-queries"
);

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...collectKeys(nested)]);
}

describe("public application link query", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it("never selects price, seats, staff, memo, insurance, safety or token fields", () => {
    const keys = collectKeys(PUBLIC_APPLICATION_LINK_SELECT);
    for (const forbidden of [
      "defaultPrice",
      "capacity",
      "reservations",
      "_count",
      "teachers",
      "memo",
      "insured",
      "insurer",
      "insurancePolicyNo",
      "safetyMemo",
      "cancelDetail",
      "token",
      "applications",
      "id",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toEqual(
      expect.arrayContaining([
        "isActive",
        "status",
        "startsAt",
        "endsAt",
        "location",
        "name",
        "description",
        "targetAgeMin",
        "targetAgeMax",
      ]),
    );
  });

  it("does not query the database for malformed tokens", async () => {
    await expect(findPublicApplicationLink("short-token")).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("looks up well-formed tokens with the public select only", async () => {
    const token = "a".repeat(32);
    findUniqueMock.mockResolvedValue(null);

    await findPublicApplicationLink(token);

    expect(findUniqueMock).toHaveBeenCalledWith({ where: { token }, select: PUBLIC_APPLICATION_LINK_SELECT });
  });
});
