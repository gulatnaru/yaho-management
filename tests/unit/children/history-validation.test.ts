import { describe, expect, it } from "vitest";
import { MAX_CHILD_HISTORY_PAGE } from "@/lib/children/history";
import { parseChildHistoryPage } from "@/lib/validation/child-history";

describe("child history page validation", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["   ", 1],
    ["invalid", 1],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["1e3", 1],
    ["1", 1],
    ["2", 2],
    ["99", 99],
    ["100", 100],
    ["101", 100],
    ["999999999999999999999999999999999999999999", 100],
  ] as const)("parses %s as %s", (value, expected) => {
    expect(parseChildHistoryPage(value)).toBe(expected);
  });

  it("uses the first URL value and clamps values above the technical maximum", () => {
    expect(parseChildHistoryPage(["2", "3"])).toBe(2);
    expect(parseChildHistoryPage(String(MAX_CHILD_HISTORY_PAGE + 1))).toBe(
      MAX_CHILD_HISTORY_PAGE,
    );
  });
});
