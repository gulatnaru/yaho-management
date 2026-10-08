import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewE2eSafeSummaryPath, writePreviewE2eSafeSummary } from "@/lib/e2e/preview-run-summary";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Preview E2E safe run summary", () => {
  it("writes a run-owned JSON artifact containing only fixed operational fields", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "yaho-preview-summary-"));
    directories.push(workspace);
    const pathname = previewE2eSafeSummaryPath("preview-abcdefghijklmnopqrstuv", workspace);

    writePreviewE2eSafeSummary(pathname, {
      phase: "PLAYWRIGHT",
      playwright: "EXIT_NONZERO",
      cleanup: "PENDING",
      errorCode: "NONE",
      childExitCode: 1,
      testCounts: "UNKNOWN",
    });

    expect(pathname).toContain(path.join("test-results", "preview-e2e-preview-abcdefghijklmnopqrstuv.safe-summary.json"));
    expect(JSON.parse(readFileSync(pathname, "utf8"))).toEqual({
      phase: "PLAYWRIGHT",
      playwright: "EXIT_NONZERO",
      cleanup: "PENDING",
      errorCode: "NONE",
      childExitCode: 1,
      testCounts: "UNKNOWN",
    });
  });

  it("refuses a path that is not owned by a valid guarded Preview run", () => {
    expect(() => previewE2eSafeSummaryPath("not-a-run")).toThrowError("Invalid Preview E2E run id");
  });

  it("refuses an unsafe child exit value instead of persisting arbitrary observer data", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "yaho-preview-summary-"));
    directories.push(workspace);
    const pathname = previewE2eSafeSummaryPath("preview-abcdefghijklmnopqrstuv", workspace);

    expect(() => writePreviewE2eSafeSummary(pathname, {
      phase: "FAILED",
      playwright: "UNPROVEN",
      cleanup: "UNPROVEN",
      errorCode: "UNEXPECTED_FAILURE",
      childExitCode: -1,
      testCounts: "UNKNOWN",
    })).toThrowError("child exit code must be non-negative");
  });

  it("keeps child Playwright output out of the terminal and writes the summary before spawning it", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/e2e/preview.ts"), "utf8");

    expect(source).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(source).not.toContain('stdio: "inherit"');
    expect(source.indexOf("updateSafeSummary({});")).toBeLessThan(source.indexOf("const exitCode = await runPlaywright("));
  });
});
