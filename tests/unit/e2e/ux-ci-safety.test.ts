import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import UxReporter, { blockedUxReason } from "../../e2e/support/ux-reporter";
import { applyUxManifest, loadUxManifest, runtimePath, uxManifestSchema } from "../../e2e/support/ux-manifest";

const files: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const file of files.splice(0)) rmSync(file, { force: true, recursive: true }); });
const accounts = ["ADMIN", "MANAGER", "TEACHER"].map((role) => ({ role, email: `${role.toLowerCase()}@example.test`, password: "synthetic-only-password", finalPassword: "synthetic-only-new-password" }));
describe("UX runtime admission", () => {
  it("rejects auth/fixture files outside the ignored runtime subtree", () => {
    expect(runtimePath("test-results/ux-runtime/auth.json")).toBe(resolve("test-results/ux-runtime/auth.json"));
    for (const path of ["test-results/ux-runtime", "test-results/ux-runtime-other/auth.json", "test-results/ux-runtime/../../auth.json", "/tmp/auth.json"]) expect(() => runtimePath(path)).toThrow("UX_RUNTIME_PATH_MUST_BE_GITIGNORED");
  });
  it("requires exactly one real account for each required role", () => {
    expect(uxManifestSchema.safeParse({ project: "desktop-chromium", environment: {}, accounts }).success).toBe(true);
    expect(uxManifestSchema.safeParse({ project: "desktop-chromium", environment: {}, accounts: [accounts[0], accounts[0], accounts[0]] }).success).toBe(false);
  });
  it("cannot override DB safety or partially apply a rejected manifest", () => {
    mkdirSync("test-results/ux-runtime", { recursive: true });
    const dir = mkdtempSync("test-results/ux-runtime/unit-"); files.push(dir);
    const file = `${dir}/manifest.json`;
    writeFileSync(file, JSON.stringify({ project: "desktop-chromium", accounts, environment: { UX_TEST_SENTINEL: "synthetic", DATABASE_URL: "not-a-real-url" } }));
    vi.stubEnv("UX_TEST_SENTINEL", "before");
    expect(() => applyUxManifest(file)).toThrow("UX_MANIFEST_ENV_KEY_REJECTED");
    expect(process.env.UX_TEST_SENTINEL).toBe("before");
    writeFileSync(file, "invalid sensitive credential text");
    expect(() => loadUxManifest(file)).toThrow(/^UX_MANIFEST_INVALID_OR_MISSING$/);
  });
});

function reporterCase(title: string, file = "integrated-ux-family-list.spec.ts") {
  return { title, location: { file, line: 1 }, expectedStatus: "passed" } as TestCase;
}
function reporter(count: number) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const result = new UxReporter(); result.onBegin(undefined, { allTests: () => new Array(count) } as Suite); return result;
}
describe("UX fail-closed execution accounting", () => {
  it("allows only the three concretely documented controlled-server blockers", async () => {
    expect(blockedUxReason("integrated-ux-family-list.spec.ts", "first-ever zero has a different message")).toMatch(/^BLOCKED:/);
    expect(blockedUxReason("integrated-ux-ledger.spec.ts", "first-ever zero has a different message")).toBeUndefined();
    const result = reporter(1);
    result.onTestEnd(reporterCase("first-ever zero has a different message"), { status: "skipped" } as TestResult);
    expect(await result.onEnd({ status: "passed" } as FullResult)).toBeUndefined();
  });
  it.each(["skipped", "failed", "timedOut", "interrupted"] as const)("fails unexpected %s (including missing fixtures)", async (status) => {
    const result = reporter(1);
    result.onTestEnd(reporterCase("ordinary required scenario"), { status } as TestResult);
    expect(await result.onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
  });
  it("classifies only exact secure-cookie dependent scenarios after an actual false probe", () => {
    const title = "successful submission replaces the document; reload and back do not restore inputs or resubmit";
    vi.stubEnv("UX_SECURE_LOOPBACK_COOKIE_SUPPORTED", "true");
    expect(blockedUxReason("integrated-ux-completion.spec.ts", title)).toBeUndefined();
    vi.stubEnv("UX_SECURE_LOOPBACK_COOKIE_SUPPORTED", "false");
    expect(blockedUxReason("integrated-ux-completion.spec.ts", title)).toMatch(/measured browser policy/);
    expect(blockedUxReason("integrated-ux-guardian.spec.ts", title)).toBeUndefined();
    expect(blockedUxReason("integrated-ux-completion.spec.ts", "other guardian test")).toBeUndefined();
  });
  it("fails zero discovery, missing execution and expected-failure masking", async () => {
    expect(await reporter(0).onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
    expect(await reporter(1).onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
    const result = reporter(1);
    result.onTestEnd({ ...reporterCase("ordinary"), expectedStatus: "failed" } as TestCase, { status: "failed" } as TestResult);
    expect(await result.onEnd({ status: "passed" } as FullResult)).toEqual({ status: "failed" });
  });
  it("does not print assertion credentials, source snippets or exception messages", async () => {
    const result = reporter(1);
    result.onTestEnd(reporterCase("ordinary"), { status: "failed", errors: [{ message: "SYNTHETIC_CREDENTIAL_MUST_NOT_PRINT" }] } as TestResult);
    result.onError();
    await result.onEnd({ status: "failed" } as FullResult);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("SYNTHETIC_CREDENTIAL_MUST_NOT_PRINT");
  });
});
