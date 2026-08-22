import { describe, expect, it } from "vitest";
import { isUnderStaffed, RECOMMENDED_TEACHER_COUNT } from "@/lib/classes/teacher-warning";

describe("isUnderStaffed", () => {
  it("exposes the recommended teacher count as 2", () => {
    expect(RECOMMENDED_TEACHER_COUNT).toBe(2);
  });

  it("returns true for 0 teachers", () => {
    expect(isUnderStaffed(0)).toBe(true);
  });

  it("returns true for 1 teacher", () => {
    expect(isUnderStaffed(1)).toBe(true);
  });

  it("returns false for 2 teachers", () => {
    expect(isUnderStaffed(2)).toBe(false);
  });

  it("returns false for 3 teachers", () => {
    expect(isUnderStaffed(3)).toBe(false);
  });
});
