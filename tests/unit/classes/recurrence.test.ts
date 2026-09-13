import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPastRecurringClassDates,
  generateRecurringClassDates,
} from "@/lib/classes/recurrence";

function expectDates(input: {
  repeatStartDate: string;
  repeatEndDate: string;
  weekdays: number[];
}) {
  const result = generateRecurringClassDates(input);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.message);
  return result;
}

describe("generateRecurringClassDates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes both range boundaries when they match the selected weekday", () => {
    const result = expectDates({
      repeatStartDate: "2026-10-03",
      repeatEndDate: "2026-10-31",
      weekdays: [6],
    });

    expect(result.dates).toEqual([
      "2026-10-03",
      "2026-10-10",
      "2026-10-17",
      "2026-10-24",
      "2026-10-31",
    ]);
  });

  it("supports multiple weekdays and returns dates in calendar order", () => {
    const result = expectDates({
      repeatStartDate: "2026-10-01",
      repeatEndDate: "2026-10-11",
      weekdays: [0, 6],
    });

    expect(result.dates).toEqual(["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11"]);
  });

  it("deduplicates weekday values", () => {
    const result = expectDates({
      repeatStartDate: "2026-10-01",
      repeatEndDate: "2026-10-10",
      weekdays: [6, 6, 6],
    });

    expect(result.weekdays).toEqual([6]);
    expect(result.dates).toEqual(["2026-10-03", "2026-10-10"]);
  });

  it("handles the first and last day of a month", () => {
    const result = expectDates({
      repeatStartDate: "2026-10-01",
      repeatEndDate: "2026-10-31",
      weekdays: [4, 6],
    });

    expect(result.dates[0]).toBe("2026-10-01");
    expect(result.dates.at(-1)).toBe("2026-10-31");
  });

  it("includes leap day in a leap-year February", () => {
    const result = expectDates({
      repeatStartDate: "2028-02-01",
      repeatEndDate: "2028-02-29",
      weekdays: [2],
    });

    expect(result.dates).toContain("2028-02-29");
  });

  it.each([
    {
      input: { repeatStartDate: "2026-10-31", repeatEndDate: "2026-10-01", weekdays: [6] },
      code: "START_AFTER_END",
    },
    {
      input: { repeatStartDate: "2026-10-15", repeatEndDate: "2026-11-15", weekdays: [6] },
      code: "CROSS_MONTH",
    },
    {
      input: { repeatStartDate: "2026-02-30", repeatEndDate: "2026-02-28", weekdays: [6] },
      code: "INVALID_START_DATE",
    },
    {
      input: { repeatStartDate: "2026-10-01", repeatEndDate: "2026-10-31", weekdays: [] },
      code: "NO_WEEKDAY",
    },
    {
      input: { repeatStartDate: "2026-10-05", repeatEndDate: "2026-10-05", weekdays: [2] },
      code: "NO_MATCHING_DATE",
    },
  ])("rejects invalid recurrence input with $code", ({ input, code }) => {
    const result = generateRecurringClassDates(input);
    expect(result).toMatchObject({ success: false, code });
  });

  it("produces the same dates regardless of the process timezone", () => {
    const input = {
      repeatStartDate: "2026-10-01",
      repeatEndDate: "2026-10-31",
      weekdays: [0, 6],
    };
    vi.stubEnv("TZ", "America/Los_Angeles");
    const losAngeles = generateRecurringClassDates(input);
    vi.stubEnv("TZ", "Pacific/Auckland");
    const auckland = generateRecurringClassDates(input);

    expect(auckland).toEqual(losAngeles);
  });
});

describe("findPastRecurringClassDates", () => {
  const now = new Date("2026-09-12T15:30:00.000Z"); // 2026-09-13 00:30 KST

  it("allows KST today", () => {
    expect(findPastRecurringClassDates(["2026-09-13"], now)).toEqual([]);
  });

  it("returns KST yesterday and earlier dates", () => {
    expect(
      findPastRecurringClassDates(["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"], now),
    ).toEqual(["2026-09-11", "2026-09-12"]);
  });
});
