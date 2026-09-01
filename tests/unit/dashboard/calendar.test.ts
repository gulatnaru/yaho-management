import { describe, expect, it } from "vitest";
import { buildMonthlyCalendar } from "@/server/dashboard/calendar";

describe("dashboard monthly calendar", () => {
  it("builds a five-week grid and preserves leap day", () => {
    const cells = buildMonthlyCalendar("2028-02");

    expect(cells).toHaveLength(35);
    expect(cells.filter((cell) => cell.inCurrentMonth)).toHaveLength(29);
    expect(cells.some((cell) => cell.date === "2028-02-29")).toBe(true);
  });

  it("builds a six-week grid when the month crosses six rows", () => {
    const cells = buildMonthlyCalendar("2026-08");

    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe("2026-07-26");
    expect(cells.at(-1)?.date).toBe("2026-09-05");
    expect(cells.filter((cell) => cell.inCurrentMonth)).toHaveLength(31);
  });

  it("always starts on Sunday and ends on Saturday", () => {
    for (const month of ["2026-02", "2026-04", "2026-12"]) {
      const cells = buildMonthlyCalendar(month);
      expect(new Date(`${cells[0].date}T00:00:00.000Z`).getUTCDay()).toBe(0);
      expect(new Date(`${cells.at(-1)?.date}T00:00:00.000Z`).getUTCDay()).toBe(6);
    }
  });
});
