import type { File, Task } from "@vitest/runner";
import type { Reporter } from "vitest/reporters";
import { writeSync } from "node:fs";
import { emptyReport, safeReport, serializeReport, type Report } from "./contract";

export function reportFromTasks(files: readonly Task[], errors: readonly unknown[]): Report {
  let candidate: unknown;
  let failed = errors.length > 0;
  const visit = (task: Task): void => {
    if (task.result?.state === "fail") failed = true;
    if ("obs01" in task.meta) candidate = task.meta.obs01;
    if ("tasks" in task) task.tasks.forEach(visit);
  };
  files.forEach(visit);
  let report: Report;
  try {
    report = candidate === undefined ? emptyReport("INCOMPLETE") : safeReport(candidate);
    if (candidate === undefined) {
      report.status = "INCOMPLETE"; report.primaryCountsKnown = false;
      for (const row of report.rows) row.status = "INCOMPLETE";
    }
  }
  catch {
    report = emptyReport("PROTOCOL"); report.status = "INVALID"; report.primaryCountsKnown = false;
    for (const row of report.rows) row.status = "INCOMPLETE";
  }
  if (failed && report.status === "COMPLETE") {
    report.status = "INVALID"; report.failure = "UNKNOWN_INFRASTRUCTURE";
  }
  return report;
}

export default class SanitizedReporter implements Reporter {
  onFinished(files: File[], errors: unknown[]): void {
    const report = reportFromTasks(files, errors);
    if (report.status !== "COMPLETE") process.exitCode = 1;
    writeSync(1, serializeReport(report) + "\n");
  }
  onUserConsoleLog(): void { /* Payloads are deliberately ignored. */ }
}
