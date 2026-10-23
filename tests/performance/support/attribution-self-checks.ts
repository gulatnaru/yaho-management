import { attributionFailure, emptyReport, markdown, recordReportFailure, requireFact, SafeFailure, serializeReport, type AttributionContext } from "./contract";
import { EventCounter, type CounterClock } from "./event-counter";
import { auditCounters, calibrate, captureKnown, connect, disconnect, type Clients, type Contender } from "./measurement";
import { fenceSelfChecks } from "./fence-self-checks";

// Virtual query-log emitter. Advancing the delivery clock does not require a
// database, and can put native-style callbacks AFTER a work promise settles.
class DeliveryClock implements CounterClock {
  value = 0;
  tasks: Array<{ at: number; run: () => void }> = [];
  now(): number { return this.value; }
  after(delay: number, run: () => void): void { this.tasks.push({ at: this.value + delay, run }); }
  async pause(): Promise<void> {
    this.value += 5;
    const ready = this.tasks.filter((task) => task.at <= this.value);
    this.tasks = this.tasks.filter((task) => task.at > this.value);
    ready.forEach((task) => task.run());
  }
}
type SimulationOptions = { delay?: number; sameSession?: boolean; bootstrapExtra?: boolean; missingTerminal?: boolean; idleLeak?: boolean; swapConcurrent?: boolean; workFailure?: boolean };
function simulated(options: SimulationOptions = {}): { c: Clients; clock: DeliveryClock; disconnected: number[] } {
  const clock = new DeliveryClock(), disconnected = [0, 0, 0];
  const counters = [new EventCounter(clock), new EventCounter(clock)];
  let transactions = 0;
  const transactionStates: Array<{ swapped: boolean } | null> = [null, null];
  const create = (index: number) => {
    const emit = () => {
      const transaction = transactionStates[index];
      const deliver = () => {
        const destination = transaction?.swapped ? 1 - index : index;
        counters[destination]!.event();
        if (options.idleLeak && transactions === 1) counters[1 - index]!.event();
      };
      if (options.delay || options.swapConcurrent) clock.after(options.delay || 5, deliver); else deliver();
    };
    const query = async (parts: TemplateStringsArray) => {
      emit();
      const statement = parts.join("");
      if (statement.includes("pg_backend_pid")) return [{ value: options.sameSession ? 1 : index + 1 }];
      return [{ value: statement.includes("3::integer") ? 3 : statement.includes("2::integer") ? 2 : 1 }];
    };
    const tx = { $queryRaw: query, $executeRaw: async () => { emit(); return 1; } };
    return {
      $connect: async () => { emit(); if (options.bootstrapExtra) emit(); },
      $disconnect: async () => { disconnected[index + 1]!++; },
      ...tx,
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
        transactionStates[index] = { swapped: false };
        transactions++;
        if (options.swapConcurrent && transactions === 2) transactionStates.forEach((state) => { if (state) state.swapped = true; });
        emit();
        try {
          if (options.workFailure) throw new Error("fixed simulation failure");
          const value = await work(tx);
          if (!options.missingTerminal) emit();
          return value;
        } catch (error) { emit(); throw error; }
        finally { transactions--; transactionStates[index] = null; }
      },
    };
  };
  const setup = {
    $connect: async () => {}, $disconnect: async () => { disconnected[0]!++; },
    program: { findUniqueOrThrow: async () => ({ name: "Synthetic original" }) },
  };
  const c = { setup, measured: [0, 1].map((index) => ({ db: create(index), counter: counters[index]! })) } as unknown as Clients;
  return { c, clock, disconnected };
}
const context: AttributionContext = { stage: "COMMIT", client: "A", repetition: 1 };
async function invalid(operation: () => Promise<unknown>, condition?: string): Promise<SafeFailure> {
  let failure: unknown;
  try { await operation(); } catch (error) { failure = error; }
  requireFact(failure instanceof SafeFailure && failure.code === "ATTRIBUTION" && (!condition || failure.diagnostic?.condition === condition), "CALIBRATION");
  const report = emptyReport(failure.code); report.status = "INVALID"; report.attributionDiagnostic = failure.diagnostic ?? null;
  requireFact(serializeReport(report).includes('"status":"INVALID"') && markdown(report).includes("failure: ATTRIBUTION"), "CALIBRATION");
  return failure;
}

