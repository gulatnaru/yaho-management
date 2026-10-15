import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { PHASE20_PREVIEW_RUN_ID_PATTERN } from "@/lib/e2e/phase20-lease";
import { previewTestSourcesForFocus } from "@/lib/e2e/preview-focus";
import { buildSafePreviewTestCounts, type PreviewTestSource, type PreviewTestStatus } from "@/lib/e2e/preview-test-counts";

import {phase21SafeFailureLocation,phase21SafeOperation,phase21SafePgFailure} from "@/lib/e2e/phase21-safe-diagnostics";

export default class PreviewSafeReporter implements Reporter {
  private phase21Failures = new Map<string,ReturnType<typeof phase21SafeFailureLocation>&ReturnType<typeof phase21SafePgFailure>&{operation:string}>();
  private selected = new Map<PreviewTestSource, number>();
  private results = new Map<string, { source: PreviewTestSource; status: PreviewTestStatus }>();
  private unapprovedSource = false;
  private source(test: TestCase): PreviewTestSource | undefined {
    const source = previewTestSourcesForFocus(process.env.PREVIEW_E2E_FOCUS).find((file) => path.resolve(file) === path.resolve(test.location.file));
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
    if (source) {
      this.results.set(test.id, { source, status: result.status });
      if(process.env.PREVIEW_E2E_FOCUS==="PHASE21") {
        if(result.status==="passed")this.phase21Failures.delete(test.id);
        else this.phase21Failures.set(test.id,{...phase21SafeFailureLocation(result.errors?.[0]?.stack,test.location.line),operation:phase21SafeOperation(result.steps??[]),...phase21SafePgFailure(result.errors?.[0]?.message)});
      }
    }
  }
  onEnd(result: FullResult): void {
    const runId = process.env.YAHO_E2E_RUN_ID ?? "";
    if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1" || !PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId)) throw new Error("P20_REPORT_RUN_GUARD_DENIED");
    const report = buildSafePreviewTestCounts({ selected: [...this.selected].map(([source, count]) => ({ source, count })), results: [...this.results.values()], status: result.status, unapprovedSource: this.unapprovedSource, focus: process.env.PREVIEW_E2E_FOCUS });
    const target = path.resolve("test-results", `preview-e2e-${runId}.safe-tests.json`);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(process.env.PREVIEW_E2E_FOCUS==="PHASE21"?{...report,failures:[...this.phase21Failures.values()]}:report) + "\n", { encoding: "utf8", mode: 0o600 });
    if (this.unapprovedSource) throw new Error("P20_REPORT_SOURCE_DENIED");
  }
}
