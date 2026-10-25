/**
 * C11 residual-risk cells. Real isolated PostgreSQL 16 evidence only; CI executes this file.
 * No browser claims: dropping an ADMIN action response models only the PG client response.
 * A bounded polling deadline is a test failure, never a normal financial rejection.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, actor: "" }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: async () => ({ role: "ADMIN", userId: context.actor }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("UNEXPECTED_REDIRECT"); } }));
import {
  confirmApplicationSubmission, lookupWorkflowReceipt, recordApplicationDeposit, recordApplicationReturn,
  resolveApplicationWorkflow, type WorkflowActionResult,
} from "@/app/(admin)/reservation-applications/actions";
import { createRefundCore } from "@/lib/payments/core";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import {
  recordApplicationDepositCore, SuspectedDuplicateApplicationDepositError,
  InsufficientApplicationDepositError,
} from "@/server/reservation-applications/finance";
// Same fail-closed admission as the existing integration suites, before constructing ANY client.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
context.db = db;
const actualDate = "2026-01-01T09:30";
const consent = {
  programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true,
  refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false,
  consentVersion: APPLICATION_CONSENT_CONTENT.version,
};
type Fixture = {
  id: string; admin: string; classes: [string, string]; apps: [string, string];
  guardianName: string; legacyId: string; observedPaymentIds: string[];
};
type TransactionOptions = { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
function deposit(amount = 100_000, key = crypto.randomUUID()) {
  return form({ amount: String(amount), payerName: "합성 실제 입금자", depositedAt: actualDate, idempotencyKey: key });
}
function transfer(amount: number, observedReturnedAmount = 0, key = crypto.randomUUID(), observedAmount = 60_000) {
  return form({ amount: String(amount), reason: "합성 실제 반환", returnedAt: actualDate, idempotencyKey: key,
    observedAmount: String(observedAmount), observedReturnedAmount: String(observedReturnedAmount) });
}
async function runtime(client: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const [row] = await client.$queryRaw<Array<{ pid: number; version: number; database: string; username: string; isolation: string }>>`
    SELECT pg_backend_pid() AS pid, current_setting('server_version_num')::int AS version,
      current_database()::text AS database, current_user::text AS username,
      current_setting('transaction_isolation')::text AS isolation
  `;
  if (!row || row.version < 160000 || row.version >= 170000 || row.database !== "yaho_e2e" ||
      row.username !== "yaho_e2e" || row.isolation !== "read committed") {
    throw new Error("C11_REQUIRES_ISOLATED_POSTGRESQL_16_READ_COMMITTED");
  }
  return row.pid;
}

async function cleanup(f: Fixture) {
  context.db = db;
  const paymentIds = [...f.observedPaymentIds, ...(await db.paymentItem.findMany({
    where: { reservation: { classScheduleId: { in: f.classes } } }, select: { paymentId: true },
  })).map((row) => row.paymentId)];
  const childIds = (await db.child.findMany({ where: { guardianName: f.guardianName }, select: { id: true } })).map((row) => row.id);
  await db.fundAllocation.deleteMany({ where: { deposit: { submissionId: f.id } } });
  await db.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: f.id } } });
  await db.returnObligation.deleteMany({ where: { submissionId: f.id } });
  await db.applicationDeposit.deleteMany({ where: { submissionId: f.id } });
  await db.reservationApplicationPaymentMapping.deleteMany({ where: { applicationId: { in: [...f.apps, f.legacyId] } } });
  await db.childConsent.deleteMany({ where: { OR: [
    { reservationApplicationId: { in: [...f.apps, f.legacyId] } }, { childId: { in: childIds } },
  ] } });
  await db.reservationApplication.deleteMany({ where: { id: { in: [...f.apps, f.legacyId] } } });
  // Only Refund rows attached to this cell's synthetic Payment/items are owned here.
  await db.refund.deleteMany({ where: { paymentItem: { paymentId: { in: paymentIds } } } });
  await db.paymentItem.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await db.reservation.deleteMany({ where: { classScheduleId: { in: f.classes } } });
  await db.reservationApplicationSubmission.deleteMany({ where: { id: f.id } });
  await db.child.deleteMany({ where: { id: { in: childIds } } });
  await db.classSchedule.deleteMany({ where: { id: { in: f.classes } } });
  await db.program.deleteMany({ where: { id: f.id } });
  await db.user.deleteMany({ where: { id: f.admin } });
}

/** Every cell (including parameterized cells) owns a fresh fixture and a finally cleanup. */
async function withFixture(body: (f: Fixture) => Promise<void>) {
  const id = `c11-residual-${crypto.randomUUID()}`;
  const f: Fixture = { id, admin: `${id}-admin`, classes: [`${id}-c0`, `${id}-c1`],
    apps: [`${id}-a0`, `${id}-a1`], guardianName: `${id}-합성 보호자`, legacyId: `${id}-legacy`, observedPaymentIds: [] };
  context.db = db; context.actor = f.admin;
  try {
    await db.user.create({ data: { id: f.admin, email: `${f.admin}@example.test`, name: "합성 관리자", role: "ADMIN" } });
    await db.program.create({ data: { id, name: "합성 C11 프로그램", defaultPrice: 999_999 } });
    await db.classSchedule.createMany({ data: f.classes.map((classId, index) => ({ id: classId, programId: id,
      startsAt: new Date("2040-01-01T00:00:00Z"), endsAt: new Date("2040-01-01T01:00:00Z"),
      location: "합성 장소", capacity: 8, applicationPrice: index === 0 ? 40_000 : 60_000 })) });
    await db.reservationApplicationSubmission.create({ data: { id, guardianName: f.guardianName,
      guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 신고명" } });
    await db.reservationApplication.createMany({ data: f.classes.map((classScheduleId, index) => ({ ...consent,
      id: f.apps[index]!, submissionId: id, classScheduleId, quotedAmount: index === 0 ? 40_000 : 60_000,
      childName: `${id}-합성 아이${index}`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED" })) });
    await body(f);
  } finally { await cleanup(f); }
}
function cell(name: string, body: (f: Fixture) => Promise<void>) { it(name, () => withFixture(body), 60_000); }

/** Independent oracle over stored sources, allocations, counters and actual link targets. */
async function ledger(f: Fixture, expectedRefunds = 0) {
  const detail = (await getApplicationWorkflowDetail(f.id))!;
  expect(detail).not.toBeNull();
  expect(detail.ledger.state).toBe("available");
  if (detail.ledger.state !== "available") throw new Error("C11_LEDGER_UNAVAILABLE");
  const allocations = detail.deposits.flatMap((row) => row.allocations);
  const sum = (rows: ReadonlyArray<{ amount: number }>) => rows.reduce((total, row) => total + row.amount, 0);
  const D = sum(detail.deposits);
  const P = sum(allocations.filter((row) => row.paymentMappingId));
  const funded = sum(allocations.filter((row) => row.returnObligationId));
  const T = detail.returnObligations.reduce((total, row) => total + row.returnedAmount, 0);
  const R = funded - T, A = D - P - funded;
  expect(detail.ledger).toMatchObject({ D, A, P, R, T });
  expect(D).toBe(A + P + R + T);
  for (const amount of [A, P, R, T]) expect(amount).toBeGreaterThanOrEqual(0);
  for (const row of detail.deposits) expect(sum(row.allocations)).toBeLessThanOrEqual(row.amount);
  for (const row of allocations) {
    expect(row.amount).toBeGreaterThan(0);
    expect(Number(Boolean(row.paymentMappingId)) + Number(Boolean(row.returnObligationId))).toBe(1);
    if (row.paymentMappingId) expect(detail.applications.some((app) => app.paymentMapping?.id === row.paymentMappingId)).toBe(true);
    if (row.returnObligationId) expect(detail.returnObligations.some((obligation) => obligation.id === row.returnObligationId)).toBe(true);
  }
  for (const obligation of detail.returnObligations) {
    expect(sum(obligation.returns)).toBe(obligation.returnedAmount);
    expect(sum(allocations.filter((row) => row.returnObligationId === obligation.id))).toBe(obligation.amount);
    expect(obligation.returnedAmount).toBeLessThanOrEqual(obligation.amount);
    if (obligation.returnedAmount === obligation.amount) expect(obligation.resolvedAt).not.toBeNull();
    else expect(obligation.resolvedAt).toBeNull();
  }
  for (const app of detail.applications) {
    if (app.status !== "CONFIRMED") { expect(app.paymentMapping).toBeNull(); continue; }
    expect(app.reservation).not.toBeNull(); expect(app.paymentMapping).not.toBeNull();
    expect(app.reservation!.paymentItem).toMatchObject({ id: app.paymentMapping!.paymentItem.id,
      paymentId: app.paymentMapping!.paymentItem.paymentId });
    expect(app.paymentMapping!.paymentItem.paidAmount).toBe(app.quotedAmount);
    expect(sum(allocations.filter((row) => row.paymentMappingId === app.paymentMapping!.id))).toBe(app.quotedAmount);
  }
  expect(await db.refund.count({ where: { paymentItem: { reservation: { classScheduleId: { in: f.classes } } } } })).toBe(expectedRefunds);
  return detail.ledger;
}
async function noConfirmation(f: Fixture) {
  expect(await db.reservation.count({ where: { classScheduleId: { in: f.classes } } })).toBe(0);
  expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: f.classes } } } } } })).toBe(0);
  expect(await db.paymentItem.count({ where: { reservation: { classScheduleId: { in: f.classes } } } })).toBe(0);
  expect(await db.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: f.id } } })).toBe(0);
}
async function rejectSibling(f: Fixture) {
  expect((await resolveApplicationWorkflow(f.apps[1], "REJECTED", form({ resolutionNote: "합성 C11 반려" }))).status).toBe("success");
}
async function fundedReturn(f: Fixture) {
  expect((await recordApplicationDeposit(f.id, deposit())).status).toBe("success");
  await rejectSibling(f);
  const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: f.apps[1] } });
  expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, P: 0, R: 60_000, T: 0 });
  return obligation;
}
async function snapshot(f: Fixture) {
  return db.$transaction(async (tx) => ({
    submission: await tx.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: f.id } }),
    applications: await tx.reservationApplication.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } }),
    deposits: await tx.applicationDeposit.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } }),
    allocations: await tx.fundAllocation.findMany({ where: { deposit: { submissionId: f.id } }, orderBy: { id: "asc" } }),
    obligations: await tx.returnObligation.findMany({ where: { submissionId: f.id }, orderBy: { id: "asc" } }),
    returns: await tx.applicationReturn.findMany({ where: { returnObligation: { submissionId: f.id } }, orderBy: { id: "asc" } }),
    mappings: await tx.reservationApplicationPaymentMapping.findMany({ where: { application: { submissionId: f.id } }, orderBy: { id: "asc" } }),
    reservations: await tx.reservation.findMany({ where: { classScheduleId: { in: f.classes } }, orderBy: { id: "asc" } }),
    items: await tx.paymentItem.findMany({ where: { reservation: { classScheduleId: { in: f.classes } } }, orderBy: { id: "asc" } }),
    payments: await tx.payment.findMany({ where: { OR: [{ id: { in: f.observedPaymentIds } },
      { items: { some: { reservation: { classScheduleId: { in: f.classes } } } } }] }, orderBy: { id: "asc" } }),
    children: await tx.child.findMany({ where: { guardianName: f.guardianName }, orderBy: { id: "asc" } }),
    consents: await tx.childConsent.findMany({ where: { reservationApplicationId: { in: f.apps } }, orderBy: { id: "asc" } }),
    refunds: await tx.refund.findMany({ where: { paymentItem: { reservation: { classScheduleId: { in: f.classes } } } }, orderBy: { id: "asc" } }),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function dedicatedClient() {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}
