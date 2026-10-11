import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PHASE20_PREVIEW_RUN_ID_PATTERN } from "./phase20-lease";

export type PreviewE2eSafeSummary = {
  phase: "PREFLIGHT" | "RUNNING" | "PLAYWRIGHT" | "CLEANUP" | "COMPLETE" | "FAILED";
  playwright: "NOT_STARTED" | "RUNNING" | "EXIT_0" | "EXIT_NONZERO" | "INTERRUPTED" | "UNPROVEN";
  cleanup: "NOT_STARTED" | "PENDING" | "PASSED" | "FAILED" | "UNPROVEN";
  errorCode: "NONE" | "PREVIEW_SAFETY_ERROR" | "PRISMA_P2028" | "UNEXPECTED_FAILURE";
  childExitCode: number | null;
  testCounts: "UNKNOWN";
};

/**
 * Persist only fixed operational state before Playwright inherits stdout. The
 * run id appears in the filename for artifact ownership, never in the JSON.
 */
export function previewE2eSafeSummaryPath(runId: string, workspace = process.cwd()): string {
  if (!PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId)) throw new Error("Invalid Preview E2E run id");
  return path.resolve(workspace, "test-results", `preview-e2e-${runId}.safe-summary.json`);
}

export function writePreviewE2eSafeSummary(pathname: string, summary: PreviewE2eSafeSummary): void {
  if (!Number.isInteger(summary.childExitCode) && summary.childExitCode !== null) {
    throw new Error("Preview E2E child exit code must be an integer or null");
  }
  if (typeof summary.childExitCode === "number" && summary.childExitCode < 0) {
    throw new Error("Preview E2E child exit code must be non-negative");
  }
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, `${JSON.stringify(summary)}\n`, { encoding: "utf8", mode: 0o600 });
}
