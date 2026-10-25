import { Prisma, PrismaClient } from "@prisma/client";
import { expect } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./db-safety";
import type { RecoveryFamily } from "./c11-recovery";

function admission() {
  if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("C11_RESIDUAL_LOCAL_ONLY");
  assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
}
function dedicatedClient() {
  admission();
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function runtime(client: Pick<Prisma.TransactionClient, "$queryRaw">) {
  const [row] = await client.$queryRaw<Array<{ pid: number; version: number; database: string; username: string; isolation: string }>>`
    SELECT pg_backend_pid() AS pid, current_setting('server_version_num')::int AS version,
      current_database()::text AS database, current_user::text AS username,
      current_setting('transaction_isolation')::text AS isolation
  `;
  expect(row).toMatchObject({ database: "yaho_e2e", username: "yaho_e2e", isolation: "read committed" });
  expect(row.version).toBeGreaterThanOrEqual(160000); expect(row.version).toBeLessThan(170000);
  return row.pid;
}
/** Poll deadlines are inconclusive failures, never evidence that a backend waited or rolled back. */
async function poll(check: () => Promise<boolean>, observer: PrismaClient, failure: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await observer.$queryRaw`SELECT 1`;
  }
  throw new Error(failure);
}
export type BlockedBrowserBackend = { pid: number; backendStart: string; xactStart: string; transactionId: string };

/** Test-side hold only. The real browser sends the unchanged ADMIN action.
 * pg_stat_activity cannot expose another backend's transaction_isolation. Runtime
 * checks below prove the holder/observer defaults; actual write-tx isolation is
 * separately covered by the PG integration proxy, never inferred here. */
export async function holdBrowserRow(table: "ReturnObligation" | "ReservationApplicationSubmission", id: string) {
  const holder = dedicatedClient(), observer = dedicatedClient();
  const held = gate(), release = gate();
  let holderPid = 0, observerPid = 0, holding = false;
  const task = holder.$transaction(async (tx) => {
    holderPid = await runtime(tx);
    const rows = table === "ReturnObligation"
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ReturnObligation" WHERE "id" = ${id} FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ReservationApplicationSubmission" WHERE "id" = ${id} FOR UPDATE`;
    expect(rows).toEqual([{ id }]); holding = true; held.release();
    await release.promise;
  }, { maxWait: 10_000, timeout: 45_000 });
  // Always attach the rejection handler before any browser interaction.
  const outcome = task.then(() => ({ error: null }), (error: unknown) => ({ error }));
  try {
    observerPid = await runtime(observer);
    await poll(async () => holding, observer, "C11_BROWSER_HOLDER_NOT_OBSERVED");
    await held.promise;
  } catch (error) {
    release.release(); await outcome;
    await Promise.allSettled([holder.$disconnect(), observer.$disconnect()]);
    throw error;
  }
  let observed: BlockedBrowserBackend | undefined;
  return {
    async blocked() {
      await poll(async () => {
        const rows = await observer.$queryRaw<Array<BlockedBrowserBackend>>`
          SELECT a.pid, a.backend_start::text AS "backendStart", a.xact_start::text AS "xactStart", a.backend_xid::text AS "transactionId"
          FROM pg_stat_activity a
          WHERE a.datname = current_database() AND a.usename = current_user
            AND a.pid NOT IN (${holderPid}, ${observerPid})
            AND a.state = 'active' AND a.wait_event_type = 'Lock'
            AND ${holderPid} = ANY(pg_blocking_pids(a.pid))
            AND a.query ~ ${`FROM[[:space:]]+"${table}"[[:space:]]`}
            AND a.query ~ 'FOR[[:space:]]+UPDATE'
            AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid
              AND NOT l.granted AND l.locktype IN ('transactionid', 'tuple'))
        `;
        if (rows.length !== 1) return false;
        observed = rows[0]; return true;
      }, observer, "C11_BROWSER_SERVER_ROW_WAIT_NOT_OBSERVED");
      expect(new Set([holderPid, observerPid, observed!.pid]).size).toBe(3);
      expect(observed!.xactStart).toEqual(expect.any(String));
      return observed!;
    },
    async terminate(backend: BlockedBrowserBackend) {
      expect(backend).toEqual(observed);
      // PID + backend/xact identity + current blocker prevent terminating an unrelated session.
      const rows = await observer.$queryRaw<Array<{ terminated: boolean }>>`
        SELECT pg_terminate_backend(a.pid) AS terminated FROM pg_stat_activity a
        WHERE a.pid = ${backend.pid} AND a.backend_start::text = ${backend.backendStart}
          AND a.xact_start::text = ${backend.xactStart} AND ${holderPid} = ANY(pg_blocking_pids(a.pid))
          AND a.wait_event_type = 'Lock'
      `;
      expect(rows).toEqual([{ terminated: true }]);
      await poll(async () => {
        const [row] = await observer.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid = ${backend.pid} AND backend_start::text = ${backend.backendStart}
        `;
        return row.count === 0;
      }, observer, "C11_BROWSER_TERMINATED_BACKEND_STILL_PRESENT");
    },
    async release() {
      release.release();
      const result = await outcome;
      if (result.error) throw result.error;
    },
    async drained() {
      if (!observed) return;
      await poll(async () => {
        const [row] = await observer.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid = ${observed!.pid} AND backend_start::text = ${observed!.backendStart}
            AND xact_start::text = ${observed!.xactStart}
        `;
        return row.count === 0;
      }, observer, "C11_BROWSER_ORIGINAL_WRITE_NOT_DRAINED");
    },
    async dispose() {
      release.release();
      const result = await outcome;
      try {
        if (observed) await poll(async () => {
          const [row] = await observer.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE pid = ${observed!.pid} AND backend_start::text = ${observed!.backendStart}
              AND xact_start::text = ${observed!.xactStart}
          `;
          return row.count === 0;
        }, observer, "C11_BROWSER_DISPOSE_ORIGINAL_WRITE_NOT_DRAINED");
      } finally { await Promise.allSettled([holder.$disconnect(), observer.$disconnect()]); }
      if (result.error) throw result.error;
    },
  };
}