function settled<T>(task: Promise<T>): Promise<PromiseSettledResult<T>> {
  return task.then((value) => ({ status: "fulfilled", value }), (reason: unknown) => ({ status: "rejected", reason }));
}
function fulfilled<T>(result: PromiseSettledResult<T>): T {
  expect(result.status).toBe("fulfilled");
  if (result.status !== "fulfilled") throw new Error("C11_REQUEST_DID_NOT_SETTLE_NORMALLY");
  return result.value;
}
async function poll(observer: PrismaClient, check: () => Promise<boolean>) {
  const deadline = Date.now() + 8_000; // Failure bound only, not interleaving evidence.
  while (Date.now() < deadline) {
    if (await check()) return;
    await observer.$queryRaw`SELECT 1`;
  }
  throw new Error("C11_REQUIRED_DATABASE_BARRIER_NOT_OBSERVED");
}

/** The exact blocked row statement, independent sessions and ungranted PG lock are mandatory. */
async function waitOnRow(observer: PrismaClient, workerPid: number, holderPid: number,
  table: "ReturnObligation" | "ReservationApplicationSubmission") {
  const observerPid = await runtime(observer);
  expect(new Set([observerPid, workerPid, holderPid]).size).toBe(3);
  await poll(observer, async () => {
    const rows = await observer.$queryRaw<Array<{ pid: number; active: boolean; lockWait: boolean;
      blockedByHolder: boolean; waiting: boolean; expectedStatement: boolean }>>`
      SELECT a.pid, (a.state = 'active') AS active, (a.wait_event_type = 'Lock') AS "lockWait",
        (${holderPid} = ANY(pg_blocking_pids(a.pid))) AS "blockedByHolder",
        EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted
          AND l.locktype IN ('transactionid', 'tuple')) AS waiting,
        (strpos(a.query, ${'"' + table + '"'}) > 0 AND a.query ~ 'FOR[[:space:]]+UPDATE') AS "expectedStatement"
      FROM pg_stat_activity a WHERE a.pid = ${workerPid}
    `;
    return rows.length === 1 && rows.every((row) => row.active && row.lockWait && row.blockedByHolder && row.waiting && row.expectedStatement);
  });
}
function routeWriteTransactions(route: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions) => Promise<T>) {
  context.db = new Proxy(db, { get(target, property) {
    if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions) => {
      // Real read snapshots intentionally use RepeatableRead and are NOT write-tx evidence.
      if (options?.isolationLevel === Prisma.TransactionIsolationLevel.RepeatableRead) return target.$transaction(callback, options);
      return route(callback, options);
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

/** Hold a real row, start the real ADMIN action and prove its backend is blocked before disconnect. */
async function precommitHold(f: Fixture, table: "ReturnObligation" | "ReservationApplicationSubmission", rowId: string,
  action: () => Promise<WorkflowActionResult>, whileBlocked: () => Promise<void>, rollback: boolean) {
  const holder = dedicatedClient(), worker = dedicatedClient(), observer = dedicatedClient();
  const release = gate();
  const tasks: Array<Promise<PromiseSettledResult<unknown>>> = [];
  let holderPid = 0, workerPid = 0, held = false, calls = 0;
  try {
    const holderTask = settled(holder.$transaction(async (tx) => {
      holderPid = await runtime(tx);
      const rows = table === "ReturnObligation"
        ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ReturnObligation" WHERE "id" = ${rowId} FOR UPDATE`
        : await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${rowId} FOR UPDATE`;
      expect(rows).toEqual([{ id: rowId }]); held = true;
      await release.promise;
    }, { maxWait: 10_000, timeout: 30_000 }));
    tasks.push(holderTask);
    await poll(observer, async () => held);
    routeWriteTransactions((callback, options) => {
      calls++;
      return worker.$transaction(async (tx) => { workerPid = await runtime(tx); return callback(tx); }, options);
    });
    // Retain only for drain: the simulated client drops the response BEFORE the hold is released.
    const droppedResponse = settled(action());
    tasks.push(droppedResponse);
    await poll(observer, async () => workerPid > 0);
    await waitOnRow(observer, workerPid, holderPid, table);
    await whileBlocked();
    if (rollback) {
      const [termination] = await observer.$queryRaw<Array<{ terminated: boolean }>>`SELECT pg_terminate_backend(${workerPid}) AS terminated`;
      expect(termination?.terminated).toBe(true);
      // Resolve the original action before releasing the test holder. No absence lookup is used
      // as rollback evidence: caller must compare a fresh full snapshot after this drain.
      fulfilled(await droppedResponse);
    }
    release.release();
    fulfilled(await holderTask);
    fulfilled(await droppedResponse);
    expect(calls).toBe(1);
  } finally {
    release.release();
    await Promise.allSettled(tasks);
    context.db = db;
    await Promise.allSettled([holder.$disconnect(), worker.$disconnect(), observer.$disconnect()]);
  }
  expect(context.actor).toBe(f.admin);
}
async function financeShape(f: Fixture) {
  const state = await snapshot(f);
  await noConfirmation(f);
  return {
    ledger: await ledger(f),
    deposits: state.deposits.map((row) => ({ amount: row.amount, payerName: row.payerName, depositedAt: row.depositedAt })),
    obligations: state.obligations.map((row) => ({ kind: row.kind, amount: row.amount, returnedAmount: row.returnedAmount, resolved: Boolean(row.resolvedAt) })),
    allocations: state.allocations.map((row) => ({ amount: row.amount, payment: Boolean(row.paymentMappingId), obligation: Boolean(row.returnObligationId) })),
    returns: state.returns.map((row) => ({ amount: row.amount, returnedAt: row.returnedAt })),
  };
}
async function singleSuccessOracle() {
  let oracle: Awaited<ReturnType<typeof financeShape>> | undefined;
  await withFixture(async (f) => {
    await rejectSibling(f);
    expect((await recordApplicationDeposit(f.id, deposit())).status).toBe("success");
    oracle = await financeShape(f);
  });
  if (!oracle) throw new Error("C11_SINGLE_SUCCESS_ORACLE_MISSING");
  return oracle;
}

beforeAll(async () => { await runtime(db); }, 30_000);
afterAll(async () => { await db.$disconnect(); }, 30_000);

describe.sequential("C11 residual risk / deterministic PG16 evidence", () => {
  for (const rollback of [false, true]) {
    cell(`S2-precommit / ${rollback ? "rollback-after-disconnect" : "commit-after-disconnect"} / independent snapshot and receipt`, async (f) => {
      const obligation = await fundedReturn(f), key = crypto.randomUUID();
      const before = await snapshot(f);
      await precommitHold(f, "ReturnObligation", obligation.id,
        () => recordApplicationReturn(obligation.id, transfer(20_000, 0, key)), async () => {
          expect(await snapshot(f)).toEqual(before); // Uncommitted state is explicitly NOT rollback proof.
        }, rollback);
      const fresh = await snapshot(f);
      if (rollback) {
        expect(fresh).toEqual(before);
        expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 60_000, T: 0 });
        // A new partial return is genuinely distinct: amount AND actual date differ.
        const next = transfer(10_000);
        next.set("returnedAt", "2026-01-02T09:30");
        expect((await recordApplicationReturn(obligation.id, next)).status).toBe("success");
        const after = await snapshot(f);
        expect(after.returns).toHaveLength(1);
        expect(after.returns[0]).toMatchObject({ amount: 10_000, returnedAt: new Date("2026-01-02T00:30:00.000Z") });
        expect(await ledger(f)).toMatchObject({ R: 50_000, T: 10_000 });
      } else {
        expect(fresh.returns).toHaveLength(1);
        expect(fresh.returns[0]).toMatchObject({ returnObligationId: obligation.id, amount: 20_000, idempotencyKey: key });
        expect(fresh.obligations).toEqual([expect.objectContaining({ id: obligation.id, amount: 60_000, returnedAmount: 20_000, resolvedAt: null })]);
        const detail = (await getApplicationWorkflowDetail(f.id))!;
        expect(detail.returnObligations[0]!.returns.map((row) => row.id)).toEqual([fresh.returns[0]!.id]);
        expect(await lookupWorkflowReceipt("return", obligation.id, key)).toMatchObject({ status: "success", receiptId: fresh.returns[0]!.id });
        expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 40_000, T: 20_000 });
        expect(fresh.deposits).toEqual(before.deposits);
        expect(fresh.allocations).toEqual(before.allocations);
        await noConfirmation(f);
      }
    });

    cell(`S5B / uncommitted absence then ${rollback ? "terminated rollback" : "commit"} / LIMIT: absence cannot identify request outcome`, async (f) => {
      const before = await snapshot(f), key = crypto.randomUUID();
      await precommitHold(f, "ReservationApplicationSubmission", f.id,
        () => recordApplicationDeposit(f.id, deposit(100_000, key)), async () => {
          const lookup = await lookupWorkflowReceipt("deposit", f.id, key);
          expect(lookup).toMatchObject({ status: "failure", code: "not-found" });
          expect(lookup.receiptId).toBeUndefined();
          expect(lookup.error).not.toMatch(/저장.{0,3}실패|롤백|rollback|save.failed/i);
          expect(await snapshot(f)).toEqual(before);
        }, rollback);
      const fresh = await snapshot(f);
      if (rollback) {
        // Original backend termination + drained request + complete new snapshot establish rollback.
        expect(fresh).toEqual(before);
        expect(await lookupWorkflowReceipt("deposit", f.id, key)).toMatchObject({ status: "failure", code: "not-found" });
        expect(await ledger(f)).toMatchObject({ D: 0, A: 0, P: 0, R: 0, T: 0 });
      } else {
        expect(fresh.deposits).toHaveLength(1);
        expect(await lookupWorkflowReceipt("deposit", f.id, key)).toMatchObject({ status: "success", receiptId: fresh.deposits[0]!.id });
        expect(await ledger(f)).toMatchObject({ D: 100_000, A: 100_000, P: 0, R: 0, T: 0 });
      }
      await noConfirmation(f);
    });
  }

  async function priorWriteRace(f: Fixture, rollback: boolean, first: "A" | "B") {
    const oracle = await singleSuccessOracle();
    context.actor = f.admin;
    await rejectSibling(f);
    const before = await snapshot(f);
    const clientsByLabel = { A: dedicatedClient(), B: dedicatedClient() };
    const second = first === "A" ? "B" : "A";
    const requestOrder = [first, second] as const;
    const clients = requestOrder.map((label) => clientsByLabel[label]), observer = dedicatedClient();
    const releaseFirst = gate(), releaseCandidate = gate();
    const pids = [0, 0];
    const tasks: Array<Promise<PromiseSettledResult<unknown>>> = [];
    let calls = 0, firstHeld = false, candidateHeld = false;
    let candidateIds: string[] = [], stagedDepositIds: string[] = [], stagedObligationIds: string[] = [], stagedAllocationIds: string[] = [];
    let candidateSelects = 0;
    try {
      routeWriteTransactions((callback, options) => {
        const index = calls++, client = clients[index];
        if (!client) throw new Error("C11_UNEXPECTED_WRITE_TRANSACTION");
        return client.$transaction(async (tx) => {
          pids[index] = await runtime(tx); // The ACTUAL write transaction must be READ COMMITTED.
          if (index === 0) {
            const value = await callback(tx); // Real Deposit, obligation and allocation writes complete.
            stagedDepositIds = (await tx.applicationDeposit.findMany({ where: { submissionId: f.id }, select: { id: true } })).map((row) => row.id);
            stagedObligationIds = (await tx.returnObligation.findMany({ where: { submissionId: f.id }, select: { id: true } })).map((row) => row.id);
            stagedAllocationIds = (await tx.fundAllocation.findMany({ where: { deposit: { submissionId: f.id } }, select: { id: true } })).map((row) => row.id);
            expect(stagedDepositIds).toHaveLength(1);
            expect(stagedObligationIds).toHaveLength(1);
            expect(stagedAllocationIds).toHaveLength(1);
            firstHeld = true;
            await releaseFirst.promise;
            if (rollback) throw new Error("SYNTHETIC_C11_ROLLBACK_AFTER_REAL_DEPOSIT_ALLOCATION_WRITES");
            return value;
          }
          return callback(new Proxy(tx, { get(transaction, key) {
            if (key === "applicationDeposit") return new Proxy(transaction.applicationDeposit, { get(delegate, method) {
              if (method === "findMany") return async (args: Prisma.ApplicationDepositFindManyArgs) => {
                const rows = await delegate.findMany(args);
                if (args.where?.amount !== undefined && args.where?.payerName !== undefined && args.where?.depositedAt !== undefined) {
                  candidateSelects++;
                  candidateIds = rows.map((row) => row.id);
                  candidateHeld = true;
                  await releaseCandidate.promise; // Independent snapshot before B can throw/create.
                }
                return rows;
              };
              const value: unknown = Reflect.get(delegate, method);
              return typeof value === "function" ? value.bind(delegate) : value;
            } });
            const value: unknown = Reflect.get(transaction, key);
            return typeof value === "function" ? value.bind(transaction) : value;
          } }));
        }, options);
      });
      const keys = { A: crypto.randomUUID(), B: crypto.randomUUID() };
      const firstKey = keys[first], secondKey = keys[second];
      expect(firstKey).not.toBe(secondKey);
      expect(clients[0]).toBe(clientsByLabel[first]);
      expect(clients[1]).toBe(clientsByLabel[second]);
      const original = settled(recordApplicationDeposit(f.id, deposit(100_000, firstKey)));
      tasks.push(original);
      await poll(observer, async () => firstHeld);
      expect(await snapshot(f)).toEqual(before); // A/B-labelled first request is STILL uncommitted.
      const follower = settled(recordApplicationDeposit(f.id, deposit(100_000, secondKey)));
      tasks.push(follower);
      await poll(observer, async () => pids[1]! > 0);
      await waitOnRow(observer, pids[1]!, pids[0]!, "ReservationApplicationSubmission");
      expect(candidateSelects).toBe(0); // B cannot perform the guard read before getting Submission.
      releaseFirst.release();
      const originalResult = fulfilled(await original);
      await poll(observer, async () => candidateHeld);
      expect(candidateSelects).toBe(1);
      if (rollback) {
        expect(originalResult.status).toBe("result-unknown");
        expect(candidateIds).toEqual([]);
        // The independent snapshot is taken AFTER A's real rollback and BEFORE any B writes.
        expect(await snapshot(f)).toEqual(before);
        expect(await db.applicationDeposit.count({ where: { id: { in: stagedDepositIds } } })).toBe(0);
        expect(await db.returnObligation.count({ where: { id: { in: stagedObligationIds } } })).toBe(0);
        expect(await db.fundAllocation.count({ where: { id: { in: stagedAllocationIds } } })).toBe(0);
      } else {
        expect(originalResult).toMatchObject({ status: "success", receiptId: stagedDepositIds[0] });
        expect(candidateIds).toEqual(stagedDepositIds);
        expect(await financeShape(f)).toEqual(oracle);
      }
      const beforeFollower = await snapshot(f);
      releaseCandidate.release();
      const followerResult = fulfilled(await follower);
      if (rollback) {
        expect(followerResult.status).toBe("success");
        expect(followerResult.receiptId).toBeDefined();
        expect(stagedDepositIds).not.toContain(followerResult.receiptId);
        expect((await snapshot(f)).deposits).toEqual([expect.objectContaining({ id: followerResult.receiptId, idempotencyKey: secondKey })]);
      } else {
        expect([originalResult.status, followerResult.status].sort()).toEqual(["failure", "success"]);
        expect(followerResult).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit" });
        expect(followerResult.receiptId).toBeUndefined();
        expect(followerResult.error).toContain(stagedDepositIds[0]);
        expect(await snapshot(f)).toEqual(beforeFollower);
      }
      expect(await financeShape(f)).toEqual(oracle);
      expect(calls).toBe(2);
      expect(requestOrder).toEqual(first === "A" ? ["A", "B"] : ["B", "A"]);
      expect(new Set(pids).size).toBe(2);
    } finally {
      releaseFirst.release(); releaseCandidate.release();
      await Promise.allSettled(tasks);
      context.db = db;
      await Promise.allSettled([...clients.map((client) => client.$disconnect()), observer.$disconnect()]);
    }
  }

  for (const first of ["A", "B"] as const) {
    cell(`T02 / ${first}-first / actual uncommitted prior writes -> lock wait -> fresh candidate SELECT -> explicit rejection`,
      (f) => priorWriteRace(f, false, first));
  }
  cell("T03 / real Deposit+obligation+allocation rollback while B waits -> zero A residue -> B-single-success oracle",
    (f) => priorWriteRace(f, true, "A"));

  const timestamp = new Date("2026-01-01T00:30:00.123Z");
  async function seedDeposit(f: Fixture, payerName: string | null, options: {
    amount?: number; depositedAt?: Date; idempotencyKey?: string | null;
  } = {}) {
    return db.applicationDeposit.create({ data: {
      submissionId: f.id, amount: options.amount ?? 20_000, payerName,
      depositedAt: options.depositedAt ?? new Date("2026-01-01T00:30:00.000Z"),
      confirmedAt: new Date("2026-01-02T00:00:00Z"), confirmedById: f.admin,
      idempotencyKey: options.idempotencyKey === undefined ? crypto.randomUUID() : options.idempotencyKey,
    } });
  }
  function core(f: Fixture, overrides: Partial<Parameters<typeof recordApplicationDepositCore>[1]> = {}) {
    const checkedClient = { $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions) =>
      db.$transaction(async (tx) => { await runtime(tx); return callback(tx); }, options),
    } as Pick<PrismaClient, "$transaction">;
    return recordApplicationDepositCore(checkedClient, {
      submissionId: f.id, amount: 20_000, payerName: "Synthetic Payer",
      depositedAt: new Date("2026-01-01T00:30:00.000Z"), idempotencyKey: crypto.randomUUID(),
      actorUserId: f.admin, now: new Date("2026-02-01T00:00:00Z"), ...overrides,
    });
  }
  async function expectCoreDuplicate(f: Fixture, ids: string[], overrides: Partial<Parameters<typeof recordApplicationDepositCore>[1]> = {}, expectedRefunds = 0) {
    const before = await snapshot(f);
    let caught: unknown;
    try { await core(f, overrides); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SuspectedDuplicateApplicationDepositError);
    if (!(caught instanceof SuspectedDuplicateApplicationDepositError)) throw new Error("C11_EXPECTED_EXPLICIT_DUPLICATE_ERROR");
    expect(caught.submissionId).toBe(f.id);
    expect(caught.candidateDepositIds).toEqual([...ids].sort());
    expect(await snapshot(f)).toEqual(before);
    await ledger(f, expectedRefunds);
  }
  const nameCases = [
    { label: "leading/trailing whitespace trimmed by ACTION", stored: "Synthetic Payer", input: " \tSynthetic Payer \n", duplicate: true },
    { label: "internal whitespace is distinct", stored: "Synthetic Payer", input: "Synthetic  Payer", duplicate: false },
    { label: "English case is distinct", stored: "Synthetic Payer", input: "synthetic Payer", duplicate: false },
    { label: "NFC versus NFD remains distinct", stored: "Caf\u00e9", input: "Cafe\u0301", duplicate: false },
    { label: "NFKC compatibility width remains distinct", stored: "\uff21", input: "A", duplicate: false },
    { label: "stored leading whitespace is never retrimmed", stored: " Synthetic Payer", input: "Synthetic Payer", duplicate: false },
    { label: "stored trailing whitespace is never retrimmed", stored: "Synthetic Payer ", input: "Synthetic Payer", duplicate: false },
  ];
  for (const testCase of nameCases) {
    cell(`T05 / PG actual column equality + ADMIN / ${testCase.label}`, async (f) => {
      const stored = await seedDeposit(f, testCase.stored);
      const before = await snapshot(f);
      // This compares the real column under its real collation, not JS equality or a mock.
      const [comparison] = await db.$queryRaw<Array<{ equal: boolean }>>`
        SELECT "payerName" = ${testCase.input.trim()} AS equal FROM "ApplicationDeposit" WHERE "id" = ${stored.id}
      `;
      expect(comparison?.equal).toBe(testCase.duplicate);
      const data = deposit(20_000); data.set("payerName", testCase.input);
      const result = await recordApplicationDeposit(f.id, data);
      if (testCase.duplicate) {
        expect(result).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit" });
        expect(result.receiptId).toBeUndefined();
        expect(await snapshot(f)).toEqual(before);
      } else {
        expect(result.status).toBe("success");
        const created = await db.applicationDeposit.findUniqueOrThrow({ where: { id: result.receiptId } });
        expect(created.payerName).toBe(testCase.input.trim());
        expect((await snapshot(f)).deposits).toHaveLength(2);
      }
      expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: stored.id } })).payerName).toBe(testCase.stored);
      await ledger(f);
    });
  }
  cell("T05 / CORE intentionally does not trim its supplied payerName", async (f) => {
    await seedDeposit(f, "Synthetic Payer");
    const result = await core(f, { payerName: " Synthetic Payer " });
    expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: result.depositId } })).payerName).toBe(" Synthetic Payer ");
    expect((await snapshot(f)).deposits).toHaveLength(2);
    await ledger(f);
  });

  const timeCases = [
    { label: "identical stored millisecond", delta: 0, duplicate: true },
    { label: "plus 1ms", delta: 1, duplicate: false },
    { label: "minus 1ms", delta: -1, duplicate: false },
    { label: "different minute", delta: 60_000, duplicate: false },
  ];
  for (const testCase of timeCases) {
    cell(`T06 / CORE + PG TIMESTAMP(3) / ${testCase.label}`, async (f) => {
      const stored = await seedDeposit(f, "Synthetic Payer", { depositedAt: timestamp });
      expect(stored.depositedAt.getTime()).toBe(timestamp.getTime());
      const incoming = new Date(timestamp.getTime() + testCase.delta);
      const [comparison] = await db.$queryRaw<Array<{ equal: boolean }>>`
        SELECT "depositedAt" = ${incoming} AS equal FROM "ApplicationDeposit" WHERE "id" = ${stored.id}
      `;
      expect(comparison?.equal).toBe(testCase.duplicate);
      if (testCase.duplicate) await expectCoreDuplicate(f, [stored.id], { depositedAt: incoming });
      else {
        const result = await core(f, { depositedAt: incoming });
        expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: result.depositId } })).depositedAt.getTime()).toBe(incoming.getTime());
        expect((await snapshot(f)).deposits).toHaveLength(2);
        await ledger(f);
      }
    });
  }
  cell("T06 / positive integer amount difference is outside this guard", async (f) => {
    await seedDeposit(f, "Synthetic Payer");
    const result = await core(f, { amount: 20_001 });
    expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: result.depositId } })).amount).toBe(20_001);
    expect(await ledger(f)).toMatchObject({ D: 40_001, A: 40_001 });
  });
  cell("T06 / different Submission is outside this guard", async (f) => {
    const stored = await seedDeposit(f, "Synthetic Payer");
    await withFixture(async (other) => {
      const result = await core(other);
      expect((await snapshot(other)).deposits).toEqual([expect.objectContaining({ id: result.depositId, submissionId: other.id })]);
      await ledger(other);
    });
    context.actor = f.admin;
    expect((await snapshot(f)).deposits).toEqual([stored]);
    await ledger(f);
  });
  cell("T06 / ADMIN KST minute converts to exact UTC without reinterpretation", async (f) => {
    const stored = await seedDeposit(f, "Synthetic Payer");
    const data = deposit(20_000); data.set("payerName", "Synthetic Payer");
    expect(await recordApplicationDeposit(f.id, data)).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit" });
    expect(stored.depositedAt.toISOString()).toBe("2026-01-01T00:30:00.000Z");
    expect((await snapshot(f)).deposits).toEqual([stored]);
  });
  for (const value of ["0", "-1", "1.5", "2147483648"]) {
    cell(`T06 / ADMIN amount ${value} is INPUT rejection, never guard rejection`, async (f) => {
      const before = await snapshot(f), data = deposit(); data.set("amount", value);
      const result = await recordApplicationDeposit(f.id, data);
      expect(result.status).toBe("failure"); expect(result.code).toBeUndefined(); expect(result.receiptId).toBeUndefined();
      expect(result.errors?.amount).toBeDefined();
      expect(await snapshot(f)).toEqual(before);
    });
  }
  for (const value of ["not-a-time", "2999-01-01T09:30", "2026-01-01T09:30:00.123"]) {
    cell(`T06 / ADMIN invalid/future/seconds time ${value} is INPUT rejection`, async (f) => {
      const before = await snapshot(f), data = deposit(); data.set("depositedAt", value);
      const result = await recordApplicationDeposit(f.id, data);
      expect(result.status).toBe("failure"); expect(result.code).toBeUndefined(); expect(result.receiptId).toBeUndefined();
      expect(result.errors?.depositedAt).toBeDefined();
      expect(await snapshot(f)).toEqual(before);
    });
  }
  for (const amount of [0, -1, 1.5, 2_147_483_648]) {
    cell(`T06 / CORE invalid amount ${amount} preserves existing input rejection`, async (f) => {
      const before = await snapshot(f);
      await expect(core(f, { amount })).rejects.toBeInstanceOf(InsufficientApplicationDepositError);
      expect(await snapshot(f)).toEqual(before);
    });
  }
  for (const invalidDate of [new Date("invalid"), new Date("2999-01-01T00:00:00Z")]) {
    cell(`T06 / CORE ${Number.isFinite(invalidDate.getTime()) ? "future" : "invalid"} Date preserves input rejection`, async (f) => {
      const before = await snapshot(f);
      await expect(core(f, { depositedAt: invalidDate })).rejects.toBeInstanceOf(InsufficientApplicationDepositError);
      expect(await snapshot(f)).toEqual(before);
    });
  }
  cell("T06 / cumulative Int cap rejects an otherwise distinct positive amount atomically", async (f) => {
    await seedDeposit(f, "Synthetic Payer");
    const before = await snapshot(f), data = deposit(2_147_483_647);
    const result = await recordApplicationDeposit(f.id, data);
    expect(result.status).toBe("failure");
    expect(result.code).toBeUndefined(); expect(result.receiptId).toBeUndefined();
    expect(await snapshot(f)).toEqual(before);
    await ledger(f);
  });

  cell("T07 / NULL legacy idempotencyKey remains a candidate; omitted new CORE key remains guarded", async (f) => {
    const stored = await seedDeposit(f, "Synthetic Payer", { idempotencyKey: null });
    await expectCoreDuplicate(f, [stored.id], { idempotencyKey: undefined });
    expect((await snapshot(f)).deposits[0]!.idempotencyKey).toBeNull();
  });
  cell("T07 / stored payerName NULL is not a wildcard and remains NULL", async (f) => {
    const stored = await seedDeposit(f, null);
    const result = await core(f);
    expect((await snapshot(f)).deposits).toHaveLength(2);
    expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: stored.id } })).payerName).toBeNull();
    expect((await db.applicationDeposit.findUniqueOrThrow({ where: { id: result.depositId } })).payerName).toBe("Synthetic Payer");
    await ledger(f);
  });
  for (const status of ["SUBMITTED", "REJECTED", "CANCELLED"] as const) {
    cell(`T07 / application status ${status} does not exclude a candidate`, async (f) => {
      if (status !== "SUBMITTED") {
        for (const app of f.apps) expect((await resolveApplicationWorkflow(app, status, form({ resolutionNote: "합성 상태 경계" }))).status).toBe("success");
      }
      const stored = await seedDeposit(f, "Synthetic Payer");
      await expectCoreDuplicate(f, [stored.id]);
    });
  }
  for (const refunded of [false, true]) {
    cell(`T07 / genuinely CONFIRMED and fully Payment-allocated${refunded ? " / fully REFUNDED" : ""} Deposit remains a candidate`, async (f) => {
      const first = await recordApplicationDeposit(f.id, deposit());
      expect(first.status).toBe("success");
      const confirmation = await confirmApplicationSubmission(form({ payload: JSON.stringify({ submissionId: f.id,
        choices: f.apps.map((applicationId) => ({ applicationId, newChild: true })) }) }));
      expect(confirmation.status).toBe("success");
      expect((await snapshot(f)).applications.every((row) => row.status === "CONFIRMED")).toBe(true);
      if (refunded) {
        const state = await snapshot(f);
        for (const item of state.items) await createRefundCore(db, {
          paymentItemId: item.id, amount: item.paidAmount, reason: "PERSONAL", processedById: f.admin,
        });
        const fresh = await snapshot(f);
        expect(fresh.refunds).toHaveLength(2);
        expect(fresh.payments).toEqual([expect.objectContaining({ status: "REFUNDED" })]);
        for (const item of fresh.items) expect(item.refundedAmount).toBe(item.paidAmount);
      }
      const refundCount = refunded ? 2 : 0;
      // Payment Refund never replenishes ApplicationDeposit or removes its candidacy.
      expect(await ledger(f, refundCount)).toMatchObject({ D: 100_000, P: 100_000, A: 0 });
      await expectCoreDuplicate(f, [first.receiptId!], { amount: 100_000, payerName: "합성 실제 입금자" }, refundCount);
    });
  }
  for (const returned of [false, true]) {
    cell(`T07 / fully allocated ${returned ? "and fully returned" : "outstanding"} Deposit remains a candidate`, async (f) => {
      const stored = await seedDeposit(f, "Synthetic Payer");
      const obligation = await db.returnObligation.create({ data: { submissionId: f.id, kind: "EXCESS", amount: stored.amount } });
      await db.fundAllocation.create({ data: { depositId: stored.id, returnObligationId: obligation.id, amount: stored.amount } });
      if (returned) {
        expect((await recordApplicationReturn(obligation.id, transfer(20_000, 0, crypto.randomUUID(), 20_000))).status).toBe("success");
        expect(await ledger(f)).toMatchObject({ D: 20_000, A: 0, R: 0, T: 20_000 });
      } else expect(await ledger(f)).toMatchObject({ D: 20_000, A: 0, R: 20_000, T: 0 });
      await expectCoreDuplicate(f, [stored.id]);
    });
  }
  cell("T07 + S5A/T09 action / ALL past-data candidates preserved with each allocation chain and all error IDs", async (f) => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      // Past-data reproduction only: direct fixture INSERT, never a product guard bypass feature.
      const stored = await seedDeposit(f, "Synthetic Payer", { idempotencyKey: index === 0 ? null : crypto.randomUUID() });
      ids.push(stored.id);
      const obligation = await db.returnObligation.create({ data: { submissionId: f.id, kind: "EXCESS", amount: stored.amount } });
      await db.fundAllocation.create({ data: { depositId: stored.id, returnObligationId: obligation.id, amount: stored.amount } });
    }
    expect(await ledger(f)).toMatchObject({ D: 60_000, A: 0, R: 60_000, T: 0 });
    const detail = (await getApplicationWorkflowDetail(f.id))!;
    expect(detail.deposits.map((row) => row.id).sort()).toEqual(ids.sort());
    for (const row of detail.deposits) {
      expect(row.allocations).toEqual([expect.objectContaining({ depositId: row.id, amount: 20_000 })]);
      expect(row.allocations[0]!.returnObligationId).toBeTruthy();
    }
    await expectCoreDuplicate(f, ids);
    const before = await snapshot(f), data = deposit(20_000); data.set("payerName", "Synthetic Payer");
    const action = await recordApplicationDeposit(f.id, data);
    expect(action).toMatchObject({ status: "failure", code: "suspected-duplicate-deposit" });
    expect(action.receiptId).toBeUndefined(); expect(action.verified).toBeUndefined();
    expect(action.error).toContain("일치 후보 3건");
    for (const id of ids) expect(action.error).toContain(id);
    expect(action.error).toContain(`/reservation-applications/submissions/${f.id}`);
    expect(action.error).toContain("은행 거래"); expect(action.error).toContain("별도 절차");
    expect(await snapshot(f)).toEqual(before);
  });
});
