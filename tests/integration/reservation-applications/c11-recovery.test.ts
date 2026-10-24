/**
 * C11 / S1–S6: committed server records, explicit retries and independent PG sessions.
 * 본 테스트는 서버 측 동작만 검증하며, 브라우저·운영자 확인이 남는 시나리오는 BLOCKED 유지
 * Discarding a function result models transport response loss only; it does not close a tab.
 * C10 refund races remain in payment-refund-concurrency.test.ts; no refund writes occur here.
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
  confirmApplicationSubmission, lookupWorkflowReceipt, recordApplicationDeposit,
  recordApplicationReturn, resolveApplicationWorkflow, type WorkflowActionResult,
} from "@/app/(admin)/reservation-applications/actions";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { getApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import { getApplicationReturn } from "@/lib/reservation-applications/return-queries";
import { confirmReservationApplicationCore } from "@/server/reservation-applications/confirm";

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
function confirm(f: Fixture) {
  return confirmApplicationSubmission(form({ payload: JSON.stringify({ submissionId: f.id,
    choices: f.apps.map((applicationId) => ({ applicationId, newChild: true })) }) }));
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
  // No Refund fixtures or refund cleanup: C10's separate suite owns that path.
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
  const id = `c11-${crypto.randomUUID()}`;
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
async function ledger(f: Fixture) {
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
  expect(await db.refund.count({ where: { paymentItem: { reservation: { classScheduleId: { in: f.classes } } } } })).toBe(0);
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
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
async function confirmedLinks(f: Fixture) {
  const state = await snapshot(f);
  expect(state.payments).toHaveLength(1); expect(state.reservations).toHaveLength(2);
  expect(state.items).toHaveLength(2); expect(state.mappings).toHaveLength(2);
  expect(state.payments[0]).toMatchObject({ totalAmount: 100_000, status: "PAID", method: "TRANSFER" });
  for (const [index, applicationId] of f.apps.entries()) {
    const app = state.applications.find((row) => row.id === applicationId)!;
    expect(app).toMatchObject({ status: "CONFIRMED", quotedAmount: index === 0 ? 40_000 : 60_000 });
    const item = state.items.find((row) => row.reservationId === app.reservationId)!;
    expect(item).toMatchObject({ paymentId: state.payments[0]!.id, amount: app.quotedAmount,
      paidAmount: app.quotedAmount, discountAmount: 0, refundedAmount: 0 });
    expect(state.mappings.filter((row) => row.applicationId === applicationId)).toEqual([
      expect.objectContaining({ paymentItemId: item.id }),
    ]);
    expect(state.reservations.find((row) => row.id === app.reservationId)?.childId).toBe(app.childId);
  }
  expect(await ledger(f)).toMatchObject({ D: 100_000, P: 100_000, A: 0, R: 0, T: 0 });
  return state;
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

/** Adapt C10's parent-lock gate/PID observation to the existing Submission serialization point. */
async function concurrentActions(f: Fixture, action: () => Promise<WorkflowActionResult>) {
  const controller = dedicatedClient(), observer = dedicatedClient();
  const clients = [dedicatedClient(), dedicatedClient()];
  const release = gate();
  const pending: Array<Promise<PromiseSettledResult<unknown>>> = [];
  const pids = [0, 0];
  let controllerPid = 0, observerPid = 0, held = false, calls = 0;
  async function poll(check: () => Promise<boolean>) {
    const deadline = Date.now() + 8_000; // Failure bound only; no sleep-driven interleaving.
    while (Date.now() < deadline) {
      if (await check()) return;
      await observer.$queryRaw`SELECT 1`;
    }
    throw new Error("C11_INCONCLUSIVE_SUBMISSION_BARRIER_NOT_OBSERVED");
  }
  try {
    observerPid = await runtime(observer);
    const controllerTask = settled(controller.$transaction(async (tx) => {
      controllerPid = await runtime(tx);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${f.id} FOR UPDATE
      `;
      expect(rows).toHaveLength(1); held = true;
      await release.promise;
    }, { maxWait: 10_000, timeout: 30_000 }));
    pending.push(controllerTask);
    await poll(async () => held);
    // Both ADMIN adapters remain real. Only their outer transactions are routed to distinct clients.
    context.db = new Proxy(db, { get(target, property) {
      if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions) => {
        const index = calls++, client = clients[index];
        if (!client) throw new Error("C11_UNEXPECTED_EXTRA_TRANSACTION");
        return client.$transaction(async (tx) => { pids[index] = await runtime(tx); return callback(tx); }, options);
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const requests = [settled(action()), settled(action())];
    pending.push(...requests);
    await poll(async () => {
      if (pids.length !== 2 || pids.some((pid) => !pid)) return false;
      const rows = await observer.$queryRaw<Array<{ pid: number; observerPid: number; state: string;
        waitEventType: string | null; blockers: number[]; submissionLock: boolean; waiting: boolean }>>`
        SELECT a.pid, pg_backend_pid() AS "observerPid", a.state, a.wait_event_type AS "waitEventType",
          pg_blocking_pids(a.pid) AS blockers,
          (a.query ~ 'FROM[[:space:]]+"ReservationApplicationSubmission"[[:space:]]' AND
            a.query ~ 'FOR[[:space:]]+UPDATE') AS "submissionLock",
          EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted
            AND l.locktype IN ('transactionid', 'tuple')) AS waiting
        FROM pg_stat_activity a WHERE a.pid IN (${Prisma.join([controllerPid, ...pids])})
      `;
      function reaches(pid: number, visited = new Set<number>()): boolean {
        if (pid === controllerPid) return true;
        if (visited.has(pid)) return false;
        visited.add(pid);
        return rows.find((row) => row.pid === pid)?.blockers.some((blocker) => reaches(blocker, visited)) ?? false;
      }
      return pids.every((pid) => rows.some((row) => row.pid === pid && row.observerPid === observerPid &&
        row.state === "active" && row.waitEventType === "Lock" && row.submissionLock && row.waiting && reaches(pid)));
    });
    expect(new Set([controllerPid, observerPid, ...pids]).size).toBe(4);
    release.release();
    expect((await controllerTask).status).toBe("fulfilled");
    const results = await Promise.all(requests);
    expect(calls).toBe(2);
    return results.map((result) => {
      expect(result.status).toBe("fulfilled");
      if (result.status !== "fulfilled") throw new Error("C11_ACTION_DID_NOT_SETTLE_NORMALLY");
      return result.value;
    });
  } finally {
    // Drain original writes before either disconnecting clients or deleting their fixture.
    release.release();
    await Promise.allSettled(pending);
    context.db = db;
    await Promise.allSettled([controller.$disconnect(), observer.$disconnect(), ...clients.map((client) => client.$disconnect())]);
  }
}

beforeAll(async () => { await runtime(db); }, 30_000);
afterAll(async () => { await db.$disconnect(); }, 30_000);

describe.sequential("C11 server-side recovery evidence on real PostgreSQL 16", () => {
  cell("D1 / S1,S6 same key and unchanged payload replay keeps one Deposit and one allocation", async (f) => {
    await rejectSibling(f);
    const key = crypto.randomUUID();
    const first = await recordApplicationDeposit(f.id, deposit(100_000, key));
    expect(first.status).toBe("success");
    const before = await snapshot(f);
    expect(before.deposits).toHaveLength(1); expect(before.allocations).toHaveLength(1);
    expect(await recordApplicationDeposit(f.id, deposit(100_000, key))).toEqual(first);
    expect(await snapshot(f)).toEqual(before);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, P: 0, R: 60_000, T: 0 });
    await noConfirmation(f);
  });

  for (const [field, value] of [["amount", "99999"], ["payerName", "합성 변경 입금자"], ["depositedAt", "2026-01-02T09:30"]]) {
    cell(`D2-${field} / S1,S6 same key with changed ${field} is rejected without writes`, async (f) => {
      await rejectSibling(f); const key = crypto.randomUUID();
      expect((await recordApplicationDeposit(f.id, deposit(100_000, key))).status).toBe("success");
      const before = await snapshot(f), changed = deposit(100_000, key);
      changed.set(field!, value!);
      expect((await recordApplicationDeposit(f.id, changed)).status).toBe("failure");
      expect(await snapshot(f)).toEqual(before);
      expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 60_000 }); await noConfirmation(f);
    });
  }

  cell("D3 / S1,S4,S5 committed Deposit response discarded: receipt and fresh detail identify the same row", async (f) => {
    await rejectSibling(f); const key = crypto.randomUUID();
    await recordApplicationDeposit(f.id, deposit(100_000, key)); // Commit completes; intentionally discard its result.
    const stored = await db.applicationDeposit.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const before = await snapshot(f);
    const receipt = await lookupWorkflowReceipt("deposit", f.id, key);
    expect(receipt).toMatchObject({ status: "success", receiptId: stored.id, submissionId: f.id });
    const detail = (await getApplicationWorkflowDetail(f.id))!;
    expect(detail.deposits).toHaveLength(1);
    expect(detail.deposits[0]).toMatchObject({ id: receipt.receiptId, amount: 100_000 });
    expect(await snapshot(f)).toEqual(before);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 60_000 }); await noConfirmation(f);
  });

  cell("D4 / S1,S6 lost key: ONE synthetic bank event must still have ONE Deposit after new-key re-entry", async (f) => {
    await rejectSibling(f);
    await recordApplicationDeposit(f.id, deposit()); // Original result/key deliberately not retained by the caller.
    const original = await snapshot(f);
    expect(original.deposits).toHaveLength(1);
    expect(original.allocations).toHaveLength(1);
    // This is re-entry of the SAME reality event: same submission, amount, payer and bank timestamp.
    // A fresh UUID is NOT evidence of a second bank transaction. Never weaken the oracle to 2 rows,
    // mark this as an expected failure, or treat conservation alone as proof of deduplication.
    await recordApplicationDeposit(f.id, deposit());
    const after = await snapshot(f);
    const totals = await ledger(f); // Also validates allocation/counter consistency even if duplicates exist.
    expect.soft(after.deposits).toHaveLength(1);
    expect.soft(after.deposits.map((row) => row.id)).toEqual(original.deposits.map((row) => row.id));
    expect.soft(after.allocations).toEqual(original.allocations);
    expect.soft(totals).toMatchObject({ D: 100_000, A: 40_000, P: 0, R: 60_000, T: 0 });
    await noConfirmation(f);
  });

  cell("D5 / S1,S6 two independent clients contending on one key create one Deposit", async (f) => {
    await rejectSibling(f); const key = crypto.randomUUID();
    const results = await concurrentActions(f, () => recordApplicationDeposit(f.id, deposit(100_000, key)));
    expect(results.map((row) => row.status)).toEqual(["success", "success"]);
    expect(results[0]!.receiptId).toBe(results[1]!.receiptId);
    const state = await snapshot(f);
    expect(state.deposits).toHaveLength(1); expect(state.allocations).toHaveLength(1);
    expect(state.deposits[0]!.id).toBe(results[0]!.receiptId);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 60_000 }); await noConfirmation(f);
  });

  for (const amount of [20_000, 60_000]) {
    cell(`R1-${amount} / S2,S6 same-key return replay preserves one row, cumulative amount and resolvedAt`, async (f) => {
      const obligation = await fundedReturn(f), key = crypto.randomUUID();
      const first = await recordApplicationReturn(obligation.id, transfer(amount, 0, key));
      expect(first.status).toBe("success");
      const before = await snapshot(f);
      expect(before.returns).toHaveLength(1);
      expect(before.obligations[0]!.returnedAmount).toBe(amount);
      if (amount === 60_000) expect(before.obligations[0]!.resolvedAt).not.toBeNull();
      else expect(before.obligations[0]!.resolvedAt).toBeNull();
      // Original observation is now stale; exact-key replay must still find the prior receipt first.
      expect(await recordApplicationReturn(obligation.id, transfer(amount, 0, key))).toEqual(first);
      expect(await snapshot(f)).toEqual(before);
      expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, P: 0, R: 60_000 - amount, T: amount });
      await noConfirmation(f);
    });
  }

  for (const staleField of ["amount", "returnedAmount"] as const) {
    cell(`R2-${staleField} / S2,S6 stale observed ${staleField} rejects a fresh-key return unchanged`, async (f) => {
      const obligation = await fundedReturn(f);
      expect((await recordApplicationReturn(obligation.id, transfer(20_000))).status).toBe("success");
      const before = await snapshot(f);
      const input = staleField === "amount" ? transfer(10_000, 20_000, crypto.randomUUID(), 60_001) : transfer(10_000, 0);
      expect((await recordApplicationReturn(obligation.id, input)).status).toBe("failure");
      expect(await snapshot(f)).toEqual(before);
      expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 40_000, T: 20_000 }); await noConfirmation(f);
    });
  }

  cell("R3 / S2,S4,S5 discarded Return response is recovered as the same row in fresh detail", async (f) => {
    const obligation = await fundedReturn(f), key = crypto.randomUUID();
    await recordApplicationReturn(obligation.id, transfer(60_000, 0, key)); // Discard the committed return value only.
    const stored = await db.applicationReturn.findUniqueOrThrow({ where: { idempotencyKey: key } });
    const before = await snapshot(f);
    const detail = (await getApplicationWorkflowDetail(f.id))!;
    const recovered = detail.returnObligations.find((row) => row.id === obligation.id)!;
    expect(recovered).toMatchObject({ returnedAmount: 60_000 }); expect(recovered.resolvedAt).not.toBeNull();
    expect(recovered.returns).toHaveLength(1); expect(recovered.returns[0]).toMatchObject({ id: stored.id, amount: 60_000 });
    expect(await getApplicationReturn(obligation.id)).toEqual({ ...recovered, ledgerVerified: true });
    expect(await lookupWorkflowReceipt("return", obligation.id, key)).toMatchObject({ status: "success", receiptId: stored.id, submissionId: f.id });
    expect(await snapshot(f)).toEqual(before);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 0, T: 60_000 }); await noConfirmation(f);
  });

  cell("R4 / S2,S6 distinct partial returns with fresh keys/current observations are allowed; upper bound remains", async (f) => {
    const obligation = await fundedReturn(f), firstKey = crypto.randomUUID(), secondKey = crypto.randomUUID();
    expect((await recordApplicationReturn(obligation.id, transfer(20_000, 0, firstKey))).status).toBe("success");
    const allocations = (await snapshot(f)).allocations;
    // A separately recorded partial transfer, unlike D4's re-entry of the same bank deposit.
    expect((await recordApplicationReturn(obligation.id, transfer(20_000, 20_000, secondKey))).status).toBe("success");
    let state = await snapshot(f);
    expect(state.returns).toHaveLength(2); expect(state.obligations[0]).toMatchObject({ returnedAmount: 40_000, resolvedAt: null });
    expect(state.allocations).toEqual(allocations);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 20_000, T: 40_000 });
    expect((await recordApplicationReturn(obligation.id, transfer(20_001, 40_000))).status).toBe("failure");
    expect(await snapshot(f)).toEqual(state);
    expect((await recordApplicationReturn(obligation.id, transfer(20_000, 40_000))).status).toBe("success");
    state = await snapshot(f);
    expect(state.returns).toHaveLength(3); expect(state.obligations[0]!.resolvedAt).not.toBeNull();
    expect((await recordApplicationReturn(obligation.id, transfer(1, 60_000))).status).toBe("failure");
    expect(await snapshot(f)).toEqual(state);
    expect(state.allocations).toEqual(allocations);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 40_000, R: 0, T: 60_000 }); await noConfirmation(f);
  });

  cell("C1 / S3,S6 two independent confirmation clients produce one Payment and one set of links", async (f) => {
    expect((await recordApplicationDeposit(f.id, deposit())).status).toBe("success");
    const results = await concurrentActions(f, () => confirm(f));
    expect(results.filter((row) => row.status === "success")).toHaveLength(1);
    expect(results.filter((row) => row.status === "failure")).toHaveLength(1);
    const winner = results.find((row) => row.status === "success")!;
    const state = await confirmedLinks(f);
    expect(state.payments[0]!.id).toBe(winner.paymentId);
    expect(state.reservations.map((row) => row.id).sort()).toEqual([...winner.reservationIds!].sort());
  });

  cell("C2 / S3,S4,S5,S6 discarded confirmation response recovers actual links; repeat adds nothing", async (f) => {
    expect((await recordApplicationDeposit(f.id, deposit())).status).toBe("success");
    await confirm(f); // Intentionally lose the response; recover only from authoritative server records.
    const before = await confirmedLinks(f), detail = (await getApplicationWorkflowDetail(f.id))!;
    for (const row of detail.applications) {
      const stored = before.applications.find((app) => app.id === row.id)!;
      expect(row).toMatchObject({ status: "CONFIRMED", reservation: { id: stored.reservationId },
        paymentMapping: { paymentItem: { paymentId: before.payments[0]!.id } } });
    }
    expect((await confirm(f)).status).toBe("failure");
    expect(await confirmedLinks(f)).toEqual(before);
  });

  cell("C3 / S3,S5 transaction fails after real Payment/items/mappings/allocation writes: fresh read sees total rollback", async (f) => {
    expect((await recordApplicationDeposit(f.id, deposit())).status).toBe("success");
    const before = await snapshot(f), beforeDetail = await getApplicationWorkflowDetail(f.id);
    let allocationWrites = 0;
    let seen: { reservations: number; children: number; consents: number; items: number; mappings: number } | undefined;
    context.db = new Proxy(db, { get(target, property) {
      if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: TransactionOptions) =>
        target.$transaction((tx) => callback(new Proxy(tx, { get(transaction, key) {
          if (key === "fundAllocation") return new Proxy(transaction.fundAllocation, { get(delegate, method) {
            if (method === "create") return async (args: Prisma.FundAllocationCreateArgs) => {
              await delegate.create(args); allocationWrites++;
              const payments = await tx.payment.findMany({ where: { items: { some: { reservation: { classScheduleId: { in: f.classes } } } } }, select: { id: true } });
              f.observedPaymentIds.push(...payments.map((row) => row.id));
              seen = { reservations: await tx.reservation.count({ where: { classScheduleId: { in: f.classes } } }),
                children: await tx.child.count({ where: { guardianName: f.guardianName } }),
                consents: await tx.childConsent.count({ where: { reservationApplicationId: { in: f.apps } } }),
                items: await tx.paymentItem.count({ where: { paymentId: { in: f.observedPaymentIds } } }),
                mappings: await tx.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: f.id } } }) };
              throw new Error("SYNTHETIC_C11_FAILURE_AFTER_COMMITTED_TO_TX_WRITES");
            };
            const value: unknown = Reflect.get(delegate, method);
            return typeof value === "function" ? value.bind(delegate) : value;
          } });
          const value: unknown = Reflect.get(transaction, key);
          return typeof value === "function" ? value.bind(transaction) : value;
        } })), options);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    try { expect((await confirm(f)).status).toBe("result-unknown"); }
    finally { context.db = db; }
    expect(allocationWrites).toBe(1);
    expect(seen).toMatchObject({ reservations: 2, children: 2, items: 2, mappings: 2 });
    expect(seen!.consents).toBeGreaterThan(0); expect(f.observedPaymentIds).toHaveLength(1);
    // The injected request has terminated. A new snapshot, not an error response, proves rollback.
    expect(await snapshot(f)).toEqual(before);
    expect(await db.payment.count({ where: { id: { in: f.observedPaymentIds } } })).toBe(0);
    expect(await getApplicationWorkflowDetail(f.id)).toEqual(beforeDetail);
    expect(await ledger(f)).toMatchObject({ D: 100_000, A: 100_000, P: 0, R: 0, T: 0 }); await noConfirmation(f);
  });

  cell("C4 / S3,S5 legacy confirmation recovers Reservation with zero automatic Payment/items/mappings", async (f) => {
    // Suites are sequential (fileParallelism:false); include parent rows without items in this oracle.
    const paymentParentsBefore = await db.payment.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    await db.reservationApplication.create({ data: { ...consent, id: f.legacyId, classScheduleId: f.classes[0],
      childName: `${f.id}-합성 legacy 아이`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED",
      guardianName: f.guardianName, guardianPhone: "01000000000", guardianRelationship: "MOTHER",
      depositConfirmedAt: new Date("2026-01-01"), depositConfirmedById: f.admin } });
    await confirmReservationApplicationCore(db, { applicationId: f.legacyId, childChoice: { type: "NEW" },
      confirmOverbooking: false, actorUserId: f.admin, now: new Date() }); // Discard response; legacy has no keyed receipt.
    const recovered = await db.reservationApplication.findUniqueOrThrow({ where: { id: f.legacyId },
      include: { reservation: { include: { paymentItem: true } }, paymentMapping: true } });
    expect(recovered).toMatchObject({ status: "CONFIRMED", quotedAmount: null, paymentMapping: null });
    expect(recovered.reservation).toMatchObject({ childId: recovered.childId, paymentItem: null });
    expect(await db.reservation.count({ where: { classScheduleId: { in: f.classes } } })).toBe(1);
    expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: f.classes } } } } } })).toBe(0);
    expect(await db.paymentItem.count({ where: { reservation: { classScheduleId: { in: f.classes } } } })).toBe(0);
    expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: f.legacyId } })).toBe(0);
    await expect(confirmReservationApplicationCore(db, { applicationId: f.legacyId, childChoice: { type: "NEW" },
      confirmOverbooking: false, actorUserId: f.admin, now: new Date() })).rejects.toBeDefined();
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: f.legacyId },
      include: { reservation: { include: { paymentItem: true } }, paymentMapping: true } })).toEqual(recovered);
    expect(await db.reservation.count({ where: { classScheduleId: { in: f.classes } } })).toBe(1);
    const paymentParentsAfter = await db.payment.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    f.observedPaymentIds.push(...paymentParentsAfter.filter((row) => !paymentParentsBefore.some((prior) => prior.id === row.id)).map((row) => row.id));
    expect(paymentParentsAfter).toEqual(paymentParentsBefore);
    // Legacy amount remains unrecorded. Conservation applies to this fixture's separate modern submission.
    expect(await ledger(f)).toMatchObject({ D: 0, A: 0, P: 0, R: 0, T: 0 });
  });

  for (const kind of ["deposit", "return"] as const) {
    async function receiptFixture(f: Fixture) {
      const key = crypto.randomUUID();
      if (kind === "deposit") {
        await rejectSibling(f);
        const result = await recordApplicationDeposit(f.id, deposit(100_000, key));
        expect(result.status).toBe("success");
        return { targetId: f.id, key, receiptId: result.receiptId!, input: () => deposit(100_000, key) };
      }
      const obligation = await fundedReturn(f);
      const result = await recordApplicationReturn(obligation.id, transfer(20_000, 0, key));
      expect(result.status).toBe("success");
      return { targetId: obligation.id, key, receiptId: result.receiptId!, input: () => transfer(20_000, 0, key) };
    }
    cell(`L1-${kind} / S4,S5 key-only lookup finds the existing ${kind} receipt without writes`, async (f) => {
      const receipt = await receiptFixture(f), before = await snapshot(f);
      expect(await lookupWorkflowReceipt(kind, receipt.targetId, receipt.key)).toEqual({ status: "success",
        receiptId: receipt.receiptId, submissionId: f.id });
      expect(await snapshot(f)).toEqual(before); await ledger(f); await noConfirmation(f);
    });
    cell(`L2-${kind} / S4,S5 FormData lookup distinguishes matching payload from changed payload`, async (f) => {
      const receipt = await receiptFixture(f), before = await snapshot(f);
      expect(await lookupWorkflowReceipt(kind, receipt.targetId, receipt.key, receipt.input())).toMatchObject({
        status: "success", receiptId: receipt.receiptId, submissionId: f.id });
      const changes = kind === "deposit"
        ? { amount: "99999", payerName: "합성 다른 입금자", depositedAt: "2026-01-02T09:30" }
        : { amount: "19999", reason: "합성 다른 반환 사유", returnedAt: "2026-01-02T09:30" };
      for (const [field, value] of Object.entries(changes)) {
        const changed = receipt.input(); changed.set(field, value);
        expect((await lookupWorkflowReceipt(kind, receipt.targetId, receipt.key, changed)).status).toBe("failure");
      }
      expect(await snapshot(f)).toEqual(before); await ledger(f); await noConfirmation(f);
    });
    cell(`L3-${kind} / S4,S5 random unknown key is not-found without inferring rollback`, async (f) => {
      const receipt = await receiptFixture(f), before = await snapshot(f);
      // not-found proves absence at this lookup only. It is NOT proof that any original request rolled back
      // or terminated; this random key has never been submitted, and no write/retry is triggered by lookup.
      const missingKey = crypto.randomUUID();
      expect(await lookupWorkflowReceipt(kind, receipt.targetId, missingKey)).toMatchObject({ status: "failure", code: "not-found" });
      expect(await lookupWorkflowReceipt(kind, receipt.targetId, missingKey, receipt.input())).toMatchObject({ status: "failure", code: "not-found" });
      expect(await snapshot(f)).toEqual(before); await ledger(f); await noConfirmation(f);
    });
  }
});
