import { spawn } from "node:child_process";
import { appendFileSync, writeSync } from "node:fs";
import path from "node:path";
import { emptyReport, failureCode, markdown, PROTOCOL_PREFIX, requireFact, safeReport, SafeFailure, type Report } from "./contract";
import { guardEnvironment } from "./environment";

export type PrivateChildResult = { status: number | null; stdout: string; stderr: string; overflow: boolean };
const MAX_STREAM_BYTES = 4 * 1024 * 1024;

export function privateChild(args: readonly string[], environment: NodeJS.ProcessEnv = process.env): Promise<PrivateChildResult> {
  return new Promise((resolve) => {
    const env = { ...environment, DEBUG: "", PRISMA_LOG_LEVEL: "", NODE_NO_WARNINGS: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
    const child = spawn(process.execPath, [...args], { shell: false, stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "", stderr = "", bytes = 0, overflow = false, done = false;
    const receive = (channel: "stdout" | "stderr", chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > MAX_STREAM_BYTES) { overflow = true; stdout = ""; stderr = ""; child.kill("SIGTERM"); return; }
      if (!overflow) { if (channel === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8"); }
    };
    child.stdout.on("data", (chunk: Buffer) => receive("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => receive("stderr", chunk));
    child.on("error", () => { if (!done) { done = true; resolve({ status: null, stdout: "", stderr: "", overflow }); } });
    child.on("close", (status) => { if (!done) { done = true; resolve({ status, stdout, stderr, overflow }); } });
  });
}

export function parseChild(result: PrivateChildResult): Report {
  requireFact(!result.overflow && result.stderr.trim().length === 0, "PRIVACY");
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  requireFact(lines.length === 1 && lines[0]!.startsWith(PROTOCOL_PREFIX), "PROTOCOL");
  let value: unknown;
  try { value = JSON.parse(lines[0]!.slice(PROTOCOL_PREFIX.length)); }
  catch { throw new SafeFailure("PROTOCOL"); }
  const report = safeReport(value);
  if (result.status === null) { report.status = "INCOMPLETE"; report.cleanup = "UNKNOWN"; report.failure = "INCOMPLETE"; }
  else if (result.status !== 0 && report.status === "COMPLETE") { report.status = "INVALID"; report.failure = "UNKNOWN_INFRASTRUCTURE"; }
  if (result.status === 0 && report.status !== "COMPLETE") throw new SafeFailure("INCOMPLETE");
  return report;
}

function publish(report: Report): void {
  const content = markdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, content, { encoding: "utf8" }); }
    catch { throw new SafeFailure("PROTOCOL"); }
  }
  writeSync(1, content);
}

async function prepare(): Promise<void> {
  const steps = [
    { label: "VERIFY_DATABASE", args: ["--import", "tsx", "scripts/ci/verify-e2e-db.ts"] },
    { label: "PREPARE_ROLES", args: ["--import", "tsx", "scripts/ci/prepare-e2e-db.ts"] },
    { label: "APPLY_EXISTING_MIGRATIONS", args: ["node_modules/prisma/build/index.js", "migrate", "deploy"] },
  ] as const;
  for (const step of steps) {
    const result = await privateChild(step.args);
    requireFact(result.status === 0 && !result.overflow, "SETUP");
    writeSync(1, `OBS01 ${step.label}=PASS\n`);
  }
}

export async function runGuarded(args: readonly string[]): Promise<number> {
  let launched = false;
  try {
    requireFact(args.length === 0 || args.length === 1 && args[0] === "--prepare-db", "STARTUP");
    guardEnvironment();
    if (args[0] === "--prepare-db") { await prepare(); return 0; }
    launched = true;
    const result = await privateChild(["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.performance.config.ts"]);
    const report = parseChild(result);
    publish(report);
    return result.status === 0 && report.status === "COMPLETE" ? 0 : 1;
  } catch (error) {
    const report = emptyReport(failureCode(error));
    if (launched) {
      report.primaryCountsKnown = false;
      report.status = report.failure === "PRIVACY" || report.failure === "PROTOCOL" ? "INVALID" : "INCOMPLETE";
      for (const row of report.rows) row.status = "INCOMPLETE";
    }
    try { publish(report); }
    catch { writeSync(1, "OBS01 status=NOT_RUN failure=PROTOCOL\n"); }
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("tests/performance/support/run-guarded.ts")) {
  void runGuarded(process.argv.slice(2)).then((status) => { process.exitCode = status; }, () => { writeSync(1, "OBS01 status=NOT_RUN failure=STARTUP\n"); process.exitCode = 1; });
}
