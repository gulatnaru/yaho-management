import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeUxSpecs, uxSpecOrder, type UxExecutionDependencies } from "../../e2e/support/ux-cli";
import UxReporter from "../../e2e/support/ux-reporter";
import type { FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import type { UxManifest } from "../../e2e/support/ux-manifest";

const manifest: UxManifest = { project: "mobile-webkit-390", accounts: [], environment: { E2E_UX_ADMIN_ID: "synthetic-admin" } };
function setup() {
  const settings = { count: vi.fn(async () => 0), create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 1 })) };
  const dependencies: UxExecutionDependencies = {
    db: { reservationApplicationSettings: settings } as unknown as UxExecutionDependencies["db"],
    exists: vi.fn(() => true), execute: vi.fn(async () => 0), recordFailure: vi.fn(),
  };
  return { settings, dependencies };
}
beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe("UX all-spec strict aggregation", () => {
  it("executes through the final spec after the first process fails and retains its failure", async () => {
    const { settings, dependencies } = setup();
    vi.mocked(dependencies.execute).mockResolvedValueOnce(1);
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(vi.mocked(dependencies.execute).mock.calls.map(([spec]) => spec)).toEqual(uxSpecOrder);
    expect(outcomes[0].failures).toEqual(["UX_SPEC_PROCESS_FAILED"]);
    expect(outcomes.slice(1).every((outcome) => outcome.failures.length === 0)).toBe(true);
    expect(settings.deleteMany).toHaveBeenCalledWith({ where: { id: 1, updatedById: "synthetic-admin", bankName: "합성 은행", accountNumber: "000000", accountHolder: "합성 예금주" } });
    expect(dependencies.recordFailure).toHaveBeenCalledWith("mobile-webkit-390", "integrated-ux-family-list.spec.ts", ["UX_SPEC_PROCESS_FAILED"]);
  });
  it("retains an unexpected-skip strict failure and still executes the last spec", async () => {
    const { dependencies } = setup();
    vi.mocked(dependencies.execute).mockImplementationOnce(async () => {
      const test = { title: "ordinary required test", location: { file: "integrated-ux-family-list.spec.ts", line: 1 }, expectedStatus: "passed" } as TestCase;
      const reporter = new UxReporter(); reporter.onBegin(undefined, { allTests: () => [test] } as Suite);
      reporter.onTestEnd(test, { status: "skipped" } as TestResult);
      return (await reporter.onEnd({ status: "passed" } as FullResult))?.status === "failed" ? 1 : 0;
    });
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(outcomes[0].failures).toEqual(["UX_SPEC_PROCESS_FAILED"]);
    expect(vi.mocked(dependencies.execute).mock.calls.at(-1)?.[0]).toBe("full-journey");
  });
  it("continues after missing specs, spawn errors and signal exits while retaining each failure", async () => {
    const { dependencies } = setup();
    vi.mocked(dependencies.exists).mockImplementation((path) => !path.includes("family-list"));
    vi.mocked(dependencies.execute).mockRejectedValueOnce(new Error("MUST_NOT_LOG_THIS_SECRET")).mockResolvedValueOnce(null);
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(outcomes[0].failures).toEqual(["UX_REQUIRED_SPEC_MISSING"]);
    expect(outcomes[1].failures).toEqual(["UX_SPEC_PROCESS_FAILED"]);
    expect(outcomes[2].failures).toEqual(["UX_SPEC_PROCESS_FAILED"]);
    expect(vi.mocked(dependencies.execute).mock.calls.at(-1)?.[0]).toBe("full-journey");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("MUST_NOT_LOG_THIS_SECRET");
  });
  it.each(["exception", "ownership"])("retains both process and %s cleanup failures without hiding later specs", async (failure) => {
    const { settings, dependencies } = setup();
    vi.mocked(dependencies.execute).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    if (failure === "exception") settings.deleteMany.mockRejectedValueOnce(new Error("private DB diagnostics"));
    else settings.deleteMany.mockResolvedValueOnce({ count: 0 });
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(outcomes[1].failures).toEqual(["UX_SPEC_PROCESS_FAILED", failure === "exception" ? "UX_SETTINGS_CLEANUP_FAILED" : "UX_SETTINGS_OWNERSHIP_LOST"]);
    expect(vi.mocked(dependencies.execute).mock.calls.at(-1)?.[0]).toBe("full-journey");
  });
  it("refuses an existing settings singleton, never removes unowned settings and continues", async () => {
    const { settings, dependencies } = setup(); settings.count.mockResolvedValueOnce(1);
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(outcomes[1].failures).toEqual(["UX_CLASS_SETTINGS_ALREADY_EXIST"]);
    expect(settings.create).not.toHaveBeenCalled(); expect(settings.deleteMany).not.toHaveBeenCalled();
    expect(vi.mocked(dependencies.execute).mock.calls.at(-1)?.[0]).toBe("full-journey");
  });
  it("keeps setup and diagnostic-write failures fatal and still attempts later specs", async () => {
    const { settings, dependencies } = setup();
    settings.create.mockRejectedValueOnce(new Error("private DB diagnostics"));
    vi.mocked(dependencies.recordFailure).mockImplementationOnce(() => { throw new Error("private path"); });
    const outcomes = await executeUxSpecs(manifest, "synthetic-manifest", dependencies);
    expect(outcomes[1].failures).toEqual(["UX_SPEC_SETUP_FAILED", "UX_DIAGNOSTIC_PUBLICATION_FAILED"]);
    expect(vi.mocked(dependencies.execute).mock.calls.at(-1)?.[0]).toBe("full-journey");
  });
});
