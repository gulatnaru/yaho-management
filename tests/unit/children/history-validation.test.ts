import { describe, expect, it } from "vitest";
import { MAX_CHILD_HISTORY_PAGE } from "@/lib/children/history";
import { parseChildHistoryPage } from "@/lib/validation/child-history";

describe("child history page validation", () => {
  it.each([
    [undefined, 1],
    ["invalid", 1],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["1", 1],
    ["2", 2],
    ["3", 3],
  ] as const)("parses %s as %s", (value, expected) => {
    expect(parseChildHistoryPage(value)).toBe(expected);
  });

  it("uses the first URL value and rejects values that could overflow Prisma take", () => {
    expect(parseChildHistoryPage(["2", "3"])).toBe(2);
    expect(parseChildHistoryPage(String(MAX_CHILD_HISTORY_PAGE + 1))).toBe(1);
  });
});
