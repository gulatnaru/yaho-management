import { afterEach, describe, expect, it } from "vitest";
import { combineKstToUtc, formatKstDate, formatKstDateTime, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";

describe("combineKstToUtc", () => {
  it("converts a KST midnight-boundary time to the correct UTC instant", () => {
    // KST 2026-09-05 00:30 == UTC 2026-09-04 15:30
    const result = combineKstToUtc("2026-09-05", "00:30");

    expect(result.toISOString()).toBe("2026-09-04T15:30:00.000Z");
  });

  it("converts a typical daytime KST time to UTC", () => {
    // KST 2026-09-05 09:00 == UTC 2026-09-05 00:00
    const result = combineKstToUtc("2026-09-05", "09:00");

    expect(result.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("converts a late-night KST time that stays within the same UTC day boundary", () => {
    // KST 2026-09-05 23:30 == UTC 2026-09-05 14:30
    const result = combineKstToUtc("2026-09-05", "23:30");

    expect(result.toISOString()).toBe("2026-09-05T14:30:00.000Z");
  });

  it("throws on malformed input", () => {
    expect(() => combineKstToUtc("2026/09/05", "09:00")).toThrow();
    expect(() => combineKstToUtc("2026-09-05", "9:00")).toThrow();
  });
});

describe("formatKstDate / formatKstTime", () => {
  it("formats a UTC instant back to its KST date and time", () => {
    const d = combineKstToUtc("2026-09-05", "00:30");

    expect(formatKstDate(d)).toBe("2026-09-05");
    expect(formatKstTime(d)).toBe("00:30");
  });

  it("round-trips a set of KST date/time inputs", () => {
    const cases: Array<{ date: string; time: string }> = [
      { date: "2026-01-01", time: "00:00" },
      { date: "2026-06-15", time: "13:45" },
      { date: "2026-12-31", time: "23:59" },
    ];

    for (const { date, time } of cases) {
      const utc = combineKstToUtc(date, time);
      expect(formatKstDate(utc)).toBe(date);
      expect(formatKstTime(utc)).toBe(time);
    }
  });
});

describe("formatKstDateTime", () => {
  it("formats a UTC instant as a KST date and time", () => {
    const d = new Date("2026-08-25T08:21:54.214Z");

    expect(formatKstDateTime(d)).toBe("2026-08-25 17:21");
  });
});

describe("formatKstDateTimeRange", () => {
  it("formats a same-day range with the date shown once", () => {
    const startsAt = combineKstToUtc("2026-09-05", "09:00");
    const endsAt = combineKstToUtc("2026-09-05", "11:00");

    expect(formatKstDateTimeRange(startsAt, endsAt)).toBe("2026-09-05 09:00 ~ 11:00");
  });

  it("formats a range that crosses midnight KST with both dates shown", () => {
    const startsAt = combineKstToUtc("2026-09-05", "23:00");
    const endsAt = combineKstToUtc("2026-09-06", "01:00");

    expect(formatKstDateTimeRange(startsAt, endsAt)).toBe("2026-09-05 23:00 ~ 2026-09-06 01:00");
  });
});

describe("timezone independence (process.env.TZ must not affect results)", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it("produces the same combineKstToUtc result regardless of process.env.TZ", async () => {
    process.env.TZ = "America/New_York";
    const { combineKstToUtc: combineWithNy } = await import("@/lib/classes/datetime");
    const nyResult = combineWithNy("2026-09-05", "00:30").toISOString();

    process.env.TZ = "Pacific/Kiritimati";
    const { combineKstToUtc: combineWithKiritimati } = await import("@/lib/classes/datetime");
    const kiritimatiResult = combineWithKiritimati("2026-09-05", "00:30").toISOString();

    expect(nyResult).toBe("2026-09-04T15:30:00.000Z");
    expect(kiritimatiResult).toBe("2026-09-04T15:30:00.000Z");
  });

  it("produces the same formatKst* results regardless of process.env.TZ", async () => {
    const fixed = new Date("2026-09-04T15:30:00.000Z");

    process.env.TZ = "America/New_York";
    const { formatKstDate: formatDateNy, formatKstTime: formatTimeNy } = await import("@/lib/classes/datetime");

    process.env.TZ = "Pacific/Kiritimati";
    const { formatKstDate: formatDateKiritimati, formatKstTime: formatTimeKiritimati } = await import(
      "@/lib/classes/datetime"
    );

    expect(formatDateNy(fixed)).toBe("2026-09-05");
    expect(formatTimeNy(fixed)).toBe("00:30");
    expect(formatDateKiritimati(fixed)).toBe("2026-09-05");
    expect(formatTimeKiritimati(fixed)).toBe("00:30");
  });
});
