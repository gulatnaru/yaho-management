import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { confirmApplicationSubmissionCore, ApplicationPaymentAlreadyExistsError, InsufficientApplicationDepositError, type ConfirmChoice } from "../../../server/reservation-applications/finance";
import { ApplicationNotPendingError } from "../../../lib/reservation-applications/errors";
import { DuplicateReservationError } from "../../../lib/reservations/errors";
import { guardEnvironment, poolUrl } from "./environment";
import { attributionFailure, requireFact, SafeFailure, type AttributionContext, type Calibration, type Outcome } from "./contract";
import { EventCounter } from "./event-counter";
export { EventCounter } from "./event-counter";
export type Contender = { db: PrismaClient<{ log: [{ level: "query"; emit: "event" }] }>; counter: EventCounter };
export type Clients = { setup: PrismaClient; measured: [Contender, Contender] };
const deliveryModels = new WeakMap<Clients, { started: number; now: () => number }>();
function requireFreshDeliveryModel(c: Clients): void {
  const model = deliveryModels.get(c);
  const age = model ? model.now() - model.started : Number.NaN;
  // Native checkout health checks become eligible after 15s. The exact-count
  // model is valid only while every checkout is younger than that threshold.
  // Start before fresh $connect, allow at most 10s for ALL calibration, and keep
  // 5s margin. Quiet time must never mask a delayed extra health-check event.
  if (!Number.isFinite(age) || age < 0 || age >= 10000) throw attributionFailure({ stage: "MODEL", client: "PAIR", repetition: 0 }, "MODEL_EXPIRED", 1, 0);
}
export function clients(): Clients {
  guardEnvironment();
  // The exact event model below is audited against this generated native engine.
  requireFact(Prisma.prismaVersion.client === "6.19.3" && "engine" in Prisma.prismaVersion && Prisma.prismaVersion.engine === "c2990dca591cba766e3b7ef5d9e8a84796e47ab7", "CALIBRATION");
  const url = poolUrl();
  const setup = new PrismaClient({ datasourceUrl: url, log: [] });
  const create = (): Contender => {
    const counter = new EventCounter();
    const db = new PrismaClient({ datasourceUrl: url, log: [{ level: "query", emit: "event" }] });
    db.$on("query", (event) => counter.event(event.query));
    return { db, counter };
  };
  return { setup, measured: [create(), create()] };
}
export async function connect(c: Clients, now: () => number = () => performance.now()): Promise<boolean> {
  const context = { stage: "SESSION", client: "PAIR", repetition: 0 } as const;
  if (c.measured[0].db === c.measured[1].db || c.measured[0].counter === c.measured[1].counter) throw attributionFailure(context, "SESSION", 2, 1);
  // Reconnecting must not refresh the proof's age using an already-live pool.
  if (deliveryModels.has(c)) throw attributionFailure({ stage: "MODEL", client: "PAIR", repetition: 0 }, "UNPROVEN", 1, 0);
  deliveryModels.set(c, { started: now(), now });
  // Pinned native engine: fresh $connect emits one version() query; the PID
  // probe emits one more. Observe BEFORE $connect: ignoring bootstrap callbacks
  // permits them to bleed into calibration. Fresh mobc connections skip the
  // 15-second checkout health check. An unexpected extra still fails closed.
  const connected = await Promise.allSettled([c.setup.$connect(), ...c.measured.map((m, index) => captureKnown(m, 2, { stage: "BOOTSTRAP", client: index === 0 ? "A" : "B", repetition: 0 }, async () => {
    await m.db.$connect();
    return m.db.$queryRaw<Array<{ value: number }>>`SELECT pg_backend_pid()::integer AS value`;
  }))]);
  const connectionFailure = connected.find((result) => result.status === "rejected");
  if (connectionFailure?.status === "rejected") throw connectionFailure.reason;
  const [a, b] = connected.slice(1).map((result) => (result as PromiseFulfilledResult<{ value: Array<{ value: number }> }>).value.value);
  const valid = (rows: Array<{ value: number }> | undefined): boolean => rows?.length === 1 && Number.isSafeInteger(rows[0]?.value) && rows[0]!.value > 0;
  const independent = valid(a) && valid(b) && a![0]!.value !== b![0]!.value;
  if (!independent) throw attributionFailure(context, "SESSION", 2, valid(a) && valid(b) ? 1 : 0);
  await auditCounters(c, "BOOTSTRAP");
  requireFreshDeliveryModel(c);
  return independent;
}
export async function disconnect(c: Clients): Promise<void> {
  let contamination: unknown;
  try { await auditCounters(c, "DISCONNECT"); } catch (error) { contamination = error; }
  const results = await Promise.allSettled([c.setup.$disconnect(), ...c.measured.map((m) => m.db.$disconnect())]);
  try { await auditCounters(c, "DISCONNECT"); } catch (error) { contamination ??= error; }
  requireFact(results.every((r) => r.status === "fulfilled"), "CLEANUP");
  if (contamination) throw contamination;
}
export async function auditCounters(c: Clients, stage: AttributionContext["stage"] = "IDLE"): Promise<void> {
  const results = await Promise.allSettled(c.measured.map((m) => m.counter.drain()));
  for (let index = 0; index < 2; index++) if (results[index]!.status === "rejected") {
    const counter = c.measured[index]!.counter;
    throw attributionFailure({ stage, client: index === 0 ? "A" : "B", repetition: 0 }, "LATE", 0, counter.late, counter.late);
  }
}
export function classify(value: unknown): Outcome {
  if (value instanceof ApplicationNotPendingError) return "ApplicationNotPendingError";
  if (value instanceof InsufficientApplicationDepositError) return "InsufficientApplicationDepositError";
  if (value instanceof DuplicateReservationError) return "DuplicateReservationError";
  if (value instanceof ApplicationPaymentAlreadyExistsError) return "ApplicationPaymentAlreadyExistsError";
  return "UNKNOWN_INFRASTRUCTURE";
}
export type CoreInput = { submissionId: string; choices: ConfirmChoice[]; actorUserId: string; now: Date };
export type Call = { wall: number; queries: number; outcome: Outcome; fulfilled: boolean; value?: { paymentId: string; reservationIds: string[] } };
export async function measureCore(contender: Contender, input: CoreInput, context: AttributionContext = { stage: "SAMPLE", client: "A", repetition: 0 }, onSettled: () => void = () => {}): Promise<Call> {
  try { contender.counter.startFenced(); }
  catch (error) {
    if (error instanceof SafeFailure && error.code === "LATE_EVENT") throw attributionFailure(context, "LATE", 0, contender.counter.late, contender.counter.late);
    throw error;
  }
  let outcome: Outcome = "UNKNOWN_INFRASTRUCTURE", fulfilled = false;
  let value: Call["value"], wall = 0, queries = 0;
  const started = performance.now();
  try { value = await confirmApplicationSubmissionCore(contender.db, input); fulfilled = true; outcome = "SUCCESS"; }
  catch (error) { outcome = classify(error); }
  finally { wall = performance.now() - started; onSettled(); }
  queries = await contender.counter.completeFenced(fulfilled, context);
  try { await contender.counter.drain(); }
  catch (error) {
    if (error instanceof SafeFailure && error.code === "LATE_EVENT") throw attributionFailure(context, "LATE", 0, contender.counter.late, contender.counter.late);
    throw error;
  }
  return { wall, queries, outcome, fulfilled, value };
}
export async function measureRace(c: Clients, input: CoreInput, secondActor: string): Promise<{ calls: [Call, Call]; wall: number }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let settledCalls = 0, settledAt = 0;
  const tasks = c.measured.map((contender, index) => (async () => {
    await gate;
    return measureCore(contender, { ...input, actorUserId: index === 0 ? input.actorUserId : secondActor }, { stage: "SAMPLE", client: index === 0 ? "A" : "B", repetition: 0 }, () => { if (++settledCalls === 2) settledAt = performance.now(); });
  })());
  const start = performance.now(); release();
  const settled = await Promise.allSettled(tasks);
  const wall = settledAt - start;
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  await auditCounters(c, "SAMPLE");
  return { calls: settled.map((s) => (s as PromiseFulfilledResult<Call>).value) as [Call, Call], wall };
}
const TX_OPTIONS = { maxWait: 10000, timeout: 20000 } as const;
export async function captureKnown<T>(contender: Contender, expected: number, context: AttributionContext, work: () => Promise<T>): Promise<{ value: T; events: number }> {
  try {
    contender.counter.start();
    const value = await work();
    const events = await contender.counter.complete(expected, context);
    await contender.counter.drain();
    return { value, events };
  } catch (error) {
    if (contender.counter.active) contender.counter.stop();
    if (error instanceof SafeFailure && error.code === "LATE_EVENT") throw attributionFailure(context, "LATE", expected, contender.counter.events, contender.counter.late);
    if (error instanceof SafeFailure) throw error;
    throw attributionFailure(context, "WORK", expected, contender.counter.events, contender.counter.late);
  }
}
export async function calibrate(c: Clients, programId: string): Promise<Calibration[]> {
  const evidence: Calibration[] = [];
  requireFreshDeliveryModel(c);
  await auditCounters(c);
  const original = await c.setup.program.findUniqueOrThrow({ where: { id: programId }, select: { name: true } });
  for (let index = 0; index < 2; index++) {
    const contender = c.measured[index]!, idle = c.measured[1 - index]!;
    for (const kind of ["SELECT", "COMMIT", "ROLLBACK"] as const) {
      const observed: number[] = [];
      for (let repetition = 0; repetition < 3; repetition++) {
        const idleEvents = idle.counter.events, idleLate = idle.counter.late;
        const sentinel = new SafeFailure("CALIBRATION");
        const context = { stage: kind, client: index === 0 ? "A" : "B", repetition: repetition + 1 } as const;
        // Exact pinned native-engine coverage: standalone SELECT=1; transaction
        // BEGIN + two explicit statements + COMMIT/ROLLBACK=4. A quiet interval
        // never substitutes for reaching this total. No SQL payload inspection.
        const { events } = await captureKnown(contender, kind === "SELECT" ? 1 : 4, context, async () => {
          if (kind === "SELECT") {
            const rows = await contender.db.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
            requireFact(rows.length === 1 && rows[0]?.value === 1, "CALIBRATION");
          } else if (kind === "COMMIT") {
            const sum = await contender.db.$transaction(async (tx) => {
              const a = await tx.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
              const b = await tx.$queryRaw<Array<{ value: number }>>`SELECT 2::integer AS value`;
              return a[0]!.value + b[0]!.value;
            }, TX_OPTIONS);
            requireFact(sum === 3, "CALIBRATION");
          } else {
            let rolledBack = false;
            try {
              await contender.db.$transaction(async (tx) => {
                const changed = await tx.$executeRaw`UPDATE "Program" SET "name" = 'Synthetic calibration' WHERE "id" = ${programId}`;
                const rows = await tx.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
                requireFact(changed === 1 && rows[0]?.value === 1, "CALIBRATION");
                throw sentinel;
              }, TX_OPTIONS);
            } catch (error) { requireFact(error === sentinel, "CALIBRATION"); rolledBack = true; }
            requireFact(rolledBack, "CALIBRATION");
          }
        });
        if (idle.counter.events !== idleEvents || idle.counter.late !== idleLate || idle.counter.active) throw attributionFailure(context, "IDLE", 0, Math.abs(idle.counter.events - idleEvents) + Math.abs(idle.counter.late - idleLate), idle.counter.late);
        await auditCounters(c);
        requireFact((await c.setup.program.findUniqueOrThrow({ where: { id: programId }, select: { name: true } })).name === original.name, "CALIBRATION");
        observed.push(events);
      }
      requireFact(new Set(observed).size === 1, "CALIBRATION");
      evidence.push({ client: index === 0 ? "A" : "B", kind, explicit: kind === "SELECT" ? 1 : 2, repetitions: 3, eventMin: Math.min(...observed), eventMax: Math.max(...observed), verified: true, attribution: true, lateEvents: contender.counter.late });
    }
  }
  const independent: [number[], number[]] = [[], []];
  for (let repetition = 0; repetition < 3; repetition++) {
    const results = await Promise.allSettled(c.measured.map((m, index) => captureKnown(m, 4, { stage: "CONCURRENT", client: index === 0 ? "A" : "B", repetition: repetition + 1 }, async () => {
      const sum = await m.db.$transaction(async (tx) => {
        const a = await tx.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
        const b = await tx.$queryRaw<Array<{ value: number }>>`SELECT 2::integer AS value`;
        return a[0]!.value + b[0]!.value;
      }, TX_OPTIONS);
      requireFact(sum === 3, "CALIBRATION");
    })));
    for (const result of results) if (result.status === "rejected") throw result.reason;
    await auditCounters(c);
    for (let index = 0; index < 2; index++) independent[index]!.push((results[index] as PromiseFulfilledResult<{ events: number }>).value.events);
  }
  for (let index = 0; index < 2; index++) {
    const expected = evidence.find((e) => e.client === (index === 0 ? "A" : "B") && e.kind === "COMMIT")!.eventMin;
    if (!independent[index]!.every((value) => value === expected)) throw attributionFailure({ stage: "CONCURRENT", client: index === 0 ? "A" : "B", repetition: 0 }, "COUNT", expected, independent[index]![0]!);
    evidence.push({ client: index === 0 ? "A" : "B", kind: "INDEPENDENT", explicit: 2, repetitions: 3, eventMin: Math.min(...independent[index]!), eventMax: Math.max(...independent[index]!), verified: true, attribution: true, lateEvents: c.measured[index]!.counter.late });
  }
  // Equal totals alone cannot detect swapped counter ownership. Keep the
  // original equal-work evidence rows, and additionally probe asymmetric work
  // in BOTH directions: one client's 4 events vs the other's 5 events.
  for (let direction = 0; direction < 2; direction++) for (let repetition = 0; repetition < 3; repetition++) {
    const results = await Promise.allSettled(c.measured.map((m, index) => captureKnown(m, index === direction ? 4 : 5, { stage: "ASYMMETRIC", client: index === 0 ? "A" : "B", repetition: repetition + 1 }, async () => {
      await m.db.$transaction(async (tx) => {
        const a = await tx.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
        const b = await tx.$queryRaw<Array<{ value: number }>>`SELECT 2::integer AS value`;
        requireFact(a[0]?.value === 1 && b[0]?.value === 2, "CALIBRATION");
        if (index !== direction) {
          const extra = await tx.$queryRaw<Array<{ value: number }>>`SELECT 3::integer AS value`;
          requireFact(extra[0]?.value === 3, "CALIBRATION");
        }
      }, TX_OPTIONS);
    })));
    for (const result of results) if (result.status === "rejected") throw result.reason;
    await auditCounters(c);
  }
  await auditCounters(c);
  requireFreshDeliveryModel(c);
  return evidence;
}
