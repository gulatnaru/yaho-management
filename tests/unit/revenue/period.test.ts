import { describe, expect, it } from "vitest";
import { addKstDateDays, getKstMonthRange, getKstWeekRange, resolveRevenuePeriod } from "@/server/revenue/period";

describe("revenue KST period", () => {
  it("uses the current KST month by default across a UTC year boundary", () => {
    const period = resolveRevenuePeriod(undefined, undefined, new Date("2026-12-31T15:30:00.000Z"));

    expect(period.dateFrom).toBe("2027-01-01");
    expect(period.dateTo).toBe("2027-01-31");
    expect(period.startUtc.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2027-01-31T15:00:00.000Z");
  });

  it("handles leap-year month ends", () => {
    expect(getKstMonthRange(new Date("2028-02-10T00:00:00.000Z"))).toEqual({
      dateFrom: "2028-02-01",
      dateTo: "2028-02-29",
    });
    expect(addKstDateDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("uses Monday through Sunday for the KST week", () => {
    expect(getKstWeekRange(new Date("2026-08-30T16:00:00.000Z"))).toEqual({
      dateFrom: "2026-08-31",
      dateTo: "2026-09-06",
    });
  });

  it("converts inclusive dates into a half-open UTC range", () => {
    const period = resolveRevenuePeriod("2026-07-01", "2026-07-31");

    expect(period.startUtc.toISOString()).toBe("2026-06-30T15:00:00.000Z");
    expect(period.endExclusiveUtc.toISOString()).toBe("2026-07-31T15:00:00.000Z");
  });

  it("falls back to the current KST month for invalid or reversed ranges", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(resolveRevenuePeriod("2026-02-30", "2026-03-01", now)).toMatchObject({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
    expect(resolveRevenuePeriod("2026-09-02", "2026-09-01", now)).toMatchObject({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
  });
});
