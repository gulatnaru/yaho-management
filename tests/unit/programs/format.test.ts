import { describe, expect, it } from "vitest";
import { formatDuration, formatPrice, formatTargetAgeRange } from "@/lib/programs/format";

describe("formatTargetAgeRange", () => {
  it("returns 제한 없음 when both are null", () => {
    expect(formatTargetAgeRange(null, null)).toBe("제한 없음");
  });

  it("returns an 'or older' phrase when only min is set", () => {
    expect(formatTargetAgeRange(5, null)).toBe("만 5세 이상");
  });

  it("returns an 'or younger' phrase when only max is set", () => {
    expect(formatTargetAgeRange(null, 8)).toBe("만 8세 이하");
  });

  it("returns a range phrase when both are set", () => {
    expect(formatTargetAgeRange(5, 8)).toBe("만 5~8세");
  });
});

describe("formatDuration", () => {
  it("returns a dash when null", () => {
    expect(formatDuration(null)).toBe("–");
  });

  it("returns minutes with a suffix when set", () => {
    expect(formatDuration(60)).toBe("60분");
  });
});

describe("formatPrice", () => {
  it("formats an amount with thousands separators and a won suffix", () => {
    expect(formatPrice(15000)).toBe("15,000원");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("0원");
  });

  it("stays pure numeric/string conversion — no Date/timezone handling involved", () => {
    // formatDuration/formatPrice take plain numbers, not Date instances, and
    // formatTargetAgeRange takes plain numbers too — none of them touch clocks or timezones.
    expect(formatDuration.length).toBe(1);
    expect(formatPrice.length).toBe(1);
    expect(formatTargetAgeRange.length).toBe(2);
    expect(formatDuration(90)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
