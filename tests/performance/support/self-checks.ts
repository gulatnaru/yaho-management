import { CELLS, INVARIANTS, SafeFailure, distribution, emptyCodes, emptyReport, requireFact, safeReport, serializeReport, type CodeCounters } from "./contract";
import { AssertionGate, assertFacts, type Facts } from "./invariants";
import { EventCounter } from "./measurement";
import { outputSelfChecks } from "./output-self-checks";
import { invariantMutationChecks } from "./invariant-self-checks";
import { timeoutSelfChecks } from "./timeout-self-checks";

export async function selfChecks(): Promise<{ count: number; invariants: CodeCounters }> {
  let count = 0;
  const invariants = emptyCodes();
  count += invariantMutationChecks();
  count += await timeoutSelfChecks();
  requireFact(CELLS.length === 50 && CELLS.filter((c) => c.scenario === "SAME-SUBMISSION RACE").length === 6 && CELLS.filter((c) => c.device === "NONE").length === 2 && CELLS.every((c) => !c.scenario.startsWith("DUPLICATE") || c.mode === "EXISTING"), "CALIBRATION"); count++;
  const ranks = distribution(Array.from({ length: 30 }, (_, i) => i + 1));
  requireFact(ranks?.p50 === 15 && ranks.p95 === 29 && ranks.max === 30 && distribution([1, 2]) === null, "CALIBRATION"); count++;
  const facts: Facts = Object.fromEntries(INVARIANTS.map((c) => [c, true]));
  assertFacts(new AssertionGate(INVARIANTS), facts); count++;
  for (const code of INVARIANTS) {
    const corrupt = { ...facts, [code]: false };
    let rejected = false;
    try { assertFacts(new AssertionGate(INVARIANTS), corrupt); } catch (error) { rejected = error instanceof SafeFailure && error.code === code; }
    requireFact(rejected, "CALIBRATION"); count++;
    const missing = { ...facts }; delete missing[code]; rejected = false;
    try { assertFacts(new AssertionGate(INVARIANTS), missing); } catch (error) { rejected = error instanceof SafeFailure && error.code === "ASSERTION_MISSING"; }
    requireFact(rejected, "CALIBRATION"); count++;
    invariants[code] = { expected: 3, executed: 3, pass: 3, fail: 0 };
  }
  const counter = new EventCounter(); counter.start(); counter.event(); requireFact(counter.stop() === 1, "CALIBRATION"); await counter.drain(); count++;
  counter.start(); let busy = false; try { counter.start(); } catch (error) { busy = error instanceof SafeFailure && error.code === "CLIENT_BUSY"; } counter.stop(); requireFact(busy, "CALIBRATION"); count++;
  counter.event(); let late = false; try { await counter.drain(); } catch (error) { late = error instanceof SafeFailure && error.code === "LATE_EVENT"; } requireFact(late, "CALIBRATION"); count++;
  const valid = emptyReport("DATABASE_UNAVAILABLE"); safeReport(valid); count++;
  for (const bad of [{ ...valid, unapproved: "private-canary" }, { ...valid, status: "COMPLETE" }, { ...valid, rows: [] }, { ...valid, failure: "private-canary" }]) {
    let rejected = false; try { serializeReport(bad); } catch (error) { rejected = error instanceof SafeFailure && error.code === "PROTOCOL"; } requireFact(rejected, "PRIVACY"); count++;
  }
  count += await outputSelfChecks();
  return { count, invariants };
}
