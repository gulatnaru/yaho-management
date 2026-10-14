import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
const fs = vi.hoisted(() => ({ mkdir: vi.fn(), write: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  mkdirSync: fs.mkdir,
  writeFileSync: fs.write,
}));
import PreviewSafeReporter from "../../e2e/support/preview-safe-reporter";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("optional Phase21 safe reporter", () => {
  it("records fixed per-source counts without titles/ids/errors", () => {
    vi.stubEnv("PLAYWRIGHT_PREVIEW_E2E", "1");
    vi.stubEnv("YAHO_E2E_RUN_ID", "preview-abcdefghijklmnopqrstuv");
    vi.stubEnv("PREVIEW_E2E_FOCUS", "PHASE21");
    const reporter = new PreviewSafeReporter();
    const test = {
      id: "SYNTHETIC_PRIVATE_CASE",
      title: "SYNTHETIC_PRIVATE_TITLE",
      location: {
        file: path.resolve("tests/e2e/phase21-ai-consultations.spec.ts"),
      },
    } as TestCase;
    reporter.onBegin({}, { allTests: () => [test] } as unknown as Suite);
    reporter.onTestEnd(test, {
      status: "passed",
      error: { message: "SYNTHETIC_PRIVATE_ERROR" },
    } as TestResult);
    reporter.onEnd({ status: "passed" } as FullResult);
    const data = fs.write.mock.calls[0][1] as string;
    const parsed = JSON.parse(data);
    expect(parsed.total).toMatchObject({ selected: 1, passed: 1, failed: 0 });
    expect(parsed.sources.map((row: { source: string }) => row.source)).toEqual(
      ["tests/e2e/phase21-ai-consultations.spec.ts"],
    );
    expect(data).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("refuses an unselected old source under PHASE21 without leaking its metadata", () => {
    vi.stubEnv("PLAYWRIGHT_PREVIEW_E2E", "1");
    vi.stubEnv("YAHO_E2E_RUN_ID", "preview-abcdefghijklmnopqrstuv");
    vi.stubEnv("PREVIEW_E2E_FOCUS", "PHASE21");
    const reporter = new PreviewSafeReporter();
    const test = {
      id: "PRIVATE",
      location: { file: path.resolve("tests/e2e/auth.spec.ts") },
    } as TestCase;
    reporter.onBegin({}, { allTests: () => [test] } as unknown as Suite);
    expect(() => reporter.onEnd({ status: "failed" } as FullResult)).toThrow(
      "P20_REPORT_SOURCE_DENIED",
    );
    expect(fs.write.mock.calls[0][1]).not.toContain("PRIVATE");
  });
});
