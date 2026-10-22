import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { diagnosticSecrets, scrubDiagnosticText, type DiagnosticRun } from "../../e2e/support/ux-diagnostics";
import { selectUxSpecs } from "../../e2e/support/ux-selection";
import UxReporter from "../../e2e/support/ux-reporter";

const publish = vi.hoisted(() => vi.fn());
vi.mock("../../e2e/support/ux-diagnostics", async (original) => ({ ...await original<typeof import("../../e2e/support/ux-diagnostics")>(), publishUxDiagnostics: publish }));
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); publish.mockReset(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const run = (spec: string): DiagnosticRun => ({ project: "mobile-webkit-390", spec, status: "failed", counts: { discovered: 1, completed: 1, passed: 0, blocked: 0 }, tests: [{ title: "MANAGER denial › direct list", file: spec, line: 69, status: "failed", expectedStatus: "passed", classification: "failed", errors: [{ message: "Expected: 404\nReceived: 200", stack: `Error: Expected: 404\n    at ${spec}:69:20` }] }], errors: [] });

describe("synthetic assertion diagnostics privacy", () => {
  it("retains expected/actual values, source locations and benign navigation context while stripping source frames", () => {
    const input = 'Expected: true\nReceived: false\nURL: http://127.0.0.1:3000/reservation-applications?classScheduleId=synthetic-class&status=all&page=999\n  42 | await fill("password", "SOURCE_CANARY")\n> 43 | expect(actual).toBe(true)\n     |                    ^\n    at integrated-ux-family-list.spec.ts:43:10';
    const output = scrubDiagnosticText(input, diagnosticSecrets({ UX_SECURE_LOOPBACK_COOKIE_SUPPORTED: "false" }));
    expect(output).toContain("Expected: true\nReceived: false");
    expect(output).toContain("classScheduleId=synthetic-class&status=all&page=999");
    expect(output).toContain("integrated-ux-family-list.spec.ts:43:10");
    expect(output).not.toContain("SOURCE_CANARY");
    expect(output).not.toContain("expect(actual)");
    const synthetic = "UX4_SYNTHETIC_12345678-abcd-efgh_390";
    expect(scrubDiagnosticText(`Expected: ${synthetic}\nReceived: UX4_SYNTHETIC_12345678-abcd-efgh_360`, [])).toContain(synthetic);
  });
  it("removes known environment credentials, encoded passwords, auth paths, capabilities and arbitrary credential URLs", () => {
    const secrets = diagnosticSecrets({ AUTH_SECRET: "auth-canary", UX_ADMIN_PASSWORD: "password&canary", DATABASE_URL: "postgresql://fixture-user:db-canary@127.0.0.1:55432/yaho_e2e" });
    const values = ["auth-canary", "password&canary", "password%26canary", "fixture-user", "db-canary", "test-results/ux-runtime/manager.json", "/tmp/.env.local", "/tmp/admin-storage-state.json", "http://127.0.0.1:3000/apply/group/CAPABILITY_CANARY", "/apply/companion/RELATIVE_CANARY", "http://127.0.0.1:3000/reservation-applications?token=QUERY_CANARY", "http://user:password@127.0.0.1:3000/classes/id", "https://example.test/private/REMOTE_CANARY", "x".repeat(43)];
    const output = scrubDiagnosticText(`Expected: 404\nReceived: 200\n${values.join("\n")}`, secrets);
    for (const value of values) expect(output).not.toContain(value);
    for (const canary of ["CAPABILITY_CANARY", "RELATIVE_CANARY", "QUERY_CANARY", "REMOTE_CANARY"]) expect(output).not.toContain(canary);
    expect(output).toContain("Expected: 404\nReceived: 200");
  });
  it.each(['Cookie: session=SHORT_COOKIE_CANARY', 'Set-Cookie: session=SET_COOKIE_CANARY', 'Authorization: Bearer HEADER_CANARY', '{"cookies": [\n{"value": "JAR_CANARY"}]}', '{"origins": [{"localStorage": "AUTH_CANARY"}]}', '<html><body>PAGE_CANARY</body></html>'])("withholds whole dumps: %s", (input) => {
    expect(scrubDiagnosticText(input, [])).toBe("[REDACTED sensitive content]");
  });
  it("uploads exactly two safe JSON files, only on failure, before always-run cleanup", () => {
    const workflow = readFileSync(".github/workflows/e2e-ux.yml", "utf8");
    const upload = workflow.slice(workflow.indexOf("      - name: Upload synthetic"), workflow.indexOf("      - name: Stop app"));
    expect(upload).toContain("if: failure()"); expect(upload).toContain("retention-days: 3");
    expect(upload).toContain("ux-diagnostics-${{ matrix.project }}-${{ github.run_attempt }}");
    const paths = upload.match(/          path: \|\n([\s\S]*?)          retention-days:/)?.[1].trim().split("\n").map((path) => path.trim());
    expect(paths).toEqual(["test-results/ux-diagnostics/results.json", "test-results/ux-diagnostics/statuses.json"]);
    const config = readFileSync("playwright.ux.config.ts", "utf8");
    expect(config).toContain('trace: "off", screenshot: "off", video: "off"');
    expect(config).toContain('outputDir: "test-results/ux-output"');
  });
  it("scrubs every manifest account credential while preserving the measured cookie-policy boolean", () => {
    mkdirSync("test-results/ux-runtime", { recursive: true });
    const directory = mkdtempSync("test-results/ux-runtime/diagnostic-unit-"); directories.push(directory);
    const path = join(directory, "manifest.json");
    const accounts = ["ADMIN", "MANAGER", "TEACHER"].map((role) => ({ role, email: `${role.toLowerCase()}@example.test`, password: `${role}-initial-canary`, finalPassword: `${role}-final-canary` }));
    writeFileSync(path, JSON.stringify({ project: "mobile-webkit-390", accounts, environment: { UX_SECURE_LOOPBACK_COOKIE_SUPPORTED: "false" } }), { mode: 0o600 });
    const secrets = diagnosticSecrets({ UX_MANIFEST_PATH: path });
    const values = accounts.flatMap((account) => [account.email, account.password, account.finalPassword]);
    const output = scrubDiagnosticText(`Expected: true\nReceived: false\n${values.join("\n")}`, secrets);
    for (const value of values) expect(output).not.toContain(value);
    expect(output).toContain("Expected: true\nReceived: false");
  });
  it("requires a readable credential manifest before publishing when a manifest was configured", () => {
    expect(() => diagnosticSecrets({ UX_MANIFEST_PATH: "test-results/ux-runtime/missing-unit-manifest.json" })).toThrow("UX_MANIFEST_INVALID_OR_MISSING");
  });
  it("serializes focused selection and explicit omitted-spec SKIPPED reasons in both artifacts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ux-focused-")); directories.push(directory);
    const paths = { results: join(directory, "results.json"), statuses: join(directory, "statuses.json") };
    const { publishUxDiagnostics: realPublish } = await vi.importActual<typeof import("../../e2e/support/ux-diagnostics")>("../../e2e/support/ux-diagnostics");
    const selection = selectUxSpecs("integrated-ux-guardian");
    realPublish({ project: "desktop-chromium", spec: "integrated-ux-ledger.spec.ts", status: "SKIPPED", skipReason: "not-selected-focused-run", selection,
      counts: { discovered: 0, completed: 0, passed: 0, blocked: 0 }, tests: [], errors: [] }, paths);
    const statuses = JSON.parse(readFileSync(paths.statuses, "utf8"));
    const results = JSON.parse(readFileSync(paths.results, "utf8"));
    for (const item of [statuses.runs[0], results.suites[0]]) {
      expect(item).toMatchObject({ status: "SKIPPED", skipReason: "not-selected-focused-run", selection });
      expect(JSON.stringify(item)).not.toContain("272");
    }
    expect(statuses.runs[0].counts.blocked).toBe(0);
  });
  it("installs the Chromium auth harness plus each matrix test engine with a bounded timeout", () => {
    const workflow = readFileSync(".github/workflows/e2e-ux.yml", "utf8");
    expect(workflow).toContain('if [ "${{ matrix.project }}" = "desktop-chromium" ]; then');
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("install --with-deps chromium\n");
    expect(workflow).toContain("else\n            npx playwright install --with-deps chromium webkit\n");
    expect(readFileSync("tests/e2e/support/ux-auth.ts", "utf8")).toContain("chromium.launch(");
  });
  it("writes allowlisted results/status fields outside browser output and retains earlier specs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ux-diagnostics-")); directories.push(directory);
    const paths = { results: join(directory, "results.json"), statuses: join(directory, "statuses.json") };
    const { publishUxDiagnostics: realPublish } = await vi.importActual<typeof import("../../e2e/support/ux-diagnostics")>("../../e2e/support/ux-diagnostics");
    const first = run("family-list.spec.ts"); first.tests[0].traces = [{ event: "filter-clear", elapsedMs: 20, facts: { hydrated: true, defaultPrevented: true, finalUrlMatches: false } }];
    realPublish(first, paths); realPublish(run("family-detail.spec.ts"), paths);
    const results = JSON.parse(readFileSync(paths.results, "utf8"));
    const statuses = JSON.parse(readFileSync(paths.statuses, "utf8"));
    expect(results.suites).toHaveLength(2); expect(statuses.runs).toHaveLength(2);
    expect(results.suites[0].specs[0].tests[0].results[0].errors[0].message).toContain("Expected: 404");
    expect(statuses.runs[0].tests[0].classification).toBe("failed");
    expect(results.suites[0].specs[0].tests[0].results[0].traces).toEqual(first.tests[0].traces);
    expect(statuses.runs[0].tests[0].traces).toEqual(first.tests[0].traces);
    expect(Object.keys(results)).toEqual(["suites"]);
    expect(JSON.stringify(results)).not.toMatch(/attachments|stdout|storageState|config|environment/);
  });
});

