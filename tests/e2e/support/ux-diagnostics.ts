import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadUxManifest } from "./ux-manifest";
import type { UxTrace } from "./ux-trace";

// The workflow uploads ONLY these two files, never the runtime or browser output.
export const uxDiagnosticPaths = {
  results: "test-results/ux-diagnostics/results.json",
  statuses: "test-results/ux-diagnostics/statuses.json",
} as const;

export function diagnosticSecrets(environment: Record<string, string | undefined> = process.env): string[] {
  const secrets = Object.entries(environment)
    .filter(([key]) => key !== "UX_SECURE_LOOPBACK_COOKIE_SUPPORTED" && /PASSWORD|SECRET|TOKEN|COOKIE|DATABASE_URL|DIRECT_URL|STORAGE_STATE/i.test(key))
    .flatMap(([, value]) => value ? [value] : []);
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    try { const url = new URL(environment[key] ?? ""); secrets.push(decodeURIComponent(url.password), decodeURIComponent(url.username)); } catch { /* No URL configured. */ }
  }
  if (environment.UX_MANIFEST_PATH) {
    // Fail closed: publishing errors without the credential inventory is unsafe.
    const manifest = loadUxManifest(environment.UX_MANIFEST_PATH);
    for (const account of manifest.accounts) secrets.push(account.email, account.password, account.finalPassword);
    secrets.push(...Object.entries(manifest.environment).filter(([key]) => key !== "UX_SECURE_LOOPBACK_COOKIE_SUPPORTED" && /PASSWORD|SECRET|TOKEN|COOKIE|EMAIL|STORAGE_STATE/i.test(key)).map(([, value]) => value));
  }
  return [...new Set(secrets.filter((secret) => secret.length > 0))].sort((a, b) => b.length - a.length);
}

/** Allow only assertion text and stack frames, with no source/page/credential dumps. */
export function scrubDiagnosticText(input: string, secrets: readonly string[]): string {
  if (/(?:set-cookie|cookie|authorization)\s*[:=]|\bbearer\s+|["'](?:cookies|origins|headers|storageState)["']\s*:|<(?:html|body|script)\b/i.test(input)) return "[REDACTED sensitive content]";
  let text = input.replace(/\u001b\[[0-9;]*m/g, "");
  for (const secret of secrets) {
    for (const value of new Set([secret, encodeURIComponent(secret)])) text = text.split(value).join("[REDACTED]");
  }
  return text.split("\n").filter((line) => !/^\s*(?:>\s*)?\d+\s*\||^\s*\^+\s*$/.test(line)).map((line) => {
    return line
      .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s<>"')\]]+/gi, (value) => {
        try {
          const url = new URL(value);
          if (url.origin === "http://127.0.0.1:3000" && !url.username && !url.password
            && /^(?:\/reservation-applications(?:\/|$)|\/classes(?:\/|$)|\/login$|\/dashboard$)/.test(url.pathname)
            && [...url.searchParams.keys()].every((key) => ["classScheduleId", "status", "page", "notification", "bankRecord", "q", "child"].includes(key))) return value;
        } catch { /* Invalid or credential-bearing URLs are withheld. */ }
        return "[REDACTED_URL]";
      })
      .replace(/\/apply(?:\/[^\s<>"')\]]*)?/gi, "[REDACTED_CAPABILITY_PATH]")
      // Application capabilities are 32–128 base64url characters, even without a URL.
      .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,128}(?![A-Za-z0-9_-])/g, (value) =>
        /^(?:UX[0-9]*_(?:(?:UNKNOWN_|PURGED_|INVALID_)?SYNTHETIC)_|ux2?-[0-9a-f]{8}-[0-9a-f]{4}-)/.test(value)
          ? value : "[REDACTED_OPAQUE_VALUE]")
      .replace(/(?:[A-Za-z]:)?[^\s"'<>]*(?:ux-runtime|storage-state|\.env(?:\.[\w-]+)?)[^\s"'<>]*/gi, "[REDACTED_PATH]")
      .replace(/\b(?:password|token|secret)\s*[=:]\s*[^\s,;]+/gi, "[REDACTED credential]");
  }).join("\n");
}

export interface DiagnosticError { message?: string; stack?: string }
export interface DiagnosticTest {
  title: string; file: string; line: number; status: string; expectedStatus: string;
  classification: "passed" | "BLOCKED" | "failed"; blockedReason?: string; errors: DiagnosticError[]; traces?: UxTrace[];
}
export interface DiagnosticRun {
  project: string; spec: string; status: string;
  counts: { discovered: number; completed: number; passed: number; blocked: number };
  tests: DiagnosticTest[]; errors: DiagnosticError[];
}

// Preserve previous spec results across separate Playwright invocations. No config,
// stdio, attachments, source snippets, environment or arbitrary TestResult fields.
export function publishUxDiagnostics(run: DiagnosticRun, paths: { results: string; statuses: string } = uxDiagnosticPaths) {
  mkdirSync(dirname(resolve(paths.results)), { recursive: true });
  let previous: DiagnosticRun[] = [];
  try { previous = JSON.parse(readFileSync(paths.statuses, "utf8")).runs as DiagnosticRun[]; }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const runs = [...previous.filter((item) => item.project !== run.project || item.spec !== run.spec), run];
  writeFileSync(paths.statuses, JSON.stringify({ runs }, null, 2));
  // Playwright-shaped projection: tools can inspect suites/specs/tests/results/errors.
  writeFileSync(paths.results, JSON.stringify({ suites: runs.map((item) => ({
    title: item.spec, file: item.spec, project: item.project,
    specs: item.tests.map((test) => ({ title: test.title, file: test.file, line: test.line,
      tests: [{ projectName: item.project, expectedStatus: test.expectedStatus, results: [{ status: test.status, errors: test.errors, ...(test.traces?.length ? { traces: test.traces } : {}) }] }],
    })), errors: item.errors, status: item.status,
  })) }, null, 2));
}

export function publishUxInfrastructureFailure(project: string, spec: string, failures: string[]) {
  let previous: DiagnosticRun | undefined;
  try {
    const stored = JSON.parse(readFileSync(uxDiagnosticPaths.statuses, "utf8")) as { runs: DiagnosticRun[] };
    previous = stored.runs.find((run) => run.project === project && run.spec === spec);
  } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  publishUxDiagnostics({
    project, spec, status: "failed", counts: previous?.counts ?? { discovered: 0, completed: 0, passed: 0, blocked: 0 },
    tests: previous?.tests ?? [], errors: [...previous?.errors ?? [], ...failures.map((message) => ({ message }))],
  });
}
