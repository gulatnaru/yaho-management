import { describe, expect, it } from "vitest";
import { getClassDisplayStatus } from "@/lib/classes/status";

const now = new Date("2026-08-23T12:00:00Z");

describe("getClassDisplayStatus", () => {
  it("returns CANCELLED even if endsAt is in the future", () => {
    expect(
      getClassDisplayStatus(
        { status: "CANCELLED", endsAt: new Date("2026-08-24T12:00:00Z") },
        now,
      ),
    ).toBe("CANCELLED");
  });

  it("returns CANCELLED even if endsAt is in the past", () => {
    expect(
      getClassDisplayStatus(
        { status: "CANCELLED", endsAt: new Date("2026-08-01T12:00:00Z") },
        now,
      ),
    ).toBe("CANCELLED");
  });

  it("returns ENDED when SCHEDULED and endsAt is in the past", () => {
    expect(
      getClassDisplayStatus(
        { status: "SCHEDULED", endsAt: new Date("2026-08-01T12:00:00Z") },
        now,
      ),
    ).toBe("ENDED");
  });

  it("returns SCHEDULED when SCHEDULED and endsAt is in the future", () => {
    expect(
      getClassDisplayStatus(
        { status: "SCHEDULED", endsAt: new Date("2026-08-24T12:00:00Z") },
        now,
      ),
    ).toBe("SCHEDULED");
  });

  it("treats endsAt exactly equal to now as not yet ended (boundary)", () => {
    expect(getClassDisplayStatus({ status: "SCHEDULED", endsAt: now }, now)).toBe("SCHEDULED");
  });

  it("returns ENDED just one millisecond after endsAt", () => {
    const justAfter = new Date(now.getTime() + 1);
    expect(getClassDisplayStatus({ status: "SCHEDULED", endsAt: now }, justAfter)).toBe("ENDED");
  });
});
