import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { basename } from "node:path";
import { diagnosticSecrets, publishUxDiagnostics, scrubDiagnosticText, type DiagnosticError, type DiagnosticTest } from "./ux-diagnostics";

// These cases require a separately provisioned app/read-failure mechanism. Never
// disable authentication, break the shared DB, or silently count them as passing.
export const blockedUxCases = new Map([
  ["integrated-ux-family-list.spec.ts:first-ever zero has a different message", "BLOCKED: requires a separately provisioned empty authenticated server; shared fixture DB is populated."],
  ["integrated-ux-family-list.spec.ts:failed read displays retry rather than zero or success", "BLOCKED: requires a controlled authenticated server read failure; no fault-injection mechanism exists."],
  ["integrated-ux-family-detail.spec.ts:shows retry without a success/zero-balance fallback", "BLOCKED: requires a controlled authenticated detail read failure; no fault-injection mechanism exists."],
]);
const secureCookieCases = new Set([
  "integrated-ux-completion.spec.ts:successful submission replaces the document; reload and back do not restore inputs or resubmit",
  "integrated-ux-full-journey.spec.ts:real ADMIN login → class creation/prices → issued link → two children → bank record → selected reservation only",
]);
export function blockedUxReason(file: string, title: string) {
  const key = `${basename(file)}:${title}`;
  return blockedUxCases.get(key) ?? (process.env.UX_SECURE_LOOPBACK_COOKIE_SUPPORTED === "false" && secureCookieCases.has(key)
    ? "BLOCKED: measured browser policy rejects the app's Secure completion cookie at the mandatory http://127.0.0.1:3000 origin. No cookie flags or capabilities were changed."
    : undefined);
}

export default class UxReporter implements Reporter {
  private expected = 0;
  private completed = 0;
  private passed = 0;
  private blocked = 0;
  private invalid = false;
  private tests: DiagnosticTest[] = [];
  private errors: DiagnosticError[] = [];
  private project = process.env.UX_PROJECT ?? "unknown";
  private spec = process.env.UX_DIAGNOSTIC_SPEC ?? "unknown";
  private secrets: string[] = process.env.UX_CI === "1" ? diagnosticSecrets() : [];
  onBegin(config: FullConfig | undefined, suite: Suite) {
    this.expected = suite.allTests().length;
    this.project = process.env.UX_PROJECT ?? suite.allTests()[0]?.parent?.project()?.name ?? config?.projects[0]?.name ?? "unknown";
    this.spec = process.env.UX_DIAGNOSTIC_SPEC ?? basename(suite.allTests()[0]?.location.file ?? "unknown");
  }
  private error(error: TestError): DiagnosticError {
    return {
      ...(error.message ? { message: scrubDiagnosticText(error.message, this.secrets) } : {}),
      ...(error.stack ? { stack: scrubDiagnosticText(error.stack, this.secrets) } : {}),
    };
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.completed++;
    const blockedReason = result.status === "skipped" ? blockedUxReason(test.location.file, test.title) : undefined;
    this.tests.push({
      title: scrubDiagnosticText(typeof test.titlePath === "function" ? test.titlePath().filter(Boolean).join(" › ") : test.title, this.secrets), file: basename(test.location.file), line: test.location.line,
      status: result.status, expectedStatus: test.expectedStatus,
      classification: blockedReason ? "BLOCKED" : result.status === "passed" && test.expectedStatus === "passed" ? "passed" : "failed",
      ...(blockedReason ? { blockedReason } : {}), errors: (result.errors ?? []).map((error) => this.error(error)),
    });
    if (result.status === "passed" && test.expectedStatus === "passed") this.passed++;
    else if (result.status === "skipped" && blockedUxReason(test.location.file, test.title)) {
      this.blocked++;
      console.log(`[UX BLOCKED] ${blockedUxReason(test.location.file, test.title)}`);
    } else {
      this.invalid = true;
      // Never print assertion values, source snippets, URLs, cookies or credentials.
      console.error(`[UX FAILURE] ${basename(test.location.file)}:${test.location.line} status=${result.status}; inspect locally with synthetic data.`);
    }
  }
  onError(error?: TestError) { if (error) this.errors.push(this.error(error)); this.invalid = true; console.error("[UX FAILURE] Runner/setup error; sensitive diagnostics suppressed."); }
  async onEnd(result: FullResult) {
    console.log(`[UX TOTAL] discovered=${this.expected} completed=${this.completed} passed=${this.passed} BLOCKED=${this.blocked}`);
    const failed = !this.expected || this.completed !== this.expected || this.invalid || result.status !== "passed";
    if (process.env.UX_CI === "1") {
      try {
        publishUxDiagnostics({ project: this.project, spec: this.spec, status: failed ? "failed" : "passed",
          counts: { discovered: this.expected, completed: this.completed, passed: this.passed, blocked: this.blocked },
          tests: this.tests, errors: this.errors });
      } catch {
        this.invalid = true;
        console.error("[UX FAILURE] Safe diagnostic publication failed; sensitive diagnostics suppressed.");
      }
    }
    if (failed || this.invalid) return { status: "failed" as const };
  }
}
