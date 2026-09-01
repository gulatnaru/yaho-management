import { describe, expect, it } from "vitest";
import { dashboardSearchSchema } from "@/lib/validation/dashboard";
import { addKstMonths, getKstDayPeriod, resolveDashboardPeriod } from "@/server/dashboard/period";

describe("dashboard KST period and URL state", () => {
  it("uses the current KST month across a UTC year boundary", () => {
    const period = resolveDashboardPeriod({}, new Date("2026-12-31T15:30:00.000Z"));

    expect(period).toMatchObject({ month: "2027-01", today: "2027-01-01" });
    expect(period.startUtc.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2027-01-31T15:00:00.000Z");
    expect(period.todayStartUtc.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(period.tomorrowStartUtc.toISOString()).toBe("2027-01-01T15:00:00.000Z");
  });

  it("handles leap-year month ends with half-open UTC ranges", () => {
    const period = resolveDashboardPeriod({ month: "2028-02", date: "2028-02-29" });

    expect(period.selectedDate).toBe("2028-02-29");
    expect(period.startUtc.toISOString()).toBe("2028-01-31T15:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2028-02-29T15:00:00.000Z");
    expect(getKstDayPeriod("2028-02-29").endExclusiveUtc.toISOString()).toBe("2028-02-29T15:00:00.000Z");
  });

  it("moves across year boundaries without using the server timezone", () => {
    expect(addKstMonths("2026-12", 1)).toBe("2027-01");
    expect(addKstMonths("2027-01", -1)).toBe("2026-12");
  });

  it("falls back for invalid months and clears invalid or out-of-month dates", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(resolveDashboardPeriod({ month: "2026-13", date: "2026-13-01" }, now)).toMatchObject({
      month: "2026-08",
      selectedDate: undefined,
    });
    expect(resolveDashboardPeriod({ month: "2026-09", date: "2026-02-30" }, now).selectedDate).toBeUndefined();
    expect(resolveDashboardPeriod({ month: "2026-09", date: "2026-08-31" }, now).selectedDate).toBeUndefined();
  });

  it("normalizes malformed external search input with Zod", () => {
    expect(dashboardSearchSchema.parse({ month: "bad", date: "also-bad" })).toEqual({
      month: undefined,
      date: undefined,
    });
  });
});