export async function attributionSelfChecks(): Promise<number> {
  let count = 0;
  const passing = simulated();
  requireFact(await connect(passing.c), "CALIBRATION"); count++;
  const evidence = await calibrate(passing.c, "synthetic-program");
  requireFact(evidence.length === 8 && evidence.every((entry) => entry.eventMin === (entry.kind === "SELECT" ? 1 : 4) && entry.eventMax === entry.eventMin && entry.lateEvents === 0), "CALIBRATION"); count++;
  await disconnect(passing.c);
  requireFact(passing.disconnected.every((n) => n === 1), "CALIBRATION"); count++;
  await invalid(() => connect(passing.c), "UNPROVEN"); count++;

  const bootstrapExpired = simulated(); let bootstrapClockCalls = 0;
  await invalid(() => connect(bootstrapExpired.c, () => bootstrapClockCalls++ === 0 ? 0 : 10000), "MODEL_EXPIRED"); count++;
  const entryExpired = simulated(); let modelNow = 0;
  await connect(entryExpired.c, () => modelNow);
  modelNow = 10000;
  await invalid(() => calibrate(entryExpired.c, "synthetic-program"), "MODEL_EXPIRED"); count++;
  const finishExpired = simulated(); let finishClockCalls = 0;
  await connect(finishExpired.c, () => ++finishClockCalls < 4 ? 0 : 10000);
  await invalid(() => calibrate(finishExpired.c, "synthetic-program"), "MODEL_EXPIRED");
  requireFact(finishClockCalls === 4, "CALIBRATION"); count++;

  const delayed = simulated({ delay: 40 });
  requireFact(await connect(delayed.c), "CALIBRATION");
  const deferredEvidence = await calibrate(delayed.c, "synthetic-program");
  requireFact(deferredEvidence.length === 8 && delayed.c.measured.every((m) => m.counter.late === 0 && !m.counter.active), "CALIBRATION"); count++;

  const same = simulated({ sameSession: true });
  await invalid(() => connect(same.c), "SESSION"); count++;
  const alias = simulated(); alias.c.measured[1] = alias.c.measured[0];
  await invalid(() => connect(alias.c), "SESSION"); count++;
  const shared = simulated(); shared.c.measured[1].counter = shared.c.measured[0].counter;
  await invalid(() => connect(shared.c), "SESSION"); count++;
  const extraBootstrap = simulated({ bootstrapExtra: true });
  await invalid(() => connect(extraBootstrap.c), "EXTRA"); count++;
  const missing = simulated({ missingTerminal: true }); await connect(missing.c);
  await invalid(() => calibrate(missing.c, "synthetic-program"), "MISSING"); count++;
  const lateBootstrap = simulated({ delay: 1500 });
  await invalid(() => connect(lateBootstrap.c), "MISSING"); count++;
  const idle = simulated({ idleLeak: true }); await connect(idle.c);
  await invalid(() => calibrate(idle.c, "synthetic-program"), "IDLE"); count++;
  const swapped = simulated({ swapConcurrent: true }); await connect(swapped.c);
  const swapFailure = await invalid(() => calibrate(swapped.c, "synthetic-program"));
  requireFact(swapFailure.diagnostic?.stage === "ASYMMETRIC", "CALIBRATION"); count++;
  const workFailure = simulated({ workFailure: true }); await connect(workFailure.c);
  await invalid(() => calibrate(workFailure.c, "synthetic-program"), "WORK"); count++;

  // An event delivered before the first owned operation is contamination,
  // including events that the old watched=false bootstrap silently discarded.
  const before = simulated(); before.c.measured[0].counter.event();
  await invalid(() => connect(before.c), "LATE"); count++;
  const after = simulated(); await connect(after.c);
  await captureKnown(after.c.measured[0], 1, { ...context, stage: "SELECT" }, async () => { after.c.measured[0].counter.event(); });
  after.c.measured[0].counter.event();
  await invalid(() => auditCounters(after.c), "LATE"); count++;
  await invalid(() => captureKnown(after.c.measured[0], 1, context, async () => { throw new Error("must not start"); }), "LATE"); count++;
  const crossWindow = simulated(); await connect(crossWindow.c);
  await captureKnown(crossWindow.c.measured[0], 1, context, async () => { crossWindow.c.measured[0].counter.event(); });
  await invalid(() => captureKnown(crossWindow.c.measured[0], 1, context, async () => {
    crossWindow.c.measured[0].counter.event();
    crossWindow.clock.after(5, () => crossWindow.c.measured[0].counter.event());
  }), "EXTRA"); count++;

  count += await fenceSelfChecks();

  // Last-window callbacks cannot escape through successful cleanup.
  const terminal = simulated(); await connect(terminal.c);
  terminal.clock.after(10, () => terminal.c.measured[1].counter.event());
  await invalid(() => disconnect(terminal.c), "LATE");
  requireFact(terminal.disconnected.every((n) => n === 1), "CALIBRATION"); count++;
  const duringDisconnect = simulated(); await connect(duringDisconnect.c);
  const disconnectB = duringDisconnect.c.measured[1].db.$disconnect;
  duringDisconnect.c.measured[1].db.$disconnect = async () => { await disconnectB(); duringDisconnect.c.measured[1].counter.event(); };
  await invalid(() => disconnect(duringDisconnect.c), "LATE"); count++;

  // Missing transaction-control callbacks must not become the old >=2 baseline.
  for (const observed of [0, 2, 3, 5]) {
    const clock = new DeliveryClock(), counter = new EventCounter(clock);
    const contender = { counter } as Contender;
    await invalid(() => captureKnown(contender, 4, context, async () => { for (let i = 0; i < observed; i++) counter.event(); }), observed > 4 ? "EXTRA" : "MISSING"); count++;
  }
  const boundaryClock = new DeliveryClock(), boundaryCounter = new EventCounter(boundaryClock);
  await invalid(() => captureKnown({ counter: boundaryCounter } as Contender, 1, context, async () => {
    boundaryClock.after(995, () => boundaryCounter.event());
  }), "UNSTABLE"); count++;
  const safe = emptyReport("ATTRIBUTION"); safe.status = "INVALID";
  safe.attributionDiagnostic = attributionFailure(context, "MISSING", 4, 3).diagnostic!;
  requireFact(serializeReport(safe).includes('"observed":3'), "CALIBRATION"); count++;
  for (const mutation of [{ ...safe.attributionDiagnostic, stage: "PRIVATE_CANARY" }, { ...safe.attributionDiagnostic, observed: -1 }, { ...safe.attributionDiagnostic, observed: 100_000_001 }, { ...safe.attributionDiagnostic, raw: "SELECT PRIVATE_CANARY" }]) {
    let rejected = false;
    try { serializeReport({ ...safe, attributionDiagnostic: mutation }); } catch (error) { rejected = error instanceof SafeFailure && error.code === "PROTOCOL"; }
    requireFact(rejected, "PRIVACY"); count++;
  }
  const priorCalibration = emptyReport("CALIBRATION");
  recordReportFailure(priorCalibration, attributionFailure(context, "MISSING", 4, 3));
  requireFact(priorCalibration.failure === "CALIBRATION" && priorCalibration.attributionDiagnostic === null && serializeReport(priorCalibration).includes('"failure":"CALIBRATION"'), "CALIBRATION"); count++;
  const timeout = emptyReport("ATTRIBUTION"); timeout.attributionDiagnostic = safe.attributionDiagnostic;
  recordReportFailure(timeout, new SafeFailure("INCOMPLETE"));
  recordReportFailure(timeout, attributionFailure(context, "LATE", 0, 1));
  requireFact(timeout.failure === "INCOMPLETE" && timeout.attributionDiagnostic === null && serializeReport(timeout).includes('"failure":"INCOMPLETE"'), "CALIBRATION"); count++;
  const first = emptyReport("ATTRIBUTION"); first.attributionDiagnostic = safe.attributionDiagnostic;
  recordReportFailure(first, attributionFailure(context, "LATE", 0, 1));
  requireFact(first.attributionDiagnostic.condition === "MISSING" && serializeReport(first).includes('"condition":"MISSING"'), "CALIBRATION"); count++;
  return count;
}
