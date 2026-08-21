import { describe, expect, it } from "vitest";
import { isProfileIncomplete } from "@/lib/children/profile-completeness";

const complete = {
  birthDate: new Date("2018-05-01"),
  guardianName: "김보호",
  guardianPhone: "010-1234-5678",
};

describe("isProfileIncomplete", () => {
  it("returns false when birthDate, guardianName, and guardianPhone are all present", () => {
    expect(isProfileIncomplete(complete)).toBe(false);
  });

  it("returns true when birthDate is missing", () => {
    expect(isProfileIncomplete({ ...complete, birthDate: null })).toBe(true);
  });

  it("returns true when guardianName is missing", () => {
    expect(isProfileIncomplete({ ...complete, guardianName: null })).toBe(true);
  });

  it("returns true when guardianPhone is missing", () => {
    expect(isProfileIncomplete({ ...complete, guardianPhone: null })).toBe(true);
  });

  it("returns true when all three fields are missing", () => {
    expect(isProfileIncomplete({ birthDate: null, guardianName: null, guardianPhone: null })).toBe(true);
  });
});
