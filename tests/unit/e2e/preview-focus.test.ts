import { describe, expect, it } from "vitest";
import { previewPlaywrightArguments, GROUP_POSITIVE_TITLE } from "@/lib/e2e/preview-focus";
import { PREVIEW_E2E_TEST_FILES } from "@/lib/e2e/preview-runner";

describe("fixed Preview execution scopes", () => {
  it("keeps the complete approved suite as the default", () => expect(previewPlaywrightArguments(undefined)).toEqual(["test", ...PREVIEW_E2E_TEST_FILES]));
  it("selects only the exact group positive for the minimal first-completion flow", () => {
    const args = previewPlaywrightArguments("MINIMAL");
    expect(args.slice(0, 3)).toEqual(["test", "tests/e2e/phase20-application-group-siblings.spec.ts", "--grep"]);
    const pattern = new RegExp(args[3]!);
    expect(pattern.test(GROUP_POSITIVE_TITLE)).toBe(true);
    expect(pattern.test("A. rejects an unknown group capability")).toBe(false);
    expect(pattern.test(GROUP_POSITIVE_TITLE + " extra")).toBe(false);
  });
  it("selects one full group flow without the minimal early return", () => {
    expect(previewPlaywrightArguments("GROUP_POSITIVE_FULL")).toEqual(previewPlaywrightArguments("MINIMAL"));
  });
  it("selects one finance or companion positive without accepting a caller-provided path", () => {
    for (const [scope, source, excluded] of [["FINANCE_POSITIVE", "tests/e2e/phase20-application-finance-returns.spec.ts", GROUP_POSITIVE_TITLE], ["COMPANION_POSITIVE", "tests/e2e/phase20-companion-repeat-privacy.spec.ts", GROUP_POSITIVE_TITLE]]) {
      const args = previewPlaywrightArguments(scope);
      expect(args.slice(0, 3)).toEqual(["test", source, "--grep"]);
      expect(new RegExp(args[3]!).test(excluded)).toBe(false);
    }
  });
  it("selects three exact positive tests or the four Phase20 suites without arbitrary flags", () => {
    const args = previewPlaywrightArguments("THREE_POSITIVE");
    expect(args.slice(1, 4)).toEqual(PREVIEW_E2E_TEST_FILES.slice(3, 6));
    const pattern = new RegExp(args[5]!);
    expect(pattern.test(GROUP_POSITIVE_TITLE)).toBe(true);
    expect(pattern.test("C/D. public guide and notification lead to selected confirmation and partial actual returns without a Refund")).toBe(true);
    expect(pattern.test("E/F/G/H. owned device rotation, companion consent, and scoped purge stay capability-bound")).toBe(true);
    expect(pattern.test("F. returns an empty device-scoped repeat DTO without a device cookie")).toBe(false);
    expect(previewPlaywrightArguments("PHASE20")).toEqual(["test", ...PREVIEW_E2E_TEST_FILES.slice(3)]);
  });
  it("keeps the legacy browser context and finance in a fixed ordered four-file selection", () => {
    expect(previewPlaywrightArguments("LEGACY_FINANCE")).toEqual([
      "test", "tests/e2e/auth.spec.ts", "tests/e2e/phase6-access.spec.ts",
      "tests/e2e/phase11-core-operations.spec.ts", "tests/e2e/phase20-application-finance-returns.spec.ts",
    ]);
    expect(previewPlaywrightArguments(undefined)).toEqual(["test", ...PREVIEW_E2E_TEST_FILES]);
  });
  it.each(["", "../auth.spec.ts", "--headed", "MINIMAL.*", "LEGACY_FINANCE --headed", "LEGACY_FINANCE/../auth.spec.ts", "__proto__", "PUBLIC_COMPLETION_DIAGNOSTIC", "PUBLIC_COMPLETION_DURATION_DIAGNOSTIC"])("denies non-allowlisted scope %s", (scope) => expect(() => previewPlaywrightArguments(scope)).toThrow("P20_FOCUS_SELECTION_DENIED"));
});
