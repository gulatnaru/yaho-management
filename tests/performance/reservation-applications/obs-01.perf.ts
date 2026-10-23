import { afterAll, beforeAll, describe, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { confirmApplicationSubmissionCore } from "../../../server/reservation-applications/finance";
import { CELLS, REPETITIONS, WARMUPS, SafeFailure, addCodes, distribution, emptyReport, failureCode, recordReportFailure, requireFact, type AggregateRow, type Cell, type Report } from "../support/contract";
import { collectEnvironment, guardEnvironment } from "../support/environment";
import { cleanupFixture, cleanupRoots, createRoots, manifest, prepareFixture, runRoots, snapshot, type Fixture, type Snapshot } from "../support/fixtures";
import { AssertionGate, assertFacts, deriveFacts, expectedInvariants, ledger } from "../support/invariants";
import { auditCounters, calibrate, classify, clients, connect, disconnect, measureCore, measureRace, type Call, type Clients } from "../support/measurement";
import { selfChecks } from "../support/self-checks";
import { HarnessLifecycle } from "../support/lifecycle";

guardEnvironment();
const roots = runRoots();
const report: Report = emptyReport("INCOMPLETE");
report.failure = null;
let db: Clients | undefined;
let connected = false, sequence = 0, rootsTouched = false;
let cleanupPromise: Promise<void> | undefined;
const lifecycle = new HarnessLifecycle<Fixture>();
function stop(error: unknown): void {
  lifecycle.stop();
  recordReportFailure(report, error);
}
function fixtureCleanupStatus(cell: Cell): AggregateRow["cleanup"] {
  return lifecycle.cleanupStatus([...lifecycle.fixtures.keys()].filter((f) => f.cell === cell));
}
async function cleanOwnedFixture(f: Fixture): Promise<void> {
  try { await lifecycle.clean(f, () => cleanupFixture(db!.setup, f)); }
  finally { for (const row of report.rows.filter((r) => r.cell === f.cell)) row.cleanup = fixtureCleanupStatus(f.cell); }
}
function recordCall(row: AggregateRow, call: Call): void { row.settled++; if (call.fulfilled) row.fulfilled++; else row.rejected++; }
function checkFixture(f: Fixture, before: Snapshot): void {
  const value = ledger(before);
  const sum = f.quotes.reduce((a, b) => a + b, 0), selected = f.quotes.slice(0, f.cell.selected).reduce((a, b) => a + b, 0);
  const held = f.cell.hold === "NONE" ? 0 : f.quotes.at(-1)!;
  const returned = f.cell.hold === "PARTIAL_RETURN" ? 20000 : 0;
  const deposit = sum - (f.cell.scenario.includes("INSUFFICIENT") ? 1 : 0);
  requireFact(value.state === "available" && value.Q === sum && value.D === deposit && value.P === 0 && value.R === held - returned && value.T === returned && value.A === deposit - held, "LEDGER");
  requireFact(before.apps.length === f.cell.n && before.apps.every((a, i) => a.id === f.apps[i] && a.quotedAmount === f.quotes[i] && a.status === (i === f.cell.n - 1 && f.cell.hold !== "NONE" ? "REJECTED" : "SUBMITTED")), "SELECTION_ISOLATION");
  requireFact(before.children.length === (f.cell.mode === "EXISTING" ? f.cell.n : 0) && before.consents.length === (f.cell.mode === "EXISTING" ? f.cell.n * 2 : 0) && before.deviceChildren.length === 0 && before.devices.length === (f.cell.device === "ONE" ? 1 : 0), "CHILD_STATE");
  requireFact(before.deposits.length === (f.cell.scenario === "FRAGMENTED" ? 2 : 1) && before.mappings.length === 0 && before.refunds.length === 0 && before.payments.length === (f.cell.scenario === "DUPLICATE PAID" ? 1 : 0) && before.reservations.length === (f.cell.scenario.startsWith("DUPLICATE") ? 1 : 0), "EXACT_LINKAGE");
  if (f.cell.scenario.includes("INSUFFICIENT")) requireFact(value.state === "available" && value.A === selected - 1 && (f.cell.hold === "NONE" || value.D >= selected), "AVAILABLE_BACKING");
}
function cleanup(): Promise<void> {
  return cleanupPromise ??= finishCleanup();
}
async function finishCleanup(): Promise<void> {
  // Close first, then drain callback work before touching any owned data/client.
  await lifecycle.drain();
  try {
    if (db && connected) {
      for (const f of lifecycle.fixtures.keys()) {
        try { await cleanOwnedFixture(f); }
        catch { stop(new SafeFailure("CLEANUP")); }
      }
      let rootsClean = !rootsTouched;
      if (rootsTouched) {
        try { await cleanupRoots(db.setup, roots); rootsClean = true; }
        catch { stop(new SafeFailure("CLEANUP")); }
      }
      report.cleanup = rootsClean && lifecycle.cleanupStatus() === "PASS" ? "PASS" : "FAIL";
    } else report.cleanup = "UNKNOWN";
  } catch { report.cleanup = "FAIL"; stop(new SafeFailure("CLEANUP")); }
  finally {
    if (db) {
      try { await disconnect(db); }
      catch (error) {
        // A log-attribution failure does not undo separately verified fixture
        // cleanup or fulfilled disconnects. Real disconnect failures still fail
        // CLEANUP inside disconnect(), even if attribution also failed.
        if (!(error instanceof SafeFailure && error.code === "ATTRIBUTION")) report.cleanup = "FAIL";
        stop(error instanceof SafeFailure ? error : new SafeFailure("CLEANUP"));
      }
    }
  }
}
beforeAll(() => lifecycle.run(async () => {
  try {
    const checks = await selfChecks(); report.selfChecks = checks.count; report.selfCheckInvariants = checks.invariants;
    if (lifecycle.stopped) return;
    db = clients();
    report.environment = await collectEnvironment(db.setup);
    if (lifecycle.stopped) return;
    connected = true;
    report.environment.independentSessions = await connect(db);
    if (lifecycle.stopped) return;
    rootsTouched = true; await createRoots(db.setup, roots);
    if (lifecycle.stopped) return;
    report.calibration = await calibrate(db, roots.program);
    report.status = "INCOMPLETE";
  } catch (error) { stop(error); }
}), 120000);
afterAll(async (suite) => {
  if (lifecycle.operations.size) stop(new SafeFailure("INCOMPLETE"));
  // Publish an honest UNKNOWN fallback even if the runner also times out this hook.
  (suite.meta as { obs01?: Report }).obs01 = report;
  await cleanup();
  finishReport();
}, 120000);

async function runCell(cell: Cell): Promise<void> {
  if (lifecycle.stopped || !db) return;
  const rows = report.rows.filter((row) => row.cell === cell);
  rows.forEach((row) => { row.status = "INCOMPLETE"; });
  const wall = rows.map(() => [] as number[]), queries = rows.map(() => [] as number[]);
  for (let iteration = 0; iteration < WARMUPS + REPETITIONS; iteration++) {
    if (lifecycle.stopped) return;
    const warmup = iteration < WARMUPS;
    const f = manifest(roots, cell, ++sequence); lifecycle.own(f);
    rows.forEach((row) => { row.cleanup = "UNKNOWN"; });
    const gate = new AssertionGate(expectedInvariants(f));
    let valid = false;
    try {
      let before: Snapshot;
      try { await prepareFixture(db.setup, f); if (lifecycle.stopped) return; before = await snapshot(db.setup, f); }
      catch (error) { throw error instanceof SafeFailure ? error : new SafeFailure("SETUP"); }
      if (lifecycle.stopped) return;
      checkFixture(f, before);
      await auditCounters(db, "SAMPLE");
      const input = { submissionId: f.id, choices: f.choices, actorUserId: roots.actors[0], now: f.now };
      if (!warmup) for (const row of rows) row.attempted++;
      let calls: Call[], pairWall = 0, actor = roots.actors[0], raceSingleWinner = false;
      if (cell.scenario === "SAME-SUBMISSION RACE") {
        const pair = await measureRace(db, input, roots.actors[1]);
        calls = pair.calls; pairWall = pair.wall;
        const winners = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.fulfilled);
        const losers = calls.filter((call) => !call.fulfilled);
        if (!warmup) {
          const ordered = [...calls].sort((a, b) => Number(b.fulfilled) - Number(a.fulfilled));
          recordCall(rows[0]!, ordered[0]!); recordCall(rows[1]!, ordered[1]!);
          rows[2]!.settled++; rows[2]!.fulfilled += winners.length; rows[2]!.rejected += losers.length;
        }
        raceSingleWinner = winners.length === 1 && winners[0]!.call.outcome === "SUCCESS" && losers.length === 1 && losers[0]!.outcome === "ApplicationNotPendingError";
        requireFact(raceSingleWinner, "RACE_SINGLE_WINNER");
        actor = roots.actors[winners[0]!.index]!;
        calls = [winners[0]!.call, losers[0]!];
      } else {
        const call = await measureCore(db.measured[0], input);
        calls = [call];
        if (!warmup) recordCall(rows[0]!, call);
        await auditCounters(db, "SAMPLE");
        requireFact(call.outcome === cell.expected && call.fulfilled === (cell.expected === "SUCCESS"), "WRONG_OUTCOME");
      }
      if (lifecycle.stopped) return;
      requireFact(calls.every((call) => call.queries > 0 && Number.isInteger(call.queries) && Number.isFinite(call.wall)), "CALIBRATION");
      const after = await snapshot(db.setup, f);
      if (lifecycle.stopped) return;
      let replayUnchanged = false;
      if (cell.expected === "SUCCESS") {
        let replayOutcome = "SUCCESS";
        try { await confirmApplicationSubmissionCore(db.setup, { ...input, actorUserId: actor }); } catch (error) { replayOutcome = classify(error); }
        replayUnchanged = replayOutcome === "ApplicationNotPendingError" && isDeepStrictEqual(after, await snapshot(db.setup, f));
      }
      const facts = deriveFacts(f, before, after, actor, replayUnchanged, raceSingleWinner);
      const result = calls.find((call) => call.fulfilled)?.value;
      if (cell.expected === "SUCCESS") facts.EXACT_LINKAGE &&= Boolean(result && after.payments.some((p) => p.id === result.paymentId) && isDeepStrictEqual([...result.reservationIds].sort(), after.reservations.filter((r) => !before.reservations.some((b) => b.id === r.id)).map((r) => r.id).sort()));
      assertFacts(gate, facts);
      if (!warmup) {
        if (cell.scenario === "SAME-SUBMISSION RACE") { wall[0]!.push(calls[0]!.wall); wall[1]!.push(calls[1]!.wall); wall[2]!.push(pairWall); queries[0]!.push(calls[0]!.queries); queries[1]!.push(calls[1]!.queries); }
        else { wall[0]!.push(calls[0]!.wall); queries[0]!.push(calls[0]!.queries); }
      }
      valid = true;
    } catch (error) {
      stop(error);
      const setupFailure = failureCode(error) === "SETUP";
      for (const row of rows) { row.status = report.failure === "INCOMPLETE" ? "INCOMPLETE" : setupFailure ? row.warmups === 0 && row.attempted === 0 ? "NOT RUN" : "INCOMPLETE" : "INVALID"; row.failures.push({ code: failureCode(error), count: 1 }); }
      if (setupFailure) report.status = "INCOMPLETE";
    } finally {
      const assertionRow = cell.scenario === "SAME-SUBMISSION RACE" ? rows[2]! : rows[0]!;
      addCodes(warmup ? assertionRow.warmupInvariants : assertionRow.measuredInvariants, gate.counts);
      try { await cleanOwnedFixture(f); }
      catch { stop(new SafeFailure("CLEANUP")); valid = false; rows.forEach((row) => { row.status = report.failure === "INCOMPLETE" ? "INCOMPLETE" : "INVALID"; row.failures.push({ code: "CLEANUP", count: 1 }); }); }
      if (valid && !lifecycle.stopped) for (const row of rows) { if (warmup) row.warmups++; else row.valid++; }
    }
    if (lifecycle.stopped) return;
  }
  rows.forEach((row, index) => {
    requireFact(row.warmups === WARMUPS && row.valid === REPETITIONS, "INCOMPLETE");
    row.wall = distribution(wall[index]!);
    row.queries = row.metric === "PAIR" ? null : distribution(queries[index]!);
    requireFact(row.wall && (row.metric === "PAIR" || row.queries), "INCOMPLETE");
    row.status = "COMPLETE";
  });
}
function finishReport(): void {
  report.finished = new Date().toISOString();
  if (!lifecycle.stopped && report.rows.every((r) => r.status === "COMPLETE") && report.cleanup === "PASS") { report.status = "COMPLETE"; report.failure = null; }
  else if (report.rows.every((r) => r.attempted === 0 && r.warmups === 0 && r.status === "NOT RUN") && (report.failure === "DATABASE_UNAVAILABLE" || report.failure === "SETUP")) report.status = "NOT RUN";
  else if (!lifecycle.stopped) { report.status = "INCOMPLETE"; report.failure = "INCOMPLETE"; }
}
describe.sequential("OBS01", () => {
  for (const cell of CELLS) it(`${cell.scenario}/${cell.n}/${cell.mode}/${cell.device}`, async ({ task, onTestFinished }) => {
    onTestFinished(async () => {
      if (task.result?.state === "fail") {
        stop(new SafeFailure("INCOMPLETE"));
        await cleanup();
      }
    });
    try { await lifecycle.run(() => runCell(cell)); } catch (error) { stop(error); }
  }, 1200000);
  it("OBS01_FINAL", async () => {
    await cleanup();
    finishReport();
    if (report.status !== "COMPLETE") throw new SafeFailure(report.failure ?? "INCOMPLETE");
  }, 120000);
});
