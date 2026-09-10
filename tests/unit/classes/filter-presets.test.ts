import { describe, expect, it } from "vitest";
import {
  buildClassListHref,
  getActiveClassDatePreset,
  getClassDatePresets,
} from "@/server/classes/filter-presets";

describe("class KST date filter presets", () => {
  const now = new Date("2026-09-09T16:30:00.000Z"); // 2026-09-10 01:30 KST

  it("builds today, Monday-Sunday week, and calendar month ranges in KST", () => {
    expect(getClassDatePresets(now)).toEqual({
      today: { dateFrom: "2026-09-10", dateTo: "2026-09-10" },
      week: { dateFrom: "2026-09-07", dateTo: "2026-09-13" },
      month: { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
    });
  });

  it("marks a preset active only when both URL dates match exactly", () => {
    const presets = getClassDatePresets(now);
    expect(getActiveClassDatePreset("2026-09-10", "2026-09-10", presets)).toBe("today");
    expect(getActiveClassDatePreset("2026-09-07", "2026-09-13", presets)).toBe("week");
    expect(getActiveClassDatePreset("2026-09-01", "2026-09-30", presets)).toBe("month");
    expect(getActiveClassDatePreset("2026-09-02", "2026-09-20", presets)).toBeUndefined();
    expect(getActiveClassDatePreset(undefined, undefined, presets)).toBeUndefined();
  });

  it("preserves dates/status through pagination and status through preset links", () => {
    expect(
      buildClassListHref({
        dateFrom: "2026-09-07",
        dateTo: "2026-09-13",
        status: "CANCELLED",
        page: 2,
      }),
    ).toBe("/classes?dateFrom=2026-09-07&dateTo=2026-09-13&status=CANCELLED&page=2");
    expect(
      buildClassListHref({
        dateFrom: "2026-09-10",
        dateTo: "2026-09-10",
        status: "SCHEDULED",
      }),
    ).toBe("/classes?dateFrom=2026-09-10&dateTo=2026-09-10");
  });
});
