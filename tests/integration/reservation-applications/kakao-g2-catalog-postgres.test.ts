import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

// Actual PostgreSQL evidence only when run through the integration safety gate.
// This suite never edits migration history and does not establish G2 completion.
const db = new PrismaClient();
const models = ["NotificationRecipientRegistration", "NotificationDispatch", "NotificationAudit", "NotificationBudgetPeriod", "NotificationCostReservation", "NotificationRuntimeConfig"];
const migrationDir = join(process.cwd(), "prisma", "migrations");
afterAll(async () => { await db.$disconnect(); });

describe.sequential("G2 actual PostgreSQL catalog and constraints", () => {
  it("compares applied migration history and checksums with every repository migration", async () => {
    const dirs = (await readdir(migrationDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const history = await db.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; started_at: Date }[]>`
      SELECT migration_name, checksum, finished_at, rolled_back_at, started_at FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
    expect(history.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true);
    // The isolated DB accumulates migrations across deploys (RBAC applied
    // first, outbox and dispatch_guard later), so application order is
    // historical, not name order. Compare as sets; the per-row checksum
    // loop below still pins every applied migration to its repository SQL.
    expect([...history.map((row) => row.migration_name)].sort()).toEqual(dirs);
    for (const row of history) {
      const sql = await readFile(join(migrationDir, row.migration_name, "migration.sql"));
      expect(row.checksum).toBe(createHash("sha256").update(sql).digest("hex"));
    }
    const outbox = history.findIndex((row) => row.migration_name === "20261026090000_notification_outbox");
    const guard = history.findIndex((row) => row.migration_name === "20261028090000_notification_dispatch_guard");
    expect(outbox).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(outbox);
  });

  it("checks all six RLS tables, public policies and effective public role privileges", async () => {
    const tables = await db.$queryRaw<{ name: string; rls: boolean }[]>`
      SELECT c.relname::text AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${models}::text[]) ORDER BY c.relname`;
    expect(tables.map((row) => row.name)).toEqual([...models].sort());
    expect(tables.every((row) => row.rls)).toBe(true);
    const roles = await db.$queryRaw<{ rolname: string; rolcanlogin: boolean }[]>`SELECT rolname::text, rolcanlogin FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`;
    expect(roles).toEqual([{ rolname: "anon", rolcanlogin: false }, { rolname: "authenticated", rolcanlogin: false }]);
    const policies = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename::text FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${models}::text[]) AND roles && ARRAY['public','anon','authenticated']::name[]`;
    expect(policies).toEqual([]);
    const grants = await db.$queryRaw<{ grantee: string; table_name: string }[]>`SELECT grantee::text, table_name::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = ANY(${models}::text[]) AND grantee IN ('PUBLIC', 'anon', 'authenticated')`;
    expect(grants).toEqual([]);
    const access = await db.$queryRaw<{ allowed: boolean }[]>`SELECT has_table_privilege(r.rolname, format('%I.%I', 'public', t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed FROM pg_roles r CROSS JOIN unnest(${models}::text[]) t(name) WHERE r.rolname IN ('anon', 'authenticated')`;
    expect(access).toHaveLength(12);
    expect(access.every((row) => !row.allowed)).toBe(true);
  });

  it("denies a newly created restricted role direct reads of all six tables", async () => {
    const role = `g2_${randomUUID().replaceAll("-", "")}`;
    const ident = Prisma.raw(`"${role}"`); // generated hexadecimal identifier only
    let created = false;
    try {
      await db.$executeRaw`CREATE ROLE ${ident} NOLOGIN`;
      created = true;
      for (const table of models) {
        const tableIdent = Prisma.raw(`"${table}"`); // fixed allowlist above
        await expect(db.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL ROLE ${ident}`;
          await tx.$queryRaw`SELECT 1 FROM ${tableIdent} LIMIT 1`;
        })).rejects.toMatchObject({ code: "P2010", meta: { code: "42501" } });
      }
    } finally { if (created) await db.$executeRaw`DROP ROLE ${ident}`; }
  });

  it("inventories dependent views, functions and triggers and rejects public callable paths", async () => {
    const views = await db.$queryRaw<{ name: string; publicly_readable: boolean }[]>`
      SELECT DISTINCT format('%I.%I', vn.nspname, v.relname) AS name,
        (has_table_privilege('anon', v.oid, 'SELECT') OR has_table_privilege('authenticated', v.oid, 'SELECT')) AS publicly_readable
      FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid JOIN pg_class v ON v.oid = rw.ev_class
      JOIN pg_namespace vn ON vn.oid = v.relnamespace JOIN pg_class target ON target.oid = d.refobjid
      JOIN pg_namespace tn ON tn.oid = target.relnamespace
      WHERE tn.nspname = 'public' AND target.relname = ANY(${models}::text[]) AND v.relkind IN ('v','m')`;
    expect(views.filter((row) => row.publicly_readable)).toEqual([]);
    const triggers = await db.$queryRaw<{ name: string }[]>`SELECT t.tgname::text AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY(${models}::text[]) ORDER BY t.tgname`;
    expect(triggers).toContainEqual({ name: "notification_cost_immutable_update" });
    // Function-body search is intentionally conservative; dynamic SQL and
    // transitive calls still require separate review of the reported inventory.
    const functions = await db.$queryRaw<{ name: string; security_definer: boolean; executable: boolean }[]>`
      SELECT p.oid::regprocedure::text AS name, p.prosecdef AS security_definer,
        (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS executable
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND EXISTS (SELECT 1 FROM unnest(${models}::text[]) model WHERE position(lower(model) in lower(p.prosrc)) > 0)`;
    expect(functions.filter((row) => row.security_definer && row.executable)).toEqual([]);
  });
});

// Actual database constraint checks; failing transactions roll back synthetic rows.
describe.sequential("G2 actual PostgreSQL constraints", () => {
  async function fixture(tx: Prisma.TransactionClient, id: string) {
    const at = new Date("2040-01-01T00:00:00Z");
    await tx.user.create({ data: { id, email: `${id}@example.test`, name: "synthetic", role: "ADMIN" } });
    await tx.notificationOutbox.create({ data: { id, eventKind: "application.received", entityId: id, dedupeKey: id, audience: "admin", occurredAt: at } });
    await tx.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion") VALUES (${id}, ${id}, 'synthetic', ${id}, 'v1', 'active', 'v1', 'v1')`;
    await tx.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion") VALUES (${id}, ${id}, ${id}, ${id}, 'mock', ${id}, 'v1', 'synthetic', 'v1', ${at}, 'ready', 'v1')`;
    return at;
  }
  async function slot(tx: Prisma.TransactionClient, id: string, sequence: number, status: string) {
    await tx.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${`${id}-${sequence}`}, ${id}, ${sequence}, ${status}, ${new Date("2040-01-01T00:00:00Z")}, '2040-01-01', '2040-01', 1, 'reserved')`;
  }
  it("enforces partial recipient and unresolved slot uniqueness", async () => {
    const id = randomUUID();
    await expect(db.$transaction(async (tx) => {
      await fixture(tx, id);
      await tx.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion") VALUES (${`${id}-other`}, ${id}, 'synthetic', ${id}, 'v2', 'active', 'v1', 'v1')`;
    })).rejects.toMatchObject({ code: "P2010", meta: { code: "23505" } });
    const other = randomUUID();
    await expect(db.$transaction(async (tx) => { await fixture(tx, other); await slot(tx, other, 1, "in_flight"); await slot(tx, other, 2, "unknown"); })).rejects.toMatchObject({ code: "P2010", meta: { code: "23505" } });
  });
  it("rejects a missing foreign key, invalid slot range and negative budget", async () => {
    const id = randomUUID();
    await expect(db.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion") VALUES (${id}, ${id}, 'synthetic', ${id}, 'v1', 'inactive', 'v1', 'v1')`).rejects.toMatchObject({ code: "P2010", meta: { code: "23503" } });
    await expect(db.$transaction(async (tx) => { await fixture(tx, id); await slot(tx, id, 6, "in_flight"); })).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
    await expect(db.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion", "requestCount") VALUES (${id}, ${id}, 'synthetic', 'day', '2040-01-01', 'v1', -1)`).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
  });
  it("retains dispatch, slot and audit and rejects restoration of purged cost details", async () => {
    const id = randomUUID(); const rollback = new Error("synthetic rollback");
    await expect(db.$transaction(async (tx) => {
      const at = await fixture(tx, id); await slot(tx, id, 1, "delivered");
      await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "reservedMilliKrw" = 0, "confirmedMilliKrw" = 1, "costState" = 'settled' WHERE "id" = ${`${id}-1`}`;
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "dispatchId", "slotId", "eventType", "occurredAt") VALUES (${`${id}-audit`}, ${`${id}-audit`}, ${id}, ${id}, ${`${id}-1`}, 'synthetic', ${at})`;
      await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "costState" = 'summary_purged', "costSummaryPurgedAt" = ${at}, "detailPurgedAt" = ${at}, "reservedMilliKrw" = NULL, "confirmedMilliKrw" = NULL WHERE "id" = ${`${id}-1`}`;
      const evidence = await tx.$queryRaw<{ dispatch_count: bigint; slot_count: bigint; audit_count: bigint }[]>`SELECT (SELECT count(*) FROM "NotificationDispatch" WHERE "id" = ${id}) AS dispatch_count, (SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId" = ${id} AND "sequence" = 1 AND "costState" = 'summary_purged') AS slot_count, (SELECT count(*) FROM "NotificationAudit" WHERE "dispatchId" = ${id} AND "slotId" = ${`${id}-1`}) AS audit_count`;
      expect(evidence).toEqual([{ dispatch_count: 1n, slot_count: 1n, audit_count: 1n }]);
      await tx.$executeRaw`SAVEPOINT restoration_attempt`;
      await expect(tx.$executeRaw`UPDATE "NotificationCostReservation" SET "providerRef" = 'synthetic' WHERE "id" = ${`${id}-1`}`).rejects.toMatchObject({ code: "P2010", meta: { code: "P0001" } });
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT restoration_attempt`;
      const rows = await tx.$queryRaw<{ providerRef: string | null }[]>`SELECT "providerRef" FROM "NotificationCostReservation" WHERE "id" = ${`${id}-1`}`;
      expect(rows).toEqual([{ providerRef: null }]);
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
