import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { PHASE20_PREVIEW_RUN_ID_PATTERN } from "@/lib/e2e/phase20-lease";
import { PREVIEW_E2E_TEST_FILES } from "@/lib/e2e/preview-runner";
import { buildSafePreviewTestCounts, type PreviewTestSource, type PreviewTestStatus } from "@/lib/e2e/preview-test-counts";

export default class PreviewSafeReporter implements Reporter {
  private selected = new Map<PreviewTestSource, number>();
  private results = new Map<string, { source: PreviewTestSource; status: PreviewTestStatus }>();
  private unapprovedSource = false;
  private source(test: TestCase): PreviewTestSource | undefined {
    const source = PREVIEW_E2E_TEST_FILES.find((file) => path.resolve(file) === path.resolve(test.location.file));
    if (!source) this.unapprovedSource = true;
    return source;
  }
  onBegin(_config: unknown, suite: Suite): void {
    for (const test of suite.allTests()) { const source = this.source(test); if (source) this.selected.set(source, (this.selected.get(source) ?? 0) + 1); }
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    const source = this.source(test);
    // IDs stay in memory to overwrite retries with their final result. Neither
    // IDs nor titles, output, attachments or errors are serialized.
    if (source) this.results.set(test.id, { source, status: result.status });
  }
  onEnd(result: FullResult): void {
    const runId = process.env.YAHO_E2E_RUN_ID ?? "";
    if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1" || !PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId)) throw new Error("P20_REPORT_RUN_GUARD_DENIED");
    const report = buildSafePreviewTestCounts({ selected: [...this.selected].map(([source, count]) => ({ source, count })), results: [...this.results.values()], status: result.status, unapprovedSource: this.unapprovedSource });
    const target = path.resolve("test-results", `preview-e2e-${runId}.safe-tests.json`);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(report) + "\n", { encoding: "utf8", mode: 0o600 });
    if (this.unapprovedSource) throw new Error("P20_REPORT_SOURCE_DENIED");
  }
}
