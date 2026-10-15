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
  it("persists fixed failure locations and clears them when a retry finally passes",()=>{
    vi.stubEnv("PLAYWRIGHT_PREVIEW_E2E","1");vi.stubEnv("YAHO_E2E_RUN_ID","preview-abcdefghijklmnopqrstuv");vi.stubEnv("PREVIEW_E2E_FOCUS","PHASE21");
    const reporter=new PreviewSafeReporter();
    const item={id:"PRIVATE_ID",title:"PRIVATE_TITLE",location:{file:path.resolve("tests/e2e/phase21-ai-consultations.spec.ts"),line:26}} as TestCase;
    reporter.onBegin({}, {allTests:()=>[item]} as unknown as Suite);
    reporter.onTestEnd(item,{status:"failed",errors:[{stack:"PRIVATE_BODY\n at lib/e2e/phase21-cleanup.ts:244:11"}]} as TestResult);
    reporter.onEnd({status:"failed"} as FullResult);
    const failed=JSON.parse(fs.write.mock.calls[0][1]);
    expect(failed.failures).toEqual([{stage:"CLEANUP",source:"lib/e2e/phase21-cleanup.ts",line:244,testLine:26,operation:"UNKNOWN",pgStage:"UNKNOWN",pgObservedCode:"UNKNOWN",pgCallerLine:null}]);
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_");
    reporter.onTestEnd(item,{status:"passed",errors:[]} as unknown as TestResult);reporter.onEnd({status:"passed"} as FullResult);
    expect(JSON.parse(fs.write.mock.calls[1][1]).failures).toEqual([]);
  });
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

it("default regression reports contain only fixed failure metadata",()=>{vi.stubEnv("PLAYWRIGHT_PREVIEW_E2E","1");vi.stubEnv("YAHO_E2E_RUN_ID","preview-abcdefghijklmnopqrstuv");delete process.env.PREVIEW_E2E_FOCUS;const reporter=new PreviewSafeReporter();const item={id:"PRIVATE_ID",title:"PRIVATE_TITLE",location:{file:path.resolve("tests/e2e/phase20-postgres-races.spec.ts"),line:97}} as TestCase;reporter.onBegin({}, {allTests:()=>[item]} as unknown as Suite);reporter.onTestEnd(item,{status:"failed",errors:[{stack:"PRIVATE at tests/e2e/phase20-postgres-races.spec.ts:136:11",message:"PHASE20_RACE_OUTCOME:PRISMA_P2028,FULFILLED"}]} as TestResult);reporter.onEnd({status:"failed"} as FullResult);const data=String(fs.write.mock.calls[0][1]);expect(data).not.toContain("PRIVATE");expect(JSON.parse(data).failures[0]).toMatchObject({stage:"PHASE20_POSTGRES",line:136,testLine:97,diagnostic:"PHASE20_RACE_OUTCOME:PRISMA_P2028,FULFILLED"});});