function setupReporter(title: string, options: { expectedStatus?: string; status?: string; blocked?: boolean } = {}) {
  vi.stubEnv("UX_CI", "1"); vi.stubEnv("UX_MANIFEST_PATH", ""); vi.stubEnv("UX_PROJECT", "mobile-webkit-390");
  vi.spyOn(console, "log").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined);
  const test = { title, titlePath: () => ["", "MANAGER application denial", title], location: { file: "integrated-ux-family-list.spec.ts", line: 69 }, expectedStatus: options.expectedStatus ?? "passed" } as TestCase;
  const reporter = new UxReporter();
  reporter.onBegin({ projects: [{ name: "desktop-chromium" }] } as FullConfig, { allTests: () => [test] } as Suite);
  const result = { status: options.status ?? "failed", errors: [{ message: "Expected: 404\nReceived: 200", stack: "Error: Expected: 404\n    at integrated-ux-family-list.spec.ts:69:10", snippet: "SNIPPET_CANARY" }],
    annotations: [
      { type: "ux-trace", description: JSON.stringify({ event: "filter-clear", elapsedMs: 5, facts: { hydrated: true, navigationRequests: 0 } }) },
      { type: "ux-trace", description: JSON.stringify({ event: "filter-clear", elapsedMs: 5, facts: { requests: "ANNOTATION_CANARY" } }) },
      { type: "arbitrary", description: "ARBITRARY_CANARY" },
    ], stdout: ["STDOUT_CANARY"], attachments: [{ body: Buffer.from("ATTACHMENT_CANARY") }] } as unknown as TestResult;
  reporter.onTestEnd(test, result);
  return reporter;
}

