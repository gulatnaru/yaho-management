import type { File } from "@vitest/runner";
import { emptyReport, markdown, requireFact, SafeFailure, serializeReport } from "./contract";
import { assertOptInAndLocal, assertUrls, guardEnvironmentBoundary } from "./environment";
import { parseChild, privateChild } from "./run-guarded";
import { reportFromTasks } from "./sanitized-reporter";

function mustReject(operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch (error) { rejected = error instanceof SafeFailure; }
  requireFact(rejected, "PRIVACY");
}

export async function outputSelfChecks(): Promise<number> {
  let checks = 0;
  const canary = ["OBS01", "PRIVATE", crypto.randomUUID().replaceAll("-", "")].join("_");
  const sqlShaped = ["SELECT", canary, "FROM", "private_probe"].join(" ");
  const paramShaped = JSON.stringify({ probe: canary });
  const personalShaped = `${canary}@example.invalid`;
  const rawError = Object.assign(new Error(sqlShaped), { meta: { params: paramShaped, personal: personalShaped }, actual: { probe: canary }, expected: { probe: "OTHER" }, cause: new Error(canary) });
  const file = { meta: {}, result: { state: "fail", errors: [rawError] }, tasks: [] } as unknown as File;
  const reduced = reportFromTasks([file], [rawError]);
  const serialized = serializeReport(reduced) + markdown(reduced);
  requireFact(![canary, sqlShaped, paramShaped, personalShaped].some((value) => serialized.includes(value)), "PRIVACY"); checks++;
  const valid = emptyReport("INCOMPLETE");
  for (const mutated of [
    { ...valid, raw: rawError },
    { ...valid, failure: canary },
    { ...valid, status: "COMPLETE" },
    { ...valid, rows: [...valid.rows, { sql: sqlShaped }] },
    { ...valid, rows: valid.rows.map((row, index) => index ? row : { ...row, outcome: personalShaped }) },
  ]) { mustReject(() => serializeReport(mutated)); mustReject(() => markdown(mutated)); checks++; }
  for (const result of [
    { status: 1, stdout: canary, stderr: "", overflow: false },
    { status: 1, stdout: serializeReport(valid), stderr: canary, overflow: false },
    { status: 0, stdout: "", stderr: "", overflow: false },
    { status: 0, stdout: serializeReport(valid), stderr: "", overflow: false },
    { status: 1, stdout: serializeReport(valid), stderr: "", overflow: true },
    { status: 1, stdout: `${serializeReport(valid)}\n${canary}`, stderr: "", overflow: false },
  ]) { mustReject(() => parseChild(result)); checks++; }
  for (const value of [undefined, "0", "other"]) { mustReject(() => assertOptInAndLocal({ YAHO_OBS01_PERF: value })); checks++; }
  for (const environment of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { PLAYWRIGHT_PREVIEW_E2E: "1" }]) { mustReject(() => assertOptInAndLocal({ YAHO_OBS01_PERF: "1", ...environment })); checks++; }
  for (const value of [undefined, "0", "other"]) {
    let loaded = false;
    mustReject(() => guardEnvironmentBoundary({ YAHO_OBS01_PERF: value }, () => { loaded = true; }));
    requireFact(!loaded, "PRIVACY"); checks++;
  }
  for (const flag of ["VERCEL", "VERCEL_ENV", "PLAYWRIGHT_PREVIEW_E2E"]) {
    const environment: Record<string, string> = { YAHO_OBS01_PERF: "1" };
    mustReject(() => guardEnvironmentBoundary(environment, () => { environment[flag] = "1"; })); checks++;
  }
  mustReject(() => assertUrls({ DATABASE_URL: canary, DIRECT_URL: canary })); checks++;
  const literal = JSON.stringify(canary);
  const probes = [
    `require('node:assert').deepStrictEqual({probe:${literal}},{probe:'OTHER'})`,
    `const {Prisma}=require('@prisma/client');throw new Prisma.PrismaClientKnownRequestError(${literal},{code:'P2010',clientVersion:'6.19.3',meta:{probe:${literal}}})`,
    `console.log(${literal});console.error(${literal});require('node:fs').writeSync(1,${literal});require('node:fs').writeSync(2,${literal});process.exitCode=1`,
    `Promise.reject(new Error(${literal}))`,
    `require('node:fs').writeSync(2,${literal});process.exitCode=1`,
  ];
  for (const script of probes) {
    const result = await privateChild(["-e", script]);
    requireFact(result.status !== 0 && !result.overflow && (result.stdout.includes(canary) || result.stderr.includes(canary)), "PRIVACY");
    mustReject(() => parseChild(result)); checks++;
  }
  // Exercise the real fenced listener, deferred emitter cases and private
  // query/error canaries behind captured process streams. Only one aggregate
  // protocol line is allowed to escape; a listener-side log breaks this check.
  const fencedOutput = await privateChild(["--import", "tsx", "-e", `(async () => {
    const fence = await import('./tests/performance/support/fence-self-checks.ts');
    await (fence.fenceSelfChecks ?? fence.default.fenceSelfChecks)();
    const loaded = await import('./tests/performance/support/contract.ts');
    const contract = loaded.default ?? loaded;
    require('node:fs').writeSync(1, contract.serializeReport(contract.emptyReport('ATTRIBUTION')));
    process.exitCode = 1;
  })().catch(() => { process.exitCode = 2; });`]);
  requireFact(fencedOutput.status === 1 && !fencedOutput.overflow && !fencedOutput.stdout.includes("PRIVATE_QUERY_CANARY") && !fencedOutput.stderr.includes("PRIVATE_QUERY_CANARY") && parseChild(fencedOutput).failure === "ATTRIBUTION", "PRIVACY"); checks++;
  const deniedEnvironments: Array<{ environment: NodeJS.ProcessEnv; code: string }> = [];
  for (const value of [undefined, "0", "other"]) {
    const environment: NodeJS.ProcessEnv = { ...process.env, YAHO_OBS01_PERF: value };
    delete environment.GITHUB_STEP_SUMMARY;
    deniedEnvironments.push({ environment, code: "OPT_IN_REQUIRED" });
  }
  for (const values of [{ DATABASE_URL: canary, DIRECT_URL: canary }, { VERCEL_ENV: "preview" }, { PLAYWRIGHT_PREVIEW_E2E: "1" }]) {
    const environment: NodeJS.ProcessEnv = { ...process.env, YAHO_OBS01_PERF: "1", ...values };
    delete environment.GITHUB_STEP_SUMMARY;
    deniedEnvironments.push({ environment, code: "DATABASE_URL" in values ? "UNSAFE_DATABASE" : "LOCAL_ONLY" });
  }
  for (const denied of deniedEnvironments) {
    for (const args of [["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.performance.config.ts"], ["--import", "tsx", "tests/performance/support/run-guarded.ts"]]) {
      const result = await privateChild(args, denied.environment);
      requireFact(result.status !== 0 && !result.overflow && result.stderr.length === 0 && result.stdout.includes(denied.code) && !result.stdout.includes(canary), "PRIVACY");
      checks++;
    }
  }
  return checks;
}