/** Deletes only rows owned by this newly created synthetic family, after pending
 * requests/locks have drained. Never scans or changes real financial records. */
export async function cleanupResidualFamily(db: PrismaClient, fixture: RecoveryFamily) {
  admission();
  expect(fixture.marker).toMatch(/^UX_C11_SYNTHETIC_/);
  const submission = await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: fixture.submissionId }, include: {
    group: true, applications: { include: { classSchedule: { include: { program: true } } } },
  } });
  expect(submission.guardianName).toBe(fixture.marker);
  expect(submission.group?.syntheticRunId).toBe(fixture.marker);
  const programIds = [...new Set(submission.applications.map((row) => row.classSchedule.programId))];
  expect(submission.applications.every((row) => row.classSchedule.program.name === fixture.marker && row.reservationId === null)).toBe(true);
  await db.$transaction(async (tx) => {
    await tx.fundAllocation.deleteMany({ where: { deposit: { submissionId: fixture.submissionId } } });
    await tx.applicationReturn.deleteMany({ where: { returnObligation: { submissionId: fixture.submissionId } } });
    await tx.returnObligation.deleteMany({ where: { submissionId: fixture.submissionId } });
    await tx.applicationDeposit.deleteMany({ where: { submissionId: fixture.submissionId } });
    await tx.childConsent.deleteMany({ where: { reservationApplication: { submissionId: fixture.submissionId } } });
    await tx.reservationApplication.deleteMany({ where: { submissionId: fixture.submissionId } });
    await tx.reservationApplicationSubmission.delete({ where: { id: fixture.submissionId } });
    await tx.reservationApplicationGroup.delete({ where: { id: submission.groupId! } });
    await tx.classSchedule.deleteMany({ where: { programId: { in: programIds } } });
    await tx.program.deleteMany({ where: { id: { in: programIds }, name: fixture.marker } });
  });
  expect(await db.applicationDeposit.count({ where: { submissionId: fixture.submissionId } })).toBe(0);
  expect(await db.returnObligation.count({ where: { submissionId: fixture.submissionId } })).toBe(0);
}
