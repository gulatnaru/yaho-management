import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { confirmApplicationSubmissionCore, ApplicationPaymentAlreadyExistsError, InsufficientApplicationDepositError, type ConfirmChoice } from "../../../server/reservation-applications/finance";
import { ApplicationNotPendingError } from "../../../lib/reservation-applications/errors";
import { DuplicateReservationError } from "../../../lib/reservations/errors";
import { guardEnvironment, poolUrl } from "./environment";
import { requireFact, SafeFailure, type Calibration, type Outcome } from "./contract";

export class EventCounter {
  active = false;
  events = 0;
  late = 0;
  private watched = false;
  event(): void { if (this.active) this.events++; else if (this.watched) this.late++; }
  start(): void { requireFact(!this.active, "CLIENT_BUSY"); requireFact(this.late === 0, "LATE_EVENT"); this.events = 0; this.active = true; this.watched = true; }
  stop(): number { requireFact(this.active, "CLIENT_BUSY"); this.active = false; return this.events; }
  async drain(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); requireFact(this.late === 0, "LATE_EVENT"); }
}
export type Contender = { db: PrismaClient<{ log: [{ level: "query"; emit: "event" }] }>; counter: EventCounter };
export type Clients = { setup: PrismaClient; measured: [Contender, Contender] };
export function clients(): Clients {
  guardEnvironment();
  const url = poolUrl();
  const setup = new PrismaClient({ datasourceUrl: url, log: [] });
  const create = (): Contender => {
    const counter = new EventCounter();
    const db = new PrismaClient({ datasourceUrl: url, log: [{ level: "query", emit: "event" }] });
    db.$on("query", () => counter.event());
    return { db, counter };
  };
  return { setup, measured: [create(), create()] };
}
export async function connect(c: Clients): Promise<boolean> {
  const connected = await Promise.allSettled([c.setup.$connect(), ...c.measured.map((m) => m.db.$connect())]);
  const connectionFailure = connected.find((result) => result.status === "rejected");
  if (connectionFailure?.status === "rejected") throw connectionFailure.reason;
  const sessions = await Promise.allSettled(c.measured.map((m) => m.db.$queryRaw<Array<{ value: number }>>`SELECT pg_backend_pid()::integer AS value`));
  const sessionFailure = sessions.find((result) => result.status === "rejected");
  if (sessionFailure?.status === "rejected") throw sessionFailure.reason;
  const [a, b] = sessions.map((result) => (result as PromiseFulfilledResult<Array<{ value: number }>>).value);
  const independent = a?.length === 1 && b?.length === 1 && a[0]!.value !== b[0]!.value;
  requireFact(independent, "ATTRIBUTION");
  return independent;
}
export async function disconnect(c: Clients): Promise<void> {
  const results = await Promise.allSettled([c.setup.$disconnect(), ...c.measured.map((m) => m.db.$disconnect())]);
  requireFact(results.every((r) => r.status === "fulfilled"), "CLEANUP");
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
export async function measureCore(contender: Contender, input: CoreInput): Promise<Call> {
  contender.counter.start();
  let outcome: Outcome = "UNKNOWN_INFRASTRUCTURE", fulfilled = false;
  let value: Call["value"], wall = 0, queries = 0;
  const started = performance.now();
  try { value = await confirmApplicationSubmissionCore(contender.db, input); fulfilled = true; outcome = "SUCCESS"; }
  catch (error) { outcome = classify(error); }
  finally { wall = performance.now() - started; queries = contender.counter.stop(); }
  return { wall, queries, outcome, fulfilled, value };
}
export async function measureRace(c: Clients, input: CoreInput, secondActor: string): Promise<{ calls: [Call, Call]; wall: number }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tasks = c.measured.map((contender, index) => (async () => { await gate; return measureCore(contender, { ...input, actorUserId: index === 0 ? input.actorUserId : secondActor }); })());
  const start = performance.now(); release();
  const settled = await Promise.allSettled(tasks);
  const wall = performance.now() - start;
  await Promise.all(c.measured.map((m) => m.counter.drain()));
  requireFact(settled.every((s) => s.status === "fulfilled"), "UNKNOWN_INFRASTRUCTURE");
  return { calls: settled.map((s) => (s as PromiseFulfilledResult<Call>).value) as [Call, Call], wall };
}
const TX_OPTIONS = { maxWait: 10000, timeout: 20000 } as const;
async function capture(contender: Contender, work: () => Promise<void>): Promise<number> {
  contender.counter.start();
  try { await work(); } finally { contender.counter.stop(); }
  await contender.counter.drain();
  return contender.counter.events;
}
export async function calibrate(c: Clients, programId: string): Promise<Calibration[]> {
  const evidence: Calibration[] = [];
  const original = await c.setup.program.findUniqueOrThrow({ where: { id: programId }, select: { name: true } });
  for (let index = 0; index < 2; index++) {
    const contender = c.measured[index]!, idle = c.measured[1 - index]!;
    for (const kind of ["SELECT", "COMMIT", "ROLLBACK"] as const) {
      const observed: number[] = [];
      for (let repetition = 0; repetition < 3; repetition++) {
        const idleEvents = idle.counter.events, idleLate = idle.counter.late;
        const sentinel = new SafeFailure("CALIBRATION");
        const events = await capture(contender, async () => {
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
        requireFact(kind === "SELECT" ? events === 1 : events >= 2, "CALIBRATION");
        requireFact(idle.counter.events === idleEvents && idle.counter.late === idleLate && !idle.counter.active, "ATTRIBUTION");
        requireFact((await c.setup.program.findUniqueOrThrow({ where: { id: programId }, select: { name: true } })).name === original.name, "CALIBRATION");
        observed.push(events);
      }
      requireFact(new Set(observed).size === 1, "CALIBRATION");
      evidence.push({ client: index === 0 ? "A" : "B", kind, explicit: kind === "SELECT" ? 1 : 2, repetitions: 3, eventMin: Math.min(...observed), eventMax: Math.max(...observed), verified: true, attribution: true, lateEvents: contender.counter.late });
    }
  }
  const independent: [number[], number[]] = [[], []];
  for (let repetition = 0; repetition < 3; repetition++) {
    const results = await Promise.allSettled(c.measured.map((m) => capture(m, async () => {
      const sum = await m.db.$transaction(async (tx) => {
        const a = await tx.$queryRaw<Array<{ value: number }>>`SELECT 1::integer AS value`;
        const b = await tx.$queryRaw<Array<{ value: number }>>`SELECT 2::integer AS value`;
        return a[0]!.value + b[0]!.value;
      }, TX_OPTIONS);
      requireFact(sum === 3, "CALIBRATION");
    })));
    requireFact(results.every((r) => r.status === "fulfilled"), "ATTRIBUTION");
    for (let index = 0; index < 2; index++) independent[index]!.push((results[index] as PromiseFulfilledResult<number>).value);
  }
  for (let index = 0; index < 2; index++) {
    const expected = evidence.find((e) => e.client === (index === 0 ? "A" : "B") && e.kind === "COMMIT")!.eventMin;
    requireFact(independent[index]!.every((value) => value === expected), "ATTRIBUTION");
    evidence.push({ client: index === 0 ? "A" : "B", kind: "INDEPENDENT", explicit: 2, repetitions: 3, eventMin: Math.min(...independent[index]!), eventMax: Math.max(...independent[index]!), verified: true, attribution: true, lateEvents: c.measured[index]!.counter.late });
  }
  return evidence;
}