describe("UX reporter diagnostic projection and strict status", () => {
  it("retains role-qualified title and errors without exporting arbitrary result fields or printing the assertion", async () => {
    const reporter = setupReporter("direct list and context query reveal no application cards/counts");
    expect(await reporter.onEnd({ status: "failed" } as FullResult)).toEqual({ status: "failed" });
    const data = publish.mock.calls[0][0] as DiagnosticRun;
    expect(data.project).toBe("mobile-webkit-390");
    expect(data.tests[0].title).toContain("MANAGER application denial › direct list");
    expect(data.tests[0].errors[0].message).toBe("Expected: 404\nReceived: 200");
    expect(data.tests[0].traces).toEqual([{ event: "filter-clear", elapsedMs: 5, facts: { hydrated: true, navigationRequests: 0 } }]);
    expect(JSON.stringify(data)).not.toMatch(/SNIPPET_CANARY|STDOUT_CANARY|ATTACHMENT_CANARY|ANNOTATION_CANARY|ARBITRARY_CANARY/);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Expected: 404");
  });
  it.each([{ status: "skipped" }, { status: "failed", expectedStatus: "failed" }])("publishes strict failure even if Playwright says passed: %o", async (options) => {
    const reporter = setupReporter("required scenario", options);
    expect(await reporter.onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
    expect(publish.mock.calls[0][0].status).toBe("failed");
  });
  it("scrubs setup errors before onBegin and identifies the attempted project/spec", async () => {
    vi.stubEnv("UX_CI", "1"); vi.stubEnv("UX_MANIFEST_PATH", ""); vi.stubEnv("AUTH_SECRET", "SHORT_AUTH_CANARY");
    vi.stubEnv("UX_PROJECT", "mobile-webkit-360"); vi.stubEnv("UX_DIAGNOSTIC_SPEC", "integrated-ux-family-list.spec.ts");
    vi.spyOn(console, "log").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reporter = new UxReporter();
    reporter.onError({ message: "Discovery failed: SHORT_AUTH_CANARY", stack: "Error: SHORT_AUTH_CANARY\n    at integrated-ux-family-list.spec.ts:1:1" });
    expect(await reporter.onEnd({ status: "failed" } as FullResult)).toEqual({ status: "failed" });
    const data = publish.mock.calls[0][0] as DiagnosticRun;
    expect(data.project).toBe("mobile-webkit-360"); expect(data.spec).toBe("integrated-ux-family-list.spec.ts");
    expect(JSON.stringify(data)).not.toContain("SHORT_AUTH_CANARY"); expect(data.errors[0].message).toContain("Discovery failed");
  });
  it("fails closed if diagnostic output cannot be written", async () => {
    const reporter = setupReporter("required scenario"); publish.mockImplementationOnce(() => { throw new Error("DO_NOT_LOG_PATH"); });
    expect(await reporter.onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("DO_NOT_LOG_PATH");
  });
  it("keeps documented per-spec BLOCKED reasons and counters", async () => {
    const reporter = setupReporter("first-ever zero has a different message", { status: "skipped" });
    expect(await reporter.onEnd({ status: "passed" } as FullResult)).toBeUndefined();
    const data = publish.mock.calls[0][0] as DiagnosticRun;
    expect(data.status).toBe("passed"); expect(data.counts.blocked).toBe(1);
    expect(data.tests[0].classification).toBe("BLOCKED"); expect(data.tests[0].blockedReason).toMatch(/^BLOCKED:/);
  });
});
