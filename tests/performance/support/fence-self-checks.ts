import { ApplicationNotPendingError } from "../../../lib/reservation-applications/errors";
import { emptyReport, markdown, recordReportFailure, requireFact, SafeFailure, serializeReport, type AttributionDiagnostic } from "./contract";
import { EventCounter, type CounterClock } from "./event-counter";
import { auditCounters, measureCore, measureRace, type Clients, type Contender, type CoreInput } from "./measurement";

class DeliveryClock implements CounterClock {
  value = 0;
  private tasks: Array<{ at: number; run: () => void }> = [];
  now(): number { return this.value; }
  after(delay: number, run: () => void): void { this.tasks.push({ at: this.value + delay, run }); }
  async pause(): Promise<void> {
    this.value += 5;
    const ready = this.tasks.filter((task) => task.at <= this.value);
    this.tasks = this.tasks.filter((task) => task.at > this.value);
    ready.forEach((task) => task.run());
  }
}
const input: CoreInput = { submissionId: "synthetic", choices: [{ applicationId: "synthetic", newChild: true }], actorUserId: "synthetic", now: new Date(0) };
const result = { paymentId: "synthetic-payment", reservationIds: ["synthetic-reservation"] };
function simulated(work: (counter: EventCounter, clock: DeliveryClock) => void, rollback: boolean | Error = false) {
  const clock = new DeliveryClock(), counter = new EventCounter(clock);
  let calls = 0;
  // The production core validates choices then opens exactly one transaction.
  // This fake engine deliberately substitutes its body to isolate event delivery.
  const db = { $transaction: async () => {
    calls++; work(counter, clock);
    if (rollback) throw rollback instanceof Error ? rollback : new ApplicationNotPendingError();
    return result;
  } };
  return { contender: { db, counter } as unknown as Contender, clock, calls: () => calls };
}
async function invalid(operation: () => Promise<unknown>, condition: AttributionDiagnostic["condition"]): Promise<SafeFailure> {
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  requireFact(failure instanceof SafeFailure && failure.code === "ATTRIBUTION" && failure.diagnostic?.condition === condition, "CALIBRATION");
  const report = emptyReport("ATTRIBUTION"); recordReportFailure(report, failure);
  requireFact(serializeReport(report).includes('"status":"INVALID"') && markdown(report).includes("failure: ATTRIBUTION"), "CALIBRATION");
  return failure;
}
export async function fenceSelfChecks(): Promise<number> {
  let count = 0;
  const success = simulated((counter) => { for (const query of ["BEGIN", "opaque one", "opaque two", "COMMIT"]) counter.event(query); });
  const call = await measureCore(success.contender, input);
  requireFact(call.queries === 4 && call.fulfilled && call.outcome === "SUCCESS" && !success.contender.counter.active && success.calls() === 1, "CALIBRATION"); count++;
  const rollback = simulated((counter) => { for (const query of ["BEGIN", "opaque", "ROLLBACK"]) counter.event(query); }, true);
  const rejected = await measureCore(rollback.contender, input);
  requireFact(rejected.queries === 3 && !rejected.fulfilled && rejected.outcome === "ApplicationNotPendingError", "CALIBRATION"); count++;
  const deferred = simulated((counter, clock) => {
    counter.event("BEGIN"); counter.event("opaque first");
    clock.after(40, () => counter.event("opaque late before fence"));
    clock.after(80, () => counter.event("COMMIT"));
  });
  const delayed = await measureCore(deferred.contender, input);
  requireFact(delayed.queries === 4 && deferred.clock.value >= 105 && deferred.contender.counter.late === 0, "CALIBRATION"); count++;
  // Reusing a client after its delivered terminal retains exact, distinct totals.
  const reusable = simulated((counter, clock) => {
    counter.event("BEGIN");
    for (let i = 0; i < reusable.calls(); i++) counter.event("opaque");
    clock.after(40, () => counter.event("COMMIT"));
  });
  for (let i = 1; i <= 3; i++) { requireFact((await measureCore(reusable.contender, input)).queries === i + 2, "CALIBRATION"); count++; }
  for (const rolledBack of [false, true]) {
    const missing = simulated((counter) => { counter.event("BEGIN"); counter.event("opaque"); }, rolledBack);
    await invalid(() => measureCore(missing.contender, input), "UNPROVEN"); count++;
    const wrong = simulated((counter) => { counter.event("BEGIN"); counter.event(rolledBack ? "COMMIT" : "ROLLBACK"); }, rolledBack);
    await invalid(() => measureCore(wrong.contender, input), "FENCE_OUTCOME"); count++;
  }
  for (const [nearMiss, rolledBack] of [["COMMIT ", false], [" COMMIT", false], ["commit", false], ["COMMIT;", false], ["SELECT 'COMMIT'", false], ["ROLLBACK ", true], ["ROLLBACK;", true], ["SELECT 'ROLLBACK'", true]] as const) {
    const near = simulated((counter) => { counter.event("BEGIN"); counter.event(nearMiss); }, rolledBack);
    await invalid(() => measureCore(near.contender, input), "UNPROVEN"); count++;
  }
  for (const nearMiss of ["BEGIN ", " BEGIN", "begin", "BEGIN;", "SELECT 'BEGIN'"]) {
    const near = simulated((counter) => { counter.event(nearMiss); counter.event("COMMIT"); });
    await invalid(() => measureCore(near.contender, input), "FENCE_ORDER"); count++;
  }
  const repeatedBegin = simulated((counter) => { counter.event("BEGIN"); counter.event("BEGIN"); counter.event("COMMIT"); });
  await invalid(() => measureCore(repeatedBegin.contender, input), "FENCE_ORDER"); count++;
  const noTransaction = simulated(() => {});
  await invalid(() => measureCore(noTransaction.contender, { ...input, choices: [] }), "UNPROVEN");
  requireFact(noTransaction.calls() === 0, "CALIBRATION"); count++;
  const postFence = simulated((counter, clock) => { counter.event("BEGIN"); counter.event("COMMIT"); clock.after(5, () => counter.event("opaque stray")); });
  await invalid(() => measureCore(postFence.contender, input), "LATE"); count++;
  const postQuiesce = simulated((counter, clock) => { counter.event("BEGIN"); counter.event("COMMIT"); clock.after(35, () => counter.event("opaque drain stray")); });
  const drainFailure = await invalid(() => measureCore(postQuiesce.contender, input), "LATE");
  requireFact(drainFailure.diagnostic?.stage === "SAMPLE" && drainFailure.diagnostic.client === "A", "CALIBRATION"); count++;
  const postClosed = simulated((counter) => { counter.event("BEGIN"); counter.event("COMMIT"); });
  await measureCore(postClosed.contender, input); postClosed.contender.counter.event("opaque stray");
  await invalid(() => measureCore(postClosed.contender, input), "LATE");
  requireFact(postClosed.calls() === 1, "CALIBRATION"); count++;
  const unstable = simulated((counter, clock) => { counter.event("BEGIN"); clock.after(995, () => counter.event("COMMIT")); });
  await invalid(() => measureCore(unstable.contender, input), "UNSTABLE"); count++;

  const winner = simulated((counter, clock) => { counter.event("BEGIN"); clock.after(40, () => counter.event("opaque")); clock.after(80, () => counter.event("COMMIT")); });
  const loser = simulated((counter, clock) => { counter.event("BEGIN"); counter.event("opaque"); counter.event("opaque"); clock.after(40, () => counter.event("ROLLBACK")); }, true);
  const pair = { measured: [winner.contender, loser.contender] } as Clients;
  const race = await measureRace(pair, input, "synthetic-second");
  requireFact(race.calls[0].queries === 3 && race.calls[1].queries === 4 && race.calls[0].fulfilled && !race.calls[1].fulfilled && race.wall >= 0 && pair.measured.every((m) => !m.counter.active && m.counter.late === 0), "CALIBRATION"); count++;
  const badLoser = simulated((counter) => { counter.event("BEGIN"); counter.event("COMMIT"); }, true);
  const raceFailure = await invalid(() => measureRace({ measured: [winner.contender, badLoser.contender] } as Clients, input, "synthetic-second"), "FENCE_OUTCOME");
  requireFact(raceFailure.diagnostic?.client === "B", "CALIBRATION"); count++;
  const missingLoser = simulated((counter) => { counter.event("BEGIN"); }, true);
  await invalid(() => measureRace({ measured: [winner.contender, missingLoser.contender] } as Clients, input, "synthetic-second"), "UNPROVEN"); count++;
  const strayLoser = simulated((counter, clock) => { counter.event("BEGIN"); counter.event("ROLLBACK"); clock.after(5, () => counter.event("opaque stray")); }, true);
  const raceStray = await invalid(() => measureRace({ measured: [winner.contender, strayLoser.contender] } as Clients, input, "synthetic-second"), "LATE");
  requireFact(raceStray.diagnostic?.stage === "SAMPLE" && raceStray.diagnostic.client === "B" && !strayLoser.contender.counter.active, "CALIBRATION"); count++;
  const drainLoser = simulated((counter, clock) => { counter.event("BEGIN"); counter.event("ROLLBACK"); clock.after(35, () => counter.event("opaque drain stray")); }, true);
  const raceDrain = await invalid(() => measureRace({ measured: [winner.contender, drainLoser.contender] } as Clients, input, "synthetic-second"), "LATE");
  requireFact(raceDrain.diagnostic?.stage === "SAMPLE" && raceDrain.diagnostic.client === "B", "CALIBRATION"); count++;
  pair.measured[0].counter.event("opaque post-race stray");
  await invalid(() => auditCounters(pair, "SAMPLE"), "LATE"); count++;

  // Deliberately private strings enter the listener and thrown infrastructure
  // errors. Only flags/counts may survive in counter, call, failure or reports.
  const canary = "PRIVATE_QUERY_CANARY_68c61c";
  const privacy = simulated((counter) => { counter.event("BEGIN"); counter.event(`SELECT '${canary} COMMIT'`); counter.event("COMMIT"); });
  const privateCall = await measureCore(privacy.contender, input);
  const privateFailure = simulated((counter) => { counter.event("BEGIN"); counter.event(canary); });
  const failure = await invalid(() => measureCore(privateFailure.contender, input), "UNPROVEN");
  const infrastructure = simulated((counter) => { counter.event("BEGIN"); counter.event(canary); counter.event("ROLLBACK"); }, new Error(canary));
  const infrastructureCall = await measureCore(infrastructure.contender, input);
  requireFact(infrastructureCall.outcome === "UNKNOWN_INFRASTRUCTURE" && infrastructureCall.queries === 3, "PRIVACY"); count++;
  const report = emptyReport("ATTRIBUTION"); recordReportFailure(report, failure);
  const structures = [privateCall, infrastructureCall, privacy.contender.counter, privateFailure.contender.counter, infrastructure.contender.counter, failure, failure.diagnostic, report];
  requireFact(structures.every((value) => !JSON.stringify(value).includes(canary)) && !serializeReport(report).includes(canary) && !markdown(report).includes(canary), "PRIVACY"); count++;
  return count;
}
