import { PREVIEW_E2E_TEST_FILES } from "./preview-runner";

export type PreviewTestSource = typeof PREVIEW_E2E_TEST_FILES[number];
export type PreviewTestStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
export type PreviewRunStatus = "passed" | "failed" | "timedout" | "interrupted";
export type PreviewTestCount = { selected: number; passed: number; failed: number; timedOut: number; skipped: number; interrupted: number; unexecuted: number };
export function buildSafePreviewTestCounts(input: { selected: Array<{ source: PreviewTestSource; count: number }>; results: Array<{ source: PreviewTestSource; status: PreviewTestStatus }>; status: PreviewRunStatus; unapprovedSource: boolean }) {
  if (!["passed", "failed", "timedout", "interrupted"].includes(input.status)) throw new Error("P20_REPORT_STATUS_DENIED");
  const sources = PREVIEW_E2E_TEST_FILES.map((source) => ({ source, counts: { selected: 0, passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0, unexecuted: 0 } as PreviewTestCount }));
  const lookup = (source: PreviewTestSource) => { const found = sources.find((entry) => entry.source === source); if (!found) throw new Error("P20_REPORT_SOURCE_DENIED"); return found.counts; };
  for (const entry of input.selected) {
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error("P20_REPORT_COUNT_DENIED");
    lookup(entry.source).selected += entry.count;
  }
  for (const result of input.results) {
    if (!["passed", "failed", "timedOut", "skipped", "interrupted"].includes(result.status)) throw new Error("P20_REPORT_STATUS_DENIED");
    lookup(result.source)[result.status] += 1;
  }
  const total: PreviewTestCount = { selected: 0, passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0, unexecuted: 0 };
  for (const source of sources) {
    const completed = source.counts.passed + source.counts.failed + source.counts.timedOut + source.counts.skipped + source.counts.interrupted;
    if (completed > source.counts.selected) throw new Error("P20_REPORT_COUNT_DENIED");
    source.counts.unexecuted = source.counts.selected - completed;
    for (const key of Object.keys(total) as Array<keyof PreviewTestCount>) total[key] += source.counts[key];
  }
  // Reconstruct only fixed fields. Unknown titles, errors and result metadata
  // never enter the returned object, even if attached to the runtime input.
  return { status: input.status, errorCode: input.unapprovedSource ? "UNAPPROVED_SOURCE" : "NONE", total, sources };
}
