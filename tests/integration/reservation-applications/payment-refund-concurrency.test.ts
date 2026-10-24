import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, actor: "", authenticated: true }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
// Supply session identity only; the real principal lookup and ADMIN guard still execute.
vi.mock("@/auth", () => ({ auth: async () => context.authenticated ? { user: { id: context.actor, authVersion: 1 } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path === "/login" ? "SYNTHETIC_LOGIN" : "SYNTHETIC_REFUND_REDIRECT"); },
  notFound: () => { throw new Error("SYNTHETIC_FORBIDDEN"); },
}));
import { createRefund } from "@/app/(admin)/payments/actions";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { createRefundCore, type CreateRefundCoreInput } from "@/lib/payments/core";
import { NoShowRefundDetailRequiredError, PaymentItemNotFoundError, RefundAmountExceededError } from "@/lib/payments/errors";
import { confirmApplicationSubmissionCore, recordApplicationDepositCore, recordApplicationReturnCore } from "@/server/reservation-applications/finance";
import { buildPaymentFactsQuery, buildRefundFactsQuery } from "@/server/revenue/queries";
import { mergeRevenueFacts } from "@/server/revenue/aggregate";
import { resolveRevenuePeriod } from "@/server/revenue/period";
import type { PaymentFact, RefundFact, RevenueQueryFilters } from "@/server/revenue/types";

// EXACT sibling-suite admission guards, before ANY PrismaClient construction.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const db = new PrismaClient();
context.db = db;
const run = `refund-6d-${crypto.randomUUID()}`;
const admins = [`${run}-admin1`, `${run}-admin2`] as const;
const managerId = `${run}-manager`, teacherUserId = `${run}-teacher-user`, teacherId = `${run}-teacher`;
context.actor = admins[0];
const owned: string[] = [];
const classes: string[] = [];
let sequence = 0;
const POLL_DEADLINE_MS = 8_000; // A failure bound, NEVER an interleaving mechanism (core timeout: 20s).
const now = new Date("2026-10-24T00:00:00Z");

type Fixture = { submissionId: string; paymentId: string; items: [string, string]; withReturn: boolean };
type Stage = "started" | "parent-lock-wait" | "parent-locked" | "item-lock-wait" | "item-locked" |
  "refund-created" | "item-updated" | "aggregate-completed" | "parent-update-wait" | "parent-updated";
type Worker = {
  pid: number;
  stage: Stage;
  stages: Stage[];
  aggregate?: { paid: number; refunded: number };
  outcome: "running" | "committed" | "rolled-back";
};
type Result<T> = PromiseSettledResult<T>;
type TransactionOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };
type Observation = {
  pid: number; observerPid: number; state: string; waitEventType: string | null;
  statement: "parent-update" | "parent-lock" | "item-lock" | "other";
  blockers: number[]; waitingRowOrTransaction: boolean; paymentRelationLock: boolean;
};

