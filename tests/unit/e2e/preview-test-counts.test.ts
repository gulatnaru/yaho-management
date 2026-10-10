import { describe, expect, it } from "vitest";
import { buildSafePreviewTestCounts, type PreviewTestSource, type PreviewTestStatus } from "@/lib/e2e/preview-test-counts";

const source: PreviewTestSource = "tests/e2e/phase20-postgres-races.spec.ts";
describe("safe Preview per-source execution counts", () => {
  it("distinguishes real passed, failed, skipped and unexecuted cases without output or titles", () => {
    const input = { selected: [{ source, count: 12 }], results: [{ source, status: "passed" as const }, { source, status: "failed" as const }, { source, status: "skipped" as const }], status: "failed" as const, unapprovedSource: false, rawError: "private", title: "private" };
    const report = buildSafePreviewTestCounts(input);
    expect(report.total).toEqual({ selected: 12, passed: 1, failed: 1, skipped: 1, timedOut: 0, interrupted: 0, unexecuted: 9 });
    expect(report.sources.find((entry) => entry.source === source)?.counts).toEqual(report.total);
    expect(JSON.stringify(report)).not.toContain("private");
  });
  it("does not mistake zero selected cases or skipped cases for executed passes", () => {
    expect(buildSafePreviewTestCounts({ selected: [], results: [], status: "passed", unapprovedSource: false }).total.passed).toBe(0);
    expect(buildSafePreviewTestCounts({ selected: [{ source, count: 1 }], results: [{ source, status: "skipped" }], status: "passed", unapprovedSource: false }).total).toMatchObject({ passed: 0, skipped: 1 });
  });
  it("records an unapproved source only as a fixed error", () => {
    expect(buildSafePreviewTestCounts({ selected: [], results: [], status: "failed", unapprovedSource: true }).errorCode).toBe("UNAPPROVED_SOURCE");
  });
  it("rejects arbitrary sources/statuses, invalid counts and results exceeding selection", () => {
    expect(() => buildSafePreviewTestCounts({ selected: [{ source: "private" as PreviewTestSource, count: 1 }], results: [], status: "passed", unapprovedSource: false })).toThrow("P20_REPORT_SOURCE_DENIED");
    expect(() => buildSafePreviewTestCounts({ selected: [{ source, count: -1 }], results: [], status: "passed", unapprovedSource: false })).toThrow("P20_REPORT_COUNT_DENIED");
    expect(() => buildSafePreviewTestCounts({ selected: [{ source, count: 1 }], results: [{ source, status: "private" as PreviewTestStatus }], status: "passed", unapprovedSource: false })).toThrow("P20_REPORT_STATUS_DENIED");
    expect(() => buildSafePreviewTestCounts({ selected: [], results: [{ source, status: "passed" }], status: "passed", unapprovedSource: false })).toThrow("P20_REPORT_COUNT_DENIED");
  });
});
