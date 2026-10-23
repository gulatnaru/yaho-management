import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { requireFact } from "./contract";
import { HarnessLifecycle } from "./lifecycle";
import { parseChild, privateChild } from "./run-guarded";

export async function timeoutSelfChecks(): Promise<number> {
  let count = 0;
  const lifecycle = new HarnessLifecycle<number>();
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  for (const fixture of [1, 2]) lifecycle.own(fixture);
  for (const fixture of [1, 2]) void lifecycle.run(async () => { await deferred; events.push(`settled-${fixture}`); });
  await Promise.resolve();
  lifecycle.stop();
  void lifecycle.run(async () => { events.push("unexpected-start"); });
  const draining = lifecycle.drain();
  requireFact(lifecycle.operations.size === 2 && lifecycle.cleanupStatus() === "UNKNOWN" && events.length === 0, "CALIBRATION"); count++;
  release(); await draining;
  requireFact(Number(lifecycle.operations.size) === 0 && Number(events.length) === 2 && !events.includes("unexpected-start"), "CALIBRATION"); count++;
  for (const fixture of [1, 2]) {
    try { await lifecycle.clean(fixture, async () => { events.push(`clean-${fixture}`); if (fixture === 1) throw new Error("synthetic"); }); }
    catch { /* The first failure must not prevent cleaning the second manifest. */ }
  }
  requireFact(lifecycle.fixtures.get(1) === "FAIL" && lifecycle.fixtures.get(2) === "PASS" && lifecycle.cleanupStatus() === "FAIL" && Number(events.length) === 4, "CALIBRATION"); count++;
  const directory = mkdtempSync(path.join(tmpdir(), "obs01-timeout-"));
  try {
    const config = path.join(directory, "vitest.config.mjs"), resultPath = path.join(directory, "result");
    writeFileSync(config, `export default ${JSON.stringify({
      root: process.cwd(),
      resolve: { alias: { "server-only": path.resolve("tests/unit/manual-test/server-only.ts"), "@": process.cwd() } },
      test: {
        include: ["tests/performance/support/timeout-probe.perf.ts"], environment: "node", minWorkers: 1, maxWorkers: 1, fileParallelism: false,
        sequence: { concurrent: false, shuffle: false, hooks: "list" }, retry: 0, silent: true,
        reporters: [path.resolve("tests/performance/support/sanitized-reporter.ts")],
      },
    })};\n`);
    for (const mode of ["cell", "cleanup-failure", "setup", "attribution"]) {
      rmSync(resultPath, { force: true });
      const result = await privateChild(["node_modules/vitest/vitest.mjs", "run", "--config", config], {
        ...process.env, YAHO_OBS01_TIMEOUT_PROBE: mode, YAHO_OBS01_TIMEOUT_RESULT: resultPath,
      });
      requireFact(result.status === 1 && !result.overflow, "CALIBRATION");
      const report = parseChild(result);
      requireFact((mode === "attribution" ? report.status === "INVALID" && report.failure === "ATTRIBUTION" && report.attributionDiagnostic?.condition === "UNPROVEN" : report.status === "INCOMPLETE" && report.failure === "INCOMPLETE") && readFileSync(resultPath, "utf8") === "PASS", "CALIBRATION"); count++;
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  return count;
}