function inconclusive(reason: string): never { throw new Error(`INCONCLUSIVE: ${reason}; C10 NOT REPRODUCED`); }
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function settled<T>(promise: Promise<T>): Promise<Result<T>> {
  // Attach rejection handling immediately, including before a controller handshake.
  return promise.then((value) => ({ status: "fulfilled", value }), (reason: unknown) => ({ status: "rejected", reason }));
}
function successful<T>(result: Result<T>, label: string): T {
  if (result.status !== "fulfilled") inconclusive(`${label} did not commit`);
  return result.value;
}
async function runtime(client: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const [row] = await client.$queryRaw<Array<{ pid: number; version: number; database: string; username: string; isolation: string }>>`
    SELECT pg_backend_pid() AS pid, current_setting('server_version_num')::int AS version,
           current_database()::text AS database, current_user::text AS username,
           current_setting('transaction_isolation')::text AS isolation
  `;
  if (!row || row.version < 160000 || row.version >= 170000 || row.database !== "yaho_e2e" || row.username !== "yaho_e2e" || row.isolation !== "read committed") {
    inconclusive("require isolated yaho_e2e/user, PostgreSQL 16 and READ COMMITTED");
  }
  return row.pid;
}
function dedicatedClient() {
  // One physical session per client; only the already-admitted URL's test pool size changes.
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function fixture(withReturn = false): Promise<Fixture> {
  const submissionId = `${run}-s${++sequence}`;
  owned.push(submissionId);
  const classIds = [0, 1].map((i) => `${submissionId}-c${i}`);
  classes.push(...classIds);
  await db.classSchedule.createMany({ data: classIds.map((id) => ({ id, programId: run,
    startsAt: new Date("2040-01-01T00:00:00Z"), endsAt: new Date("2040-01-01T01:00:00Z"),
    location: "합성 장소", capacity: 8, applicationPrice: 40_000 })) });
  await db.reservationApplicationSubmission.create({ data: { id: submissionId, guardianName: `${submissionId}-합성 보호자`,
    guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 신고명" } });
  const applicationIds = classIds.map((_, i) => `${submissionId}-a${i}`);
  await db.reservationApplication.createMany({ data: classIds.map((classScheduleId, i) => ({
    id: applicationIds[i]!, submissionId, classScheduleId, quotedAmount: 40_000,
    childName: `${submissionId}-합성 아이${i}`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED",
    programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true,
    refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false,
    consentVersion: APPLICATION_CONSENT_CONTENT.version,
  })) });
  await recordApplicationDepositCore(db, { submissionId, amount: withReturn ? 100_000 : 80_000, payerName: "합성 입금자",
    depositedAt: new Date("2026-01-01"), actorUserId: admins[0], now });
  const confirmed = await confirmApplicationSubmissionCore(db, { submissionId,
    choices: applicationIds.map((applicationId) => ({ applicationId, newChild: true })), actorUserId: admins[0], now });
  const payment = await db.payment.findUniqueOrThrow({ where: { id: confirmed.paymentId }, include: { items: { orderBy: { reservationId: "asc" }, include: { reservation: true } } } });
  expect(payment).toMatchObject({ status: "PAID", totalAmount: 80_000 });
  expect(payment.items).toHaveLength(2);
  for (const item of payment.items) {
    expect(item).toMatchObject({ paymentId: payment.id, amount: 40_000, paidAmount: 40_000, discountAmount: 0, refundedAmount: 0,
      reservation: { status: "RESERVED", attendance: null } });
  }
  expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: classIds } } } } } })).toBe(1);
  if (withReturn) {
    const obligation = await db.returnObligation.findFirstOrThrow({ where: { submissionId, kind: "EXCESS" } });
    await recordApplicationReturnCore(db, { obligationId: obligation.id, amount: 5_000, reason: "합성 초과입금 부분 반환",
      returnedAt: new Date("2026-01-02"), idempotencyKey: crypto.randomUUID(), actorUserId: admins[0], now });
  }
  return { submissionId, paymentId: payment.id, items: [payment.items[0]!.id, payment.items[1]!.id], withReturn };
}
async function ledger(f: Fixture) {
  const detail = (await getApplicationWorkflowDetail(f.submissionId))!;
  expect(detail.ledger.state).toBe("available");
  if (detail.ledger.state !== "available") throw new Error("SYNTHETIC_LEDGER_INVALID");
  expect(detail.ledger.D).toBe(detail.ledger.A + detail.ledger.P + detail.ledger.R + detail.ledger.T);
  expect(detail.ledger).toMatchObject(f.withReturn
    ? { D: 100_000, A: 0, P: 80_000, R: 15_000, T: 5_000 }
    : { D: 80_000, A: 0, P: 80_000, R: 0, T: 0 });
  return detail.ledger;
}
async function snapshot(paymentId: string) {
  return db.$transaction((tx) => tx.payment.findUniqueOrThrow({ where: { id: paymentId },
    include: { items: { orderBy: { id: "asc" }, include: { refunds: { orderBy: { id: "asc" } } } } } }),
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
function assertCounters(payment: Awaited<ReturnType<typeof snapshot>>, amounts: ReadonlyMap<string, number>) {
  expect(payment.items).toHaveLength(2);
  for (const item of payment.items) {
    expect(item.paidAmount).toBe(40_000);
    expect(item.refundedAmount).toBe(amounts.get(item.id) ?? 0);
    expect(item.refunds.filter((refund) => refund.status === "COMPLETED").reduce((sum, refund) => sum + refund.amount, 0)).toBe(item.refundedAmount);
    expect(item.refundedAmount).toBeGreaterThanOrEqual(0);
    expect(item.refundedAmount).toBeLessThanOrEqual(item.paidAmount);
  }
}
function assertRefundState(payment: Awaited<ReturnType<typeof snapshot>>, amounts: ReadonlyMap<string, number>) {
  assertCounters(payment, amounts);
  const paid = payment.items.reduce((sum, item) => sum + item.paidAmount, 0);
  const refunded = payment.items.reduce((sum, item) => sum + item.refundedAmount, 0);
  // Independent oracle over committed rows, without calling production resolvePaymentStatus.
  expect(payment.status).toBe(refunded === 0 ? "PAID" : refunded === paid ? "REFUNDED" : "PARTIAL_REFUNDED");
}
function refundInput(f: Fixture, amount: number, index: 0 | 1 = 0): CreateRefundCoreInput {
  return { paymentItemId: f.items[index], amount, reason: "PERSONAL", processedById: admins[index] };
}
async function financialRows(f: Fixture) {
  return db.$transaction(async (tx) => ({
    mappings: await tx.reservationApplicationPaymentMapping.findMany({ where: { application: { submissionId: f.submissionId } }, orderBy: { id: "asc" } }),
    allocations: await tx.fundAllocation.findMany({ where: { deposit: { submissionId: f.submissionId } }, orderBy: { id: "asc" } }),
    obligations: await tx.returnObligation.findMany({ where: { submissionId: f.submissionId }, orderBy: { id: "asc" } }),
    returns: await tx.applicationReturn.findMany({ where: { returnObligation: { submissionId: f.submissionId } }, orderBy: { id: "asc" } }),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Real transaction forwarding only: no fake lock/aggregate or altered transaction options. */
function instrument(tx: Prisma.TransactionClient, worker: Worker, input: CreateRefundCoreInput, paymentId: string,
  itemGate?: ReturnType<typeof gate>, failAfter?: Stage) {
  const mark = (stage: Stage) => {
    worker.stage = stage; worker.stages.push(stage);
    if (stage === failAfter) throw new Error(`SYNTHETIC_REFUND_FAILURE:${stage}`);
  };
  const delegate = <T extends object>(target: T, overrides: Record<string, (...args: never[]) => unknown>) => new Proxy(target, {
    get(object, property) {
      if (typeof property === "string" && property in overrides) return overrides[property];
      const value: unknown = Reflect.get(object, property);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  const wrapped = new Proxy(tx, {
    get(target, property) {
      if (property === "$queryRaw") return async (...args: unknown[]) => {
        const query = args[0] as TemplateStringsArray | Prisma.Sql;
        const text = ("strings" in query ? query.strings : query).join(" ");
        const itemLock = /FROM\s+"PaymentItem"\s+pi/.test(text) && /FOR\s+UPDATE\s+OF\s+pi/.test(text);
        const parentLock = /FROM\s+(?:"public"\.)?"Payment"\s/.test(text) && /FOR\s+UPDATE/.test(text);
        if (itemLock) mark("item-lock-wait");
        if (parentLock) mark("parent-lock-wait");
        const result: unknown = await Reflect.apply(target.$queryRaw, target, args);
        if (parentLock) mark("parent-locked");
        if (itemLock) {
          mark("item-locked");
          if (itemGate) await itemGate.promise;
        }
        return result;
      };
      if (property === "refund") return delegate(target.refund, {
        create: async (args: Prisma.RefundCreateArgs) => {
          expect(args.data).toMatchObject({ paymentItemId: input.paymentItemId, amount: input.amount, processedById: input.processedById });
          const result = await target.refund.create(args); mark("refund-created"); return result;
        },
      });
      if (property === "paymentItem") return delegate(target.paymentItem, {
        update: async (args: Prisma.PaymentItemUpdateArgs) => {
          expect(args.where.id).toBe(input.paymentItemId);
          const result = await target.paymentItem.update(args); mark("item-updated"); return result;
        },
        aggregate: async (args: Prisma.PaymentItemAggregateArgs) => {
          expect(args.where?.paymentId).toBe(paymentId);
          const result = await target.paymentItem.aggregate(args);
          worker.aggregate = { paid: result._sum?.paidAmount ?? 0, refunded: result._sum?.refundedAmount ?? 0 };
          mark("aggregate-completed"); return result;
        },
      });
      if (property === "payment") return delegate(target.payment, {
        update: async (args: Prisma.PaymentUpdateArgs) => {
          expect(args.where.id).toBe(paymentId); mark("parent-update-wait");
          const result = await target.payment.update(args); mark("parent-updated"); return result;
        },
      });
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return wrapped;
}

async function harness<T>(body: (h: ReturnType<typeof makeHarness>) => Promise<T>) {
  const h = makeHarness();
  try { await h.initialize(); return await body(h); }
  finally { await h.close(); } // Never overlap fixture teardown with an outstanding worker/controller.
}
function makeHarness() {
  const controller = dedicatedClient(), observer = dedicatedClient();
  const clients = [dedicatedClient(), dedicatedClient()] as const;
  const releases: Array<() => void> = [];
  const tasks: Array<Promise<Result<unknown>>> = [];
  const workers: Worker[] = [];
  let observerPid = 0;
  let controllerPid = 0;
  async function poll(label: string, predicate: () => Promise<boolean>) {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    try {
      while (Date.now() < deadline) {
        if (await predicate()) return;
        // Fresh I/O yields the event loop, without a delay or a timing-based success condition.
        await observer.$queryRaw`SELECT 1`;
      }
    } catch { inconclusive(`${label}: observation/environment failure`); }
    inconclusive(`${label}: barrier not established (pid/stage/outcome=${JSON.stringify(workers)})`);
  }
  async function observe(): Promise<Observation[]> {
    const pids = [controllerPid, ...workers.map((worker) => worker.pid)].filter((pid) => pid !== 0);
    if (!pids.length) return [];
    return observer.$queryRaw<Observation[]>`
      SELECT a.pid, pg_backend_pid() AS "observerPid", a.state, a.wait_event_type AS "waitEventType",
        CASE
          WHEN a.query ~ '^[[:space:]]*UPDATE[[:space:]]+("public"[.])?"Payment"[[:space:]]' THEN 'parent-update'
          WHEN a.query ~ 'FROM[[:space:]]+("public"[.])?"Payment"[[:space:]]' AND a.query ~ 'FOR[[:space:]]+UPDATE' THEN 'parent-lock'
          WHEN a.query ~ 'FROM[[:space:]]+"PaymentItem"[[:space:]]+pi' AND a.query ~ 'FOR[[:space:]]+UPDATE[[:space:]]+OF[[:space:]]+pi' THEN 'item-lock'
          ELSE 'other' END AS statement,
        pg_blocking_pids(a.pid) AS blockers,
        EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted
          AND l.locktype IN ('transactionid', 'tuple')) AS "waitingRowOrTransaction",
        EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.granted
          AND l.locktype = 'relation' AND l.relation = '"Payment"'::regclass) AS "paymentRelationLock"
      FROM pg_stat_activity a WHERE a.pid IN (${Prisma.join(pids)})
    `;
  }
  function reaches(rows: Observation[], from: number, destination: number, visited = new Set<number>()): boolean {
    if (from === destination) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return rows.find((row) => row.pid === from)?.blockers.some((pid) => reaches(rows, pid, destination, visited)) ?? false;
  }
  function distinctPids() {
    const pids = [observerPid, controllerPid, ...workers.map((worker) => worker.pid)];
    if (pids.some((pid) => !pid) || new Set(pids).size !== pids.length) inconclusive("controller/observer/workers must have distinct backend PIDs");
  }
  async function holdParent(paymentId: string) {
    const release = gate(); releases.push(release.release);
    let held = false;
    const result = settled(controller.$transaction(async (tx) => {
      controllerPid = await runtime(tx);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR NO KEY UPDATE`;
      if (rows.length !== 1) inconclusive("controller parent fixture is missing");
      held = true;
      await release.promise;
    }, { maxWait: 10_000, timeout: 30_000 }));
    tasks.push(result);
    await poll("controller lock-acquired handshake", async () => held);
    return { release: release.release, result };
  }
  function start(index: 0 | 1, f: Fixture, paymentItemId: string, itemGate?: ReturnType<typeof gate>, amount = 40_000, failAfter?: Stage) {
    if (itemGate) releases.push(itemGate.release);
    const worker: Worker = { pid: 0, stage: "started", stages: [], outcome: "running" }; workers.push(worker);
    const input: CreateRefundCoreInput = { paymentItemId, amount, reason: "PERSONAL", processedById: admins[index] };
    // Only this test adapter boundary needs a PrismaClient cast. Every DB method is forwarded/bound.
    const client = new Proxy(clients[index], { get(target, property) {
      if (property === "$transaction") return <R>(callback: (tx: Prisma.TransactionClient) => Promise<R>, options?: TransactionOptions) =>
        target.$transaction(async (tx) => {
          worker.pid = await runtime(tx);
          return callback(instrument(tx, worker, input, f.paymentId, itemGate, failAfter));
        }, options);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as PrismaClient;
    const result = settled(createRefundCore(client, input).then((value) => { worker.outcome = "committed"; return value; }, (error: unknown) => {
      worker.outcome = "rolled-back"; throw error;
    }));
    tasks.push(result);
    return { worker, result };
  }
  function parentBlocked(rows: Observation[], worker: Worker) {
    const row = rows.find((candidate) => candidate.pid === worker.pid);
    return worker.outcome === "running" && !!row && row.observerPid === observerPid && row.state === "active" &&
      row.waitEventType === "Lock" && row.waitingRowOrTransaction && row.paymentRelationLock &&
      ((worker.stage === "parent-update-wait" && row.statement === "parent-update") ||
        (worker.stage === "parent-lock-wait" && row.statement === "parent-lock")) && reaches(rows, worker.pid, controllerPid);
  }
  async function waitParentBlocked(worker: Worker) {
    await poll("worker parent lock wait reaches controller", async () => parentBlocked(await observe(), worker));
  }
  return {
    initialize: async () => { observerPid = await runtime(observer); },
    poll, observe, reaches, parentBlocked, distinctPids, holdParent, start, waitParentBlocked,
    close: async () => {
      for (const release of releases) release();
      await Promise.allSettled(tasks);
      await Promise.allSettled([controller.$disconnect(), observer.$disconnect(), ...clients.map((client) => client.$disconnect())]);
    },
  };
}

beforeAll(async () => {
  await runtime(db);
  await db.teacher.create({ data: { id: teacherId, name: "합성 선생님" } });
  await db.user.createMany({ data: admins.map((id) => ({ id, name: "합성 관리자", email: `${id}@example.test`, role: "ADMIN" })) });
  await db.user.createMany({ data: [
    { id: managerId, name: "합성 매니저", email: `${managerId}@example.test`, role: "MANAGER" },
    { id: teacherUserId, name: "합성 선생님 계정", email: `${teacherUserId}@example.test`, role: "TEACHER", teacherId },
  ] });
  await db.program.create({ data: { id: run, name: "합성 환불 경합 프로그램", defaultPrice: 40_000 } });
}, 30_000);
afterAll(async () => {
  try {
    const childIds = (await db.reservation.findMany({ where: { classScheduleId: { in: classes } }, select: { childId: true } })).map((row) => row.childId);
    const paymentIds = (await db.paymentItem.findMany({ where: { reservation: { classScheduleId: { in: classes } } }, select: { paymentId: true } })).map((row) => row.paymentId);
    await db.fundAllocation.deleteMany({ where: { deposit: { submissionId: { in: owned } } } });
    await db.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: { in: owned } } } });
    await db.returnObligation.deleteMany({ where: { submissionId: { in: owned } } });
    await db.applicationDeposit.deleteMany({ where: { submissionId: { in: owned } } });
    await db.reservationApplicationPaymentMapping.deleteMany({ where: { application: { submissionId: { in: owned } } } });
    await db.childConsent.deleteMany({ where: { OR: [{ childId: { in: childIds } }, { child: { guardianName: { startsWith: run } } }] } });
    await db.reservationApplication.deleteMany({ where: { submissionId: { in: owned } } });
    await db.refund.deleteMany({ where: { paymentItem: { paymentId: { in: paymentIds } } } });
    await db.paymentItem.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await db.reservation.deleteMany({ where: { classScheduleId: { in: classes } } });
    await db.reservationApplicationSubmission.deleteMany({ where: { id: { in: owned } } });
    await db.child.deleteMany({ where: { OR: [{ id: { in: childIds } }, { guardianName: { startsWith: run } }] } });
    await db.classSchedule.deleteMany({ where: { id: { in: classes } } });
    await db.program.deleteMany({ where: { id: run } });
    await db.user.deleteMany({ where: { id: { in: [...admins, managerId, teacherUserId] } } });
    await db.teacher.deleteMany({ where: { id: teacherId } });
  } finally { await db.$disconnect(); }
}, 30_000);

describe.sequential("Iteration 6D real PostgreSQL refund concurrency — ORIGINAL core regression", () => {
  it("C10: two admins fully refund different 40000 items; committed Payment.status must be REFUNDED", async () => {
    const f = await fixture(); const before = await ledger(f);
    await harness(async (h) => {
      const hold = await h.holdParent(f.paymentId);
      const first = h.start(0, f, f.items[0]); const second = h.start(1, f, f.items[1]);
      // One snapshot must prove BOTH workers blocked at the parent before either commits.
      await h.poll("both refund transactions at the same parent barrier", async () => {
        const rows = await h.observe();
        return [first.worker, second.worker].every((worker) => h.parentBlocked(rows, worker));
      });
      h.distinctPids();
      const original = [first.worker, second.worker].every((worker) => worker.stage === "parent-update-wait");
      const fixed = [first.worker, second.worker].every((worker) => worker.stage === "parent-lock-wait");
      if (!original && !fixed) inconclusive("mixed/unrecognized parent wait stages");
      if (original) for (const worker of [first.worker, second.worker]) {
        const required: Stage[] = ["item-lock-wait", "item-locked", "refund-created", "item-updated", "aggregate-completed", "parent-update-wait"];
        if (worker.stages.join("|") !== required.join("|") || worker.aggregate?.paid !== 80_000 || worker.aggregate.refunded !== 40_000) {
          inconclusive("original barrier requires both completed item/refund/aggregate stages and exact aggregate 80000/40000");
        }
      }
      else for (const worker of [first.worker, second.worker]) {
        if (worker.stages.join("|") !== "parent-lock-wait") inconclusive("fixed barrier must precede target item lock and writes");
      }
      // Diagnostic is deliberately limited to PIDs, fixed stages and numeric aggregates.
      console.info("C10 forced interleaving", [first.worker, second.worker].map(({ pid, stage, aggregate }) => ({ pid, stage, aggregate })));
      hold.release(); successful(await hold.result, "controller");
      const a = successful(await first.result, "first refund"), b = successful(await second.result, "second refund");
      expect(a.refundedAmount).toBe(40_000); expect(b.refundedAmount).toBe(40_000);
      if (fixed) for (const worker of [first.worker, second.worker]) {
        expect(worker.stages.indexOf("parent-locked")).toBeLessThan(worker.stages.indexOf("item-lock-wait"));
      }
      const payment = await snapshot(f.paymentId);
      assertCounters(payment, new Map(f.items.map((id) => [id, 40_000])));
      for (const [index, id] of f.items.entries()) {
        const item = payment.items.find((candidate) => candidate.id === id)!;
        expect(item.refunds).toHaveLength(1);
        expect(item.refunds[0]).toMatchObject({ id: index === 0 ? a.refundId : b.refundId, paymentItemId: id, amount: 40_000, status: "COMPLETED", processedById: admins[index] });
      }
      expect(await ledger(f)).toEqual(before);
      // EXPECTED RED against 09f404a ORIGINAL code: observed PARTIAL_REFUNDED vs REFUNDED.
      // This correct-behavior assertion MUST remain last; never it.fails/skip/expect the defect.
      expect(payment.status, `C10 Payment.status observed=${payment.status}; expected=REFUNDED (both items/Refunds fully refunded; barrier proven)`).toBe("REFUNDED");
    });
  }, 45_000);

  it("same item: concurrent full refunds serialize and reject the over-refund without a second Refund", async () => {
    const f = await fixture(); const before = await ledger(f);
    await harness(async (h) => {
      const hold = await h.holdParent(f.paymentId);
      const itemGate = gate();
      const first = h.start(0, f, f.items[0], itemGate);
      // Original reaches item-lock gate; fixed code waits at parent. Neither can commit.
      await h.poll("first refund owns item or waits for parent", async () =>
        first.worker.stage === "item-locked" || first.worker.stage === "parent-lock-wait");
      const second = h.start(1, f, f.items[0]);
      await h.poll("same-item second refund demonstrably blocked", async () => {
        const rows = await h.observe(); const row = rows.find((candidate) => candidate.pid === second.worker.pid);
        if (!row || row.state !== "active" || row.waitEventType !== "Lock" || !row.waitingRowOrTransaction) return false;
        if (first.worker.stage === "item-locked") return row.statement === "item-lock" && h.reaches(rows, second.worker.pid, first.worker.pid);
        return h.parentBlocked(rows, first.worker) && h.parentBlocked(rows, second.worker);
      });
      h.distinctPids();
      itemGate.release(); hold.release(); successful(await hold.result, "controller");
      const results = [await first.result, await second.result];
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((result) => result.status === "rejected"); expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(RefundAmountExceededError);
      const payment = await snapshot(f.paymentId); assertRefundState(payment, new Map([[f.items[0], 40_000]]));
      const refunds = payment.items.flatMap((item) => item.refunds); expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ amount: 40_000, processedById: admins[results[0]!.status === "fulfilled" ? 0 : 1] });
      expect(payment.status).toBe("PARTIAL_REFUNDED"); expect(await ledger(f)).toEqual(before);
    });
  }, 45_000);

  it("different Payments: second refund commits while the first Payment remains locked", async () => {
    const firstPayment = await fixture(), secondPayment = await fixture();
    const beforeFirst = await ledger(firstPayment), beforeSecond = await ledger(secondPayment);
    await harness(async (h) => {
      const hold = await h.holdParent(firstPayment.paymentId);
      const first = h.start(0, firstPayment, firstPayment.items[0]);
      await h.waitParentBlocked(first.worker);
      const second = h.start(1, secondPayment, secondPayment.items[0]);
      await h.poll("independent Payment refund committed before controller release", async () => second.worker.outcome === "committed");
      successful(await second.result, "independent Payment refund");
      await h.waitParentBlocked(first.worker); // Controller STILL held; first has not committed.
      h.distinctPids();
      hold.release(); successful(await hold.result, "controller"); successful(await first.result, "blocked Payment refund");
      for (const f of [firstPayment, secondPayment]) {
        const payment = await snapshot(f.paymentId); assertRefundState(payment, new Map([[f.items[0], 40_000]]));
        expect(payment.items.flatMap((item) => item.refunds)).toHaveLength(1); expect(payment.status).toBe("PARTIAL_REFUNDED");
      }
      expect(await ledger(firstPayment)).toEqual(beforeFirst); expect(await ledger(secondPayment)).toEqual(beforeSecond);
    });
  }, 45_000);

  it("different items: concurrent partial/full refunds total 50000, then the remaining 30000 fully refunds the Payment", async () => {
    const f = await fixture(); const before = await ledger(f);
    assertRefundState(await snapshot(f.paymentId), new Map());
    await harness(async (h) => {
      const hold = await h.holdParent(f.paymentId);
      const first = h.start(0, f, f.items[0], undefined, 10_000);
      const second = h.start(1, f, f.items[1]);
      await h.poll("partial/full workers both blocked on the same parent", async () => {
        const rows = await h.observe();
        return [first.worker, second.worker].every((worker) => h.parentBlocked(rows, worker));
      });
      h.distinctPids();
      hold.release(); successful(await hold.result, "mixed controller");
      expect(successful(await first.result, "partial refund").refundedAmount).toBe(10_000);
      expect(successful(await second.result, "full refund").refundedAmount).toBe(40_000);
      const payment = await snapshot(f.paymentId);
      assertRefundState(payment, new Map([[f.items[0], 10_000], [f.items[1], 40_000]]));
      expect(payment.items.flatMap((item) => item.refunds)).toHaveLength(2);
      expect(payment.status).toBe("PARTIAL_REFUNDED");
      expect(await ledger(f)).toEqual(before);
    });
    await createRefundCore(db, refundInput(f, 30_000));
    const full = await snapshot(f.paymentId);
    assertRefundState(full, new Map(f.items.map((id) => [id, 40_000])));
    expect(full.items.flatMap((item) => item.refunds)).toHaveLength(3);
    expect(full.status).toBe("REFUNDED"); expect(await ledger(f)).toEqual(before);
  }, 45_000);

  it("same item: concurrent 10000 + 30000 succeeds exactly to cap; an extra 1 rolls back without any changes", async () => {
    const f = await fixture(); const beforeLedger = await ledger(f);
    await harness(async (h) => {
      const hold = await h.holdParent(f.paymentId); const itemGate = gate();
      const first = h.start(0, f, f.items[0], itemGate, 10_000);
      await h.poll("first partial owns item or waits for parent", async () =>
        first.worker.stage === "item-locked" || first.worker.stage === "parent-lock-wait");
      const second = h.start(1, f, f.items[0], undefined, 30_000);
      await h.poll("second partial demonstrably blocked", async () => {
        const rows = await h.observe(); const row = rows.find((candidate) => candidate.pid === second.worker.pid);
        if (!row || row.state !== "active" || row.waitEventType !== "Lock" || !row.waitingRowOrTransaction) return false;
        return first.worker.stage === "item-locked"
          ? row.statement === "item-lock" && h.reaches(rows, second.worker.pid, first.worker.pid)
          : h.parentBlocked(rows, first.worker) && h.parentBlocked(rows, second.worker);
      });
      h.distinctPids(); itemGate.release(); hold.release(); successful(await hold.result, "same-item partial controller");
      successful(await first.result, "10000 partial"); successful(await second.result, "30000 partial");
    });
    const before = await snapshot(f.paymentId);
    assertRefundState(before, new Map([[f.items[0], 40_000]]));
    expect(before.items.flatMap((item) => item.refunds).map((refund) => refund.amount).sort((a, b) => a - b)).toEqual([10_000, 30_000]);
    await harness(async (h) => {
      const attempt = h.start(0, f, f.items[0], undefined, 1);
      const result = await attempt.result;
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") throw new Error("EXPECTED_REFUND_CAP_REJECTION");
      expect(result.reason).toBeInstanceOf(RefundAmountExceededError);
      expect((result.reason as Error).message).toBe("");
      expect(attempt.worker.stage).toBe("item-locked");
      expect(attempt.worker.stages).not.toContain("refund-created");
      expect(attempt.worker.outcome).toBe("rolled-back");
    });
    const after = await snapshot(f.paymentId);
    expect(after).toEqual(before); // Includes every Refund, both item rows and parent updatedAt.
    assertRefundState(after, new Map([[f.items[0], 40_000]]));
    expect(await ledger(f)).toEqual(beforeLedger);
    await createRefundCore(db, refundInput(f, 40_000, 1));
    assertRefundState(await snapshot(f.paymentId), new Map(f.items.map((id) => [id, 40_000])));
    expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it.each(["refund-created", "item-updated", "parent-updated"] as const)("failure after actual %s rolls back all three models, including timestamps", async (stage) => {
    const f = await fixture();
    // Start with existing history so rollback also proves it preserves earlier successful writes.
    await createRefundCore(db, refundInput(f, 10_000));
    const before = await snapshot(f.paymentId), beforeLedger = await ledger(f), beforeRows = await financialRows(f);
    await harness(async (h) => {
      const attempt = h.start(0, f, f.items[0], undefined, 10_000, stage);
      const result = await attempt.result;
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") throw new Error("EXPECTED_INJECTED_REFUND_FAILURE");
      expect(result.reason).toEqual(new Error(`SYNTHETIC_REFUND_FAILURE:${stage}`));
      expect(attempt.worker.stage).toBe(stage); expect(attempt.worker.outcome).toBe("rolled-back");
      expect(attempt.worker.stages).toContain("refund-created");
    });
    const after = await snapshot(f.paymentId);
    expect(after).toEqual(before);
    assertRefundState(after, new Map([[f.items[0], 10_000]]));
    expect(await ledger(f)).toEqual(beforeLedger); expect(await financialRows(f)).toEqual(beforeRows);
    await createRefundCore(db, refundInput(f, 30_000));
    assertRefundState(await snapshot(f.paymentId), new Map([[f.items[0], 40_000]]));
    expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it("refunds preserve mappings, allocations and positive R/T; Revenue follows actual KST payment/refund dates and filters", async () => {
    const f = await fixture(true), beforeLedger = await ledger(f), beforeRows = await financialRows(f);
    // Move only synthetic timestamps across the KST midnight boundary; no production clock hook.
    await db.payment.update({ where: { id: f.paymentId }, data: { paidAt: new Date("2026-10-23T14:59:59Z") } });
    const partial = await createRefundCore(db, refundInput(f, 10_000));
    const full = await createRefundCore(db, refundInput(f, 40_000, 1));
    await db.refund.updateMany({ where: { id: { in: [partial.refundId, full.refundId] } }, data: { refundedAt: new Date("2026-10-23T15:00:00Z") } });
    const partialPayment = await snapshot(f.paymentId);
    assertRefundState(partialPayment, new Map([[f.items[0], 10_000], [f.items[1], 40_000]]));
    expect(await ledger(f)).toEqual(beforeLedger); expect(await financialRows(f)).toEqual(beforeRows);
    const classIds = (await db.paymentItem.findMany({ where: { paymentId: f.paymentId }, select: { reservation: { select: { classScheduleId: true } } } })).map((item) => item.reservation.classScheduleId);
    async function report(dateFrom: string, dateTo: string, filters: Partial<RevenueQueryFilters> = {}) {
      const query = { ...resolveRevenuePeriod(dateFrom, dateTo), programId: run, ...filters };
      // Scope financial facts to this fixture, without including other cases of this suite.
      const payments = (await db.$queryRaw<PaymentFact[]>(buildPaymentFactsQuery(query))).filter((row) => classIds.includes(row.classScheduleId));
      const refunds = (await db.$queryRaw<RefundFact[]>(buildRefundFactsQuery(query))).filter((row) => classIds.includes(row.classScheduleId));
      return mergeRevenueFacts({ operations: [], payments, refunds }).summary;
    }
    expect(await report("2026-10-23", "2026-10-24")).toMatchObject({ paidAmount: 80_000, refundedAmount: 50_000, netRevenue: 30_000 });
    expect(await report("2026-10-23", "2026-10-23")).toMatchObject({ paidAmount: 80_000, refundedAmount: 0 });
    expect(await report("2026-10-24", "2026-10-24")).toMatchObject({ paidAmount: 0, refundedAmount: 50_000 });
    expect(await report("2026-10-23", "2026-10-24", { refundState: "PARTIAL", paymentMethod: "TRANSFER" })).toMatchObject({ paidAmount: 40_000, refundedAmount: 10_000 });
    expect(await report("2026-10-23", "2026-10-24", { refundState: "FULL" })).toMatchObject({ paidAmount: 40_000, refundedAmount: 40_000 });
    expect(await report("2026-10-23", "2026-10-24", { refundState: "NONE" })).toMatchObject({ paidAmount: 0, refundedAmount: 0 });
    expect(await report("2026-10-23", "2026-10-24", { paymentMethod: "CARD" })).toMatchObject({ paidAmount: 0, refundedAmount: 0 });
    const remaining = await createRefundCore(db, refundInput(f, 30_000));
    await db.refund.update({ where: { id: remaining.refundId }, data: { refundedAt: new Date("2026-10-23T15:00:00Z") } });
    assertRefundState(await snapshot(f.paymentId), new Map(f.items.map((id) => [id, 40_000])));
    expect(await report("2026-10-23", "2026-10-24")).toMatchObject({ paidAmount: 80_000, refundedAmount: 80_000, netRevenue: 0 });
    expect(await ledger(f)).toEqual(beforeLedger); expect(await financialRows(f)).toEqual(beforeRows);
  }, 45_000);

  it.each([
    { status: "RESERVED", attendance: null, needsDetail: false },
    { status: "COMPLETED", attendance: "PRESENT", needsDetail: false },
    { status: "CANCELLED", attendance: null, needsDetail: false },
    { status: "NO_SHOW", attendance: "ABSENT", needsDetail: true },
    { status: "CANCELLED", attendance: "ABSENT", needsDetail: true },
  ] as const)("refund policy preserves $status/$attendance and existing detail requirements", async ({ status, attendance, needsDetail }) => {
    const f = await fixture(); const beforeLedger = await ledger(f);
    const item = await db.paymentItem.findUniqueOrThrow({ where: { id: f.items[0] } });
    const reservation = await db.reservation.update({ where: { id: item.reservationId }, data: { status, attendance } });
    const before = await snapshot(f.paymentId);
    if (needsDetail) {
      await expect(createRefundCore(db, { ...refundInput(f, 10_000), reasonDetail: "   " })).rejects.toBeInstanceOf(NoShowRefundDetailRequiredError);
      expect(await snapshot(f.paymentId)).toEqual(before);
      assertRefundState(await snapshot(f.paymentId), new Map());
      expect(await ledger(f)).toEqual(beforeLedger);
    }
    await createRefundCore(db, { ...refundInput(f, 10_000), reasonDetail: needsDetail ? "  합성 예외 사유  " : undefined });
    const after = await snapshot(f.paymentId);
    assertRefundState(after, new Map([[f.items[0], 10_000]]));
    expect(after.items.find((candidate) => candidate.id === item.id)!.refunds[0]!.reasonDetail).toBe(needsDetail ? "합성 예외 사유" : null);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).toEqual(reservation);
    expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it.each([0, -1, 40_001])("rejects invalid amount %s with unchanged Refund/PaymentItem/Payment", async (amount) => {
    const f = await fixture(), before = await snapshot(f.paymentId), beforeLedger = await ledger(f);
    await expect(createRefundCore(db, refundInput(f, amount))).rejects.toBeInstanceOf(RefundAmountExceededError);
    const after = await snapshot(f.paymentId); expect(after).toEqual(before);
    assertRefundState(after, new Map()); expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it("missing item retains PaymentItemNotFoundError without changes to an existing Payment", async () => {
    const f = await fixture(), before = await snapshot(f.paymentId), beforeLedger = await ledger(f);
    await expect(createRefundCore(db, { ...refundInput(f, 1), paymentItemId: `${run}-missing` })).rejects.toBeInstanceOf(PaymentItemNotFoundError);
    const after = await snapshot(f.paymentId); expect(after).toEqual(before);
    assertRefundState(after, new Map()); expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it("ADMIN action binds processedById to the authenticated principal despite a forged form field", async () => {
    const f = await fixture(), beforeLedger = await ledger(f);
    const form = new FormData();
    for (const [key, value] of Object.entries({ paymentItemId: f.items[0], amount: "10000", reason: "PERSONAL", processedById: admins[0] })) form.set(key, value);
    context.actor = admins[1];
    try { await expect(createRefund({}, form)).rejects.toThrow("SYNTHETIC_REFUND_REDIRECT"); }
    finally { context.actor = admins[0]; }
    const payment = await snapshot(f.paymentId);
    assertRefundState(payment, new Map([[f.items[0], 10_000]]));
    expect(payment.items.flatMap((item) => item.refunds)).toHaveLength(1);
    expect(payment.items.flatMap((item) => item.refunds)[0]).toMatchObject({ amount: 10_000, processedById: admins[1] });
    expect(await ledger(f)).toEqual(beforeLedger);
  }, 45_000);

  it("real ADMIN guard and Zod reject non-ADMIN/unauthenticated/invalid requests without writes or unrelated personal data in diagnostics", async () => {
    const f = await fixture(), unrelated = await fixture();
    const sentinel = `${unrelated.submissionId}-PRIVATE_GUARDIAN_SENTINEL`;
    await db.reservationApplicationSubmission.update({ where: { id: unrelated.submissionId }, data: { guardianName: sentinel } });
    const before = await snapshot(f.paymentId), beforeOther = await snapshot(unrelated.paymentId);
    const beforeLedger = await ledger(f), beforeOtherLedger = await ledger(unrelated);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const diagnostics: unknown[] = [];
    function form(amount = "10000", reason = "PERSONAL") {
      const values = new FormData(); values.set("paymentItemId", f.items[0]); values.set("amount", amount); values.set("reason", reason); return values;
    }
    try {
      // Session identity is stubbed; real resolveSessionPrincipal reads these DB roles.
      for (const actor of [managerId, teacherUserId]) {
        context.actor = actor;
        const rejection = await settled(createRefund({}, form()));
        expect(rejection.status).toBe("rejected");
        if (rejection.status !== "rejected") throw new Error("EXPECTED_ADMIN_GUARD_REJECTION");
        expect(rejection.reason).toEqual(new Error("SYNTHETIC_FORBIDDEN"));
        diagnostics.push((rejection.reason as Error).message);
      }
      context.authenticated = false;
      await expect(createRefund({}, form())).rejects.toThrow("SYNTHETIC_LOGIN");
      context.authenticated = true; context.actor = admins[0];
      for (const [amount, reason] of [["0", "PERSONAL"], ["-1", "PERSONAL"], ["1.5", "PERSONAL"], ["bad", "PERSONAL"], ["10000", "INVALID_REASON"]]) {
        const result = await createRefund({}, form(amount, reason)); expect(result.errors).toBeDefined(); diagnostics.push(result);
      }
      const overCap = await createRefund({}, form("40001"));
      expect(overCap.formError).toBe("환불금액이 남은 환불 가능 금액을 초과합니다."); diagnostics.push(overCap);
      expect(JSON.stringify([...diagnostics, info.mock.calls, error.mock.calls])).not.toContain(sentinel);
      expect(error).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled();
    } finally {
      context.authenticated = true; context.actor = admins[0]; info.mockRestore(); error.mockRestore();
    }
    const after = await snapshot(f.paymentId), afterOther = await snapshot(unrelated.paymentId);
    expect(after).toEqual(before); expect(afterOther).toEqual(beforeOther);
    assertRefundState(after, new Map()); assertRefundState(afterOther, new Map());
    expect(await ledger(f)).toEqual(beforeLedger); expect(await ledger(unrelated)).toEqual(beforeOtherLedger);
  }, 45_000);
});
