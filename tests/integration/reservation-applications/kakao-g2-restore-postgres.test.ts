import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { evaluateSendGate, isExplicitSendDisabled } from "@/lib/kakao/send-config";
import { encryptSyntheticRecipient, decryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import {
  assertRestoreDatabaseUrl,
  assertRestoreServiceVersion,
  deriveRestoreDatabaseUrl,
  restorePasswordFromUrl,
} from "../../e2e/support/restore-db-safety";

// G2 R-01 actual PostgreSQL backup/restore evidence (synthetic data only).
// This suite never touches Preview/Production, never sends anything real, and
// never claims G2 completion. It proves, against real PostgreSQL dump/restore,
// that a restored backup stays OFF and cannot resurrect revoked/purged/spent
// state without the independent latest-evidence ledger.
// Local PostgreSQL/Docker do not exist on this VM, so this file is verified by
// typecheck/lint/static review here; real PG execution happens in CI only.

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const runId = `g2-restore-${randomUUID()}`;
const dbSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
const sourceDb = `yaho_restore_source_${dbSuffix}`;
const targetDb = `yaho_restore_target_${dbSuffix}`;
const baseUrl = process.env.DATABASE_URL!;
const sourceUrl = deriveRestoreDatabaseUrl(baseUrl, sourceDb);
const targetUrl = deriveRestoreDatabaseUrl(baseUrl, targetDb);
const sourceMeta = assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", sourceUrl, sourceDb);
const targetMeta = assertRestoreDatabaseUrl("RESTORE_TARGET_URL", targetUrl, targetDb);
const pgPassword = new URL(baseUrl).password === ""
  // Local isolated PG uses trust auth, so the base URL carries no password
  // and pg_dump/pg_restore need no PGPASSWORD. The CI service has a
  // password, which the helper returns. Only the call site is adapted here;
  // restore-db-safety.ts itself is verbatim.
  ? ""
  : restorePasswordFromUrl(baseUrl);
const tmpDir = join(tmpdir(), `g2-restore-${dbSuffix}`);
const dumpPath = join(tmpDir, "source.dump");
const mirrorPath = join(tmpDir, "ledger.json");

const at = new Date("2040-01-01T00:00:00Z");
const at2 = new Date("2040-01-02T00:00:00Z");
const ref = `g2ref_${"b".repeat(32)}`;
const userActive = runId;
const userRevoked = `${runId}-revoked`;
const keyVersion = `k${dbSuffix}`;
const namespace = `test_${dbSuffix}`;
const recipientActive = `${runId}-recipient-active`;
const recipientRevoked = `${runId}-recipient-revoked`;
const pendingOutboxId = `${runId}-outbox-pending`;
const sentOutboxId = `${runId}-outbox-sent`;
const skippedOutboxId = `${runId}-outbox-skipped`;
const mainDispatchId = `${runId}-dispatch-main`;
const sentDispatchId = `${runId}-dispatch-sent`;
const skippedDispatchId = `${runId}-dispatch-skipped`;
const mainSlotId = `${runId}-slot-main`;
const sentSlotId = `${runId}-slot-sent`;
const skippedRejectedSlotId = `${runId}-slot-rejected`;
const skippedDeliveredSlotId = `${runId}-slot-delivered`;
const lookupMainId = `${runId}-lookup-main`;
const lookupSentId = `${runId}-lookup-sent`;
const auditOwnershipId = `${runId}-audit-ownership`;
const auditBaselineRevocationId = `${runId}-audit-baseline-revocation`;
const c1AuditId = `${runId}-c1-revocation`;
const c2AuditId = `${runId}-c2-purge`;
const c3AuditId = `${runId}-c3-slot`;
const c4AuditId = `${runId}-c4-lookup`;
const c5AuditId = `${runId}-c5-nonce`;
const syntheticKey = randomBytes(32);
const dryRunConfig = { mode: "dry-run", enabled: false, provider: "solapi", environment: "preview" } as const;
const liveConfig = { mode: "live", enabled: true, provider: "solapi", environment: "preview" } as const;
const policy = { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null } as const;
const quote = { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const;
const MODELS = ["NotificationRecipientRegistration", "NotificationDispatch", "NotificationAudit", "NotificationBudgetPeriod", "NotificationCostReservation", "NotificationRuntimeConfig"];
const TABLES = ["User", "NotificationRuntimeConfig", "NotificationRecipientRegistration", "ReservationApplicationSubmission", "NotificationOutbox", "NotificationDispatch", "NotificationCostReservation", "NotificationBudgetPeriod", "NotificationAudit"];

const maint = new PrismaClient();
const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
const restoreScoped = target.$extends({
  query: {
    notificationOutbox: {
      findMany({ args, query }) {
        return query({ ...args, where: { AND: [args.where ?? {}, { id: pendingOutboxId }] } });
      },
    },
  },
});

type Ledger = {
  runId: string;
  capturedAt: string;
  revocations: { registrationId: string; revokedAt: string; auditEventId: string }[];
  destructions: { registrationId: string; tombstone: string; purgedAt: string; auditEventId: string }[];
  slotStates: { slotId: string; from: string; to: string; at: string }[];
  budgetStates: { periodType: string; periodKey: string; reservedMilliKrw: string; confirmedMilliKrw: string; lookupReservedMilliKrw: string; lookupConfirmedMilliKrw: string }[];
  nonceHighWater: { before: string; after: string } | null;
  auditRefs: string[];
  sourceSnapshot: Record<string, number>;
  purgeCompletion: null;
  mismatchNotes: string[];
  reviewNotes: string[];
};

type RestoreEvidence = {
  recipients: { id: string; state: string; ciphertext: Buffer | null; purgedAt: Date | null }[];
  backupRecipients: { id: string; state: string }[];
  audits: { eventId: string }[];
  slots: { id: string; status: string }[];
  backupSlots: { id: string; status: string }[];
  budgets: { periodType: string; periodKey: string; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint }[];
  runtime: { nonceHighWater: bigint } | null;
};

type GateDecision = { ok: boolean; reason: string };
type GateResult = {
  revocation: GateDecision;
  purge: GateDecision;
  slots: GateDecision;
  budget: GateDecision;
  nonce: GateDecision;
  activation: GateDecision;
  recoveryVerified: boolean;
};

/**
 * Test-local reconciliation gate. It is NOT product code: it encodes the plan's
 * restore rules (backup baseline + ledger deltas) and computes every decision
 * from actual restore-DB reads and ledger contents. Tampering the ledger must
 * flip decisions to refused, which the F cases prove; nothing here hardcodes
 * a PASS.
 */
function reconcileRestore(evidence: RestoreEvidence, ledger: Ledger | null, approverEvidence: unknown): GateResult {
  const empty =
    !ledger ||
    (ledger.revocations.length === 0 &&
      ledger.destructions.length === 0 &&
      ledger.slotStates.length === 0 &&
      ledger.budgetStates.length === 0 &&
      ledger.auditRefs.length === 0 &&
      ledger.nonceHighWater === null);
  const missing = (reason: string): GateDecision => ({ ok: false, reason });
  let revocation: GateDecision;
  let purge: GateDecision;
  let slots: GateDecision;
  let budget: GateDecision;
  let nonce: GateDecision;
  if (empty) {
    revocation = missing("ledger_missing");
    purge = missing("ledger_missing");
    slots = missing("ledger_missing");
    budget = missing("ledger_missing");
    nonce = missing("ledger_missing");
  } else {
    const revProblems: string[] = [];
    for (const r of ledger.revocations) {
      const rec = evidence.recipients.find((candidate) => candidate.id === r.registrationId);
      if (!rec) revProblems.push(`revocation_recipient_missing:${r.registrationId}`);
      else if (rec.state === "active") revProblems.push(`revocation_reapply_required:${r.registrationId}`);
      else if (rec.state === "revoked" && !evidence.audits.some((a) => a.eventId === r.auditEventId)) revProblems.push(`revocation_audit_missing:${r.registrationId}`);
    }
    for (const rec of evidence.recipients) {
      const wasActive = evidence.backupRecipients.find((b) => b.id === rec.id)?.state === "active";
      if (rec.state === "revoked" && wasActive && !ledger.revocations.some((r) => r.registrationId === rec.id)) {
        revProblems.push(`revocation_evidence_missing:${rec.id}`);
      }
    }
    revocation = revProblems.length > 0 ? missing(revProblems[0]!) : { ok: true, reason: "revocation_matched" };
    const purgeProblems: string[] = [];
    for (const d of ledger.destructions) {
      const expected = createHash("sha256").update(JSON.stringify([d.registrationId, d.purgedAt, d.auditEventId])).digest("hex");
      if (expected !== d.tombstone) {
        purgeProblems.push(`tombstone_mismatch:${d.registrationId}`);
        continue;
      }
      const rec = evidence.recipients.find((candidate) => candidate.id === d.registrationId);
      if (!rec) purgeProblems.push(`purge_recipient_missing:${d.registrationId}`);
      else if (rec.ciphertext !== null) purgeProblems.push(`purge_reapply_required:${d.registrationId}`);
      else if (rec.purgedAt === null || !evidence.audits.some((a) => a.eventId === d.auditEventId)) purgeProblems.push(`purge_audit_missing:${d.registrationId}`);
    }
    for (const rec of evidence.recipients) {
      if (rec.ciphertext === null && rec.purgedAt !== null && !ledger.destructions.some((d) => d.registrationId === rec.id)) {
        purgeProblems.push(`purge_evidence_missing:${rec.id}`);
      }
    }
    purge = purgeProblems.length > 0 ? missing(purgeProblems[0]!) : { ok: true, reason: "purge_matched" };
    const slotProblems: string[] = [];
    for (const s of ledger.slotStates) {
      const slot = evidence.slots.find((candidate) => candidate.id === s.slotId);
      if (!slot) slotProblems.push(`slot_missing:${s.slotId}`);
      else if (slot.status !== s.to) slotProblems.push(`slot_state_mismatch:${s.slotId}`);
    }
    for (const slot of evidence.slots) {
      const backup = evidence.backupSlots.find((b) => b.id === slot.id);
      if (backup && backup.status !== slot.status && !ledger.slotStates.some((s) => s.slotId === slot.id)) {
        slotProblems.push(`slot_evidence_missing:${slot.id}`);
      }
    }
    slots = slotProblems.length > 0 ? missing(slotProblems[0]!) : { ok: true, reason: "slots_matched" };
    const budgetProblems: string[] = [];
    for (const b of ledger.budgetStates) {
      const row = evidence.budgets.find((candidate) => candidate.periodType === b.periodType && candidate.periodKey === b.periodKey);
      if (!row) budgetProblems.push(`budget_missing:${b.periodType}:${b.periodKey}`);
      else if (
        row.reservedMilliKrw.toString() !== b.reservedMilliKrw ||
        row.confirmedMilliKrw.toString() !== b.confirmedMilliKrw ||
        row.lookupReservedMilliKrw.toString() !== b.lookupReservedMilliKrw ||
        row.lookupConfirmedMilliKrw.toString() !== b.lookupConfirmedMilliKrw
      ) {
        budgetProblems.push(`budget_state_mismatch:${b.periodType}:${b.periodKey}`);
      }
    }
    budget = budgetProblems.length > 0 ? missing(budgetProblems[0]!) : { ok: true, reason: "budget_matched" };
    const after = BigInt(ledger.nonceHighWater?.after ?? "-1");
    const counter = evidence.runtime?.nonceHighWater;
    if (counter === undefined || counter === null) nonce = missing("nonce_missing");
    else if (after < counter) nonce = missing("nonce_reversed");
    else if (counter < after) nonce = missing("nonce_behind");
    else nonce = { ok: true, reason: "nonce_matched" };
  }
  const activation: GateDecision =
    approverEvidence === null || approverEvidence === undefined
      ? missing("approval_missing")
      : { ok: false, reason: "activation_not_performed" };
  return { revocation, purge, slots, budget, nonce, activation, recoveryVerified: nonce.ok };
}

const S: {
  pgDumpVersion: string;
  pgRestoreVersion: string;
  sourceHistory: { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[];
  backupCounts: Record<string, number> | null;
  backupRows: Record<string, unknown[]> | null;
  postCCounts: Record<string, number> | null;
  ledger: Ledger | null;
  pristineLedger: Ledger | null;
  gatePass: boolean;
  created: { source: boolean; target: boolean };
  dump: { startedAt: string; finishedAt: string; bytes: number; sha256: string } | null;
  restore: { startedAt: string; finishedAt: string; ms: number } | null;
  pendingInput: ReturnType<typeof buildOutboxInput> | null;
  mainContext: {
    event: "application.received";
    audience: "admin";
    dedupeKey: string;
    recipientId: string;
    recipientVersion: string;
    submittedAt: Date;
    templateId: "mock_application_received_v1";
    templateVersion: "g2-v1";
    variables: { 접수시각: string };
  } | null;
} = {
  pgDumpVersion: "",
  pgRestoreVersion: "",
  sourceHistory: [],
  backupCounts: null,
  backupRows: null,
  postCCounts: null,
  ledger: null,
  pristineLedger: null,
  gatePass: false,
  created: { source: false, target: false },
  dump: null,
  restore: null,
  pendingInput: null,
  mainContext: null,
};

function sanitize(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.includes("://") && !/PGPASSWORD|password\s*=/i.test(line))
    .join("\n");
}

function runTool(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number } = {}): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: options.timeout ?? 120000, cwd: options.cwd, env: options.env });
  } catch (error) {
    const failure = error as { status?: number; stdout?: unknown; stderr?: unknown; message?: string };
    throw new Error(
      `[restore tool] ${command} failed (exit ${failure.status ?? "unknown"}): ${sanitize(String(failure.stderr ?? failure.stdout ?? failure.message ?? ""))}`.trim(),
    );
  }
}

// CI runners may already ship a newer PostgreSQL client on PATH (the Debian
// pg_wrapper picks the newest major), while the B3 assertions require 16.x.
// Prefer the versioned 16 binaries when present; fall back to the PATH name
// so a missing 16 install still fails loudly in beforeAll instead of silently
// using another major. This changes tool resolution only, never the dump,
// restore, gate, or assertion semantics.
function resolvePgTool(name: "pg_dump" | "pg_restore"): string {
  const versioned = `/usr/lib/postgresql/16/bin/${name}`;
  return existsSync(versioned) ? versioned : name;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function statMode(path: string): number {
  return statSync(path).mode & 0o777;
}

async function tableCounts(client: PrismaClient): Promise<Record<string, number>> {
  const rows = await client.$queryRaw<{ table_name: string; count: bigint }[]>`SELECT 'User' AS table_name, count(*)::bigint AS count FROM "User" UNION ALL SELECT 'NotificationRuntimeConfig', count(*)::bigint FROM "NotificationRuntimeConfig" UNION ALL SELECT 'NotificationRecipientRegistration', count(*)::bigint FROM "NotificationRecipientRegistration" UNION ALL SELECT 'ReservationApplicationSubmission', count(*)::bigint FROM "ReservationApplicationSubmission" UNION ALL SELECT 'NotificationOutbox', count(*)::bigint FROM "NotificationOutbox" UNION ALL SELECT 'NotificationDispatch', count(*)::bigint FROM "NotificationDispatch" UNION ALL SELECT 'NotificationCostReservation', count(*)::bigint FROM "NotificationCostReservation" UNION ALL SELECT 'NotificationBudgetPeriod', count(*)::bigint FROM "NotificationBudgetPeriod" UNION ALL SELECT 'NotificationAudit', count(*)::bigint FROM "NotificationAudit"`;
  return Object.fromEntries(rows.map((row) => [row.table_name, Number(row.count)]));
}

async function snapshotRows(client: PrismaClient): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const order = table === "NotificationRuntimeConfig" ? `"environment"` : `"id"`;
    out[table] = await client.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM ${Prisma.raw(`"${table}"`)} ORDER BY ${Prisma.raw(order)}`);
  }
  return out;
}

async function restoreEvidence(client: PrismaClient): Promise<RestoreEvidence> {
  const recipients = await client.$queryRaw<RestoreEvidence["recipients"]>`SELECT "id", "state", "ciphertext", "purgedAt" FROM "NotificationRecipientRegistration" ORDER BY "id"`;
  const audits = await client.$queryRaw<RestoreEvidence["audits"]>`SELECT "eventId" FROM "NotificationAudit" ORDER BY "eventId"`;
  const slots = await client.$queryRaw<RestoreEvidence["slots"]>`SELECT "id", "status" FROM "NotificationCostReservation" WHERE "entryKind" = 'SEND_SLOT' ORDER BY "id"`;
  const budgets = await client.$queryRaw<RestoreEvidence["budgets"]>`SELECT "periodType", "periodKey", "reservedMilliKrw", "confirmedMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" ORDER BY "periodType", "periodKey"`;
  const [runtime] = await client.$queryRaw<RestoreEvidence["runtime"][]>`SELECT "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
  const backupRecipients = ((S.backupRows?.["NotificationRecipientRegistration"] ?? []) as { id: string; state: string }[]).map((row) => ({ id: row.id, state: row.state }));
  const backupSlots = ((S.backupRows?.["NotificationCostReservation"] ?? []) as { id: string; status: string; entryKind: string }[])
    .filter((row) => row.entryKind === "SEND_SLOT")
    .map((row) => ({ id: row.id, status: row.status }));
  return { recipients, backupRecipients, audits, slots, backupSlots, budgets, runtime: runtime ?? null };
}

function cloneLedger(ledger: Ledger): Ledger {
  return JSON.parse(JSON.stringify(ledger)) as Ledger;
}

function requirePhase(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[restore phase] prerequisite missing: ${message}`);
}

async function probeWorkerNoSend(expectedOutcomes: unknown[]): Promise<void> {
  const provider = new MockProvider({ code: "S_UNKNOWN" });
  const spy = vi.spyOn(MockProvider.prototype, "send");
  try {
    const repository = new PrismaDispatchRepository(restoreScoped as unknown as PrismaGuardClient);
    const store = new PrismaOutboxStore(restoreScoped);
    const result = await processOutboxBatch(store, {
      provider: null,
      now: at,
      safe: {
        repository,
        provider,
        clock: () => at,
        prepare: async () => ({
          dispatchId: mainDispatchId,
          context: S.mainContext!,
          syntheticKey: { key: syntheticKey, keyVersion, synthetic: true as const },
          config: dryRunConfig,
          policy,
          quote,
        }),
      },
    });
    expect(result.outcomes).toEqual(expectedOutcomes);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
}

async function cleanupFixtureRows(client: PrismaClient): Promise<void> {
  // FK order from the plan: audits -> corrections -> lookups -> slots ->
  // dispatches -> recipients -> budget/runtime -> outboxes -> submissions -> users.
  // The databases are dropped afterwards; this order exists so a partial
  // cleanup never bypasses a constraint.
  // A database whose restore never ran has no tables at all: a missing-table
  // (42P01) DELETE is skipped and logged, so a failed restore cannot turn
  // cleanup into a second failure. Any other error still throws, and the
  // DROP DATABASE + deletion verification in afterAll still run, so a skip
  // can never hide leftover data.
  const del = async (table: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "42P01" || message.includes("42P01")) {
        console.log(JSON.stringify({ restoreCleanupSkip: table, code: "42P01" }));
        return;
      }
      throw error;
    }
  };
  await del("NotificationAudit", () => client.$executeRaw`DELETE FROM "NotificationAudit"`);
  await del("NotificationCostReservation:COST_CORRECTION", () => client.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "entryKind" = 'COST_CORRECTION'`);
  await del("NotificationCostReservation:LOOKUP_COST", () => client.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "entryKind" = 'LOOKUP_COST'`);
  await del("NotificationCostReservation:SEND_SLOT", () => client.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "entryKind" = 'SEND_SLOT'`);
  await del("NotificationDispatch", () => client.$executeRaw`DELETE FROM "NotificationDispatch"`);
  await del("NotificationRecipientRegistration", () => client.$executeRaw`DELETE FROM "NotificationRecipientRegistration"`);
  await del("NotificationBudgetPeriod", () => client.$executeRaw`DELETE FROM "NotificationBudgetPeriod"`);
  await del("NotificationRuntimeConfig", () => client.$executeRaw`DELETE FROM "NotificationRuntimeConfig"`);
  await del("NotificationOutbox", () => client.$executeRaw`DELETE FROM "NotificationOutbox"`);
  await del("ReservationApplicationSubmission", () => client.$executeRaw`DELETE FROM "ReservationApplicationSubmission"`);
  await del("User", () => client.$executeRaw`DELETE FROM "User"`);
}

function runDump(): void {
  // The derived-URL gate runs inside the dump step itself: a failed gate must
  // prevent pg_dump from starting at all.
  assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", sourceUrl, sourceDb);
  S.gatePass = true;
  const startedAt = new Date().toISOString();
  runTool(resolvePgTool("pg_dump"), ["-Fc", "-h", sourceMeta.host, "-p", sourceMeta.port, "-U", sourceMeta.user, "-d", sourceDb, "-f", dumpPath], {
    env: { ...process.env, PGPASSWORD: pgPassword },
    timeout: 300000,
  });
  // pg_dump creates the file under the runner's umask (typically 0644), so
  // the 0600 mode the B4 assertion requires must be set explicitly here.
  chmodSync(dumpPath, 0o600);
  const finishedAt = new Date().toISOString();
  S.dump = { startedAt, finishedAt, bytes: statSync(dumpPath).size, sha256: sha256File(dumpPath) };
}

beforeAll(async () => {
  // Tool presence first: without pg_dump/pg_restore there is no real backup
  // evidence, and silently substituting serialization is forbidden.
  try {
    S.pgDumpVersion = runTool(resolvePgTool("pg_dump"), ["--version"]).trim();
  } catch {
    throw new Error("[restore setup] pg_dump is not available. The CI temp branch must install postgresql-client-16 before running this file (plan §3.5); object serialization is not a substitute.");
  }
  try {
    S.pgRestoreVersion = runTool(resolvePgTool("pg_restore"), ["--version"]).trim();
  } catch {
    throw new Error("[restore setup] pg_restore is not available. The CI temp branch must install postgresql-client-16 before running this file (plan §3.5); object serialization is not a substitute.");
  }
  const [service] = await maint.$queryRaw<{ version: string }[]>`SELECT version()`;
  assertRestoreServiceVersion(service!.version);
  const existing = await maint.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database`;
  const allowed = new Set(["postgres", "template0", "template1", "yaho_e2e"]);
  for (const row of existing) {
    if (!allowed.has(row.datname)) throw new Error(`[restore setup] unexpected database present on the CI service: ${row.datname}.`);
  }
  await maint.$executeRaw(Prisma.sql`CREATE DATABASE ${Prisma.raw(`"${sourceDb}"`)}`);
  S.created.source = true;
  await maint.$executeRaw(Prisma.sql`CREATE DATABASE ${Prisma.raw(`"${targetDb}"`)}`);
  S.created.target = true;
  mkdirSync(tmpDir, { mode: 0o700, recursive: true });
  expect(statMode(tmpDir)).toBe(0o700);
  runTool("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: sourceUrl, DIRECT_URL: sourceUrl },
    timeout: 300000,
  });
  const migrationDir = join(process.cwd(), "prisma", "migrations");
  const dirs = (await readdir(migrationDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const history = await source.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; started_at: Date }[]>`SELECT migration_name, checksum, finished_at, rolled_back_at, started_at FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
  expect(history.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true);
  expect(history.map((row) => row.migration_name)).toEqual(dirs);
  for (const row of history) {
    const sql = await readFile(join(migrationDir, row.migration_name, "migration.sql"));
    expect(row.checksum).toBe(createHash("sha256").update(sql).digest("hex"));
  }
  S.sourceHistory = history.map((row) => ({ migration_name: row.migration_name, checksum: row.checksum, finished_at: row.finished_at, rolled_back_at: row.rolled_back_at }));
}, 300000);

afterAll(async () => {
  // Phase 1: fixture rows, disconnects, DROP. Errors are recorded, not thrown
  // yet, so a DROP failure cannot skip the file/key cleanup in phase 2.
  let cleanupError: unknown = null;
  try {
    try {
      if (S.created.source) await cleanupFixtureRows(source);
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (S.created.target) await cleanupFixtureRows(target);
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }
    await source.$disconnect();
    await target.$disconnect();
    if (S.created.source || S.created.target) {
      await maint.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${sourceDb}, ${targetDb}) AND pid <> pg_backend_pid()`;
      if (S.created.source) await maint.$executeRaw(Prisma.sql`DROP DATABASE ${Prisma.raw(`"${sourceDb}"`)} WITH (FORCE)`);
      if (S.created.target) await maint.$executeRaw(Prisma.sql`DROP DATABASE ${Prisma.raw(`"${targetDb}"`)} WITH (FORCE)`);
    }
  } catch (error) {
    cleanupError = cleanupError ?? error;
  }
  // Phase 2: always runs, even when phase 1 failed. Each step is attempted
  // independently so one deletion failure cannot skip the key wipe.
  for (const cleanup of [
    () => rmSync(dumpPath, { force: true }),
    () => rmSync(mirrorPath, { force: true }),
    () => rmSync(tmpDir, { force: true, recursive: true }),
    () => syntheticKey.fill(0),
  ]) {
    try {
      cleanup();
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }
  }
  // Phase 3: deletion verification is mandatory, never assumed. A verification
  // failure is recorded like any other cleanup failure and fails the suite.
  try {
    if (S.created.source || S.created.target) {
      const remaining = await maint.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname IN (${sourceDb}, ${targetDb})`;
      expect(remaining).toEqual([]);
      for (const url of [sourceUrl, targetUrl]) {
        const probe = new PrismaClient({ datasources: { db: { url } } });
        try {
          await expect(probe.$queryRaw`SELECT 1`).rejects.toThrow();
        } finally {
          await probe.$disconnect();
        }
      }
    }
    expect(existsSync(dumpPath)).toBe(false);
    expect(existsSync(mirrorPath)).toBe(false);
    expect(existsSync(tmpDir)).toBe(false);
  } catch (error) {
    cleanupError = cleanupError ?? error;
  } finally {
    await maint.$disconnect();
  }
  if (cleanupError === null) {
    console.log(
      JSON.stringify(
        {
          runId,
          sourceDb,
          targetDb,
          dumpSha256: S.dump?.sha256 ?? null,
          dumpBytes: S.dump?.bytes ?? null,
          restoreMs: S.restore?.ms ?? null,
          backupCounts: S.backupCounts,
          deletedVerified: true,
        },
        null,
        2,
      ),
    );
    return;
  }
  // Nothing is swallowed: a DROP, deletion, or verification failure recorded
  // above surfaces as a suite failure after cleanup and verification ran.
  console.log(JSON.stringify({ runId, fixtureCleanupWarning: String(cleanupError) }));
  throw cleanupError;
});

describe.sequential("G2 restore PostgreSQL evidence", () => {
  it("A1 records the runtime OFF baseline (dry-run config, explicit OFF flag)", async () => {
    await source.$executeRaw`INSERT INTO "NotificationRuntimeConfig" ("environment", "namespace", "blocked", "activationEpoch", "providerId", "recipientVersion", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "updatedAt") VALUES ('preview', ${namespace}, false, ${at}, 'solapi', 'v1', 'g2-v1', 'g2-v1', 'g2-v1', ${keyVersion}, ${100n}, true, true, true, ${at})`;
    const [row] = await source.$queryRaw<{ environment: string; blocked: boolean; nonceHighWater: bigint; keyVersion: string | null }[]>`SELECT "environment", "blocked", "nonceHighWater", "keyVersion" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    expect(row).toMatchObject({ environment: "preview", blocked: false, nonceHighWater: 100n, keyVersion });
    expect(
      evaluateSendGate({
        config: dryRunConfig,
        runtime: { blocked: row!.blocked, environment: "preview", provider: "solapi", activationEpoch: at },
        policy,
        occurredAt: at,
      }),
    ).toEqual({ allowed: false, reason: "send_disabled" });
    expect(isExplicitSendDisabled(dryRunConfig, policy)).toBe(true);
  }, 60000);

  it("A2 records one active and one revoked synthetic recipient", async () => {
    await source.user.create({ data: { id: userActive, email: `${userActive}@example.test`, name: "synthetic", role: "ADMIN" } });
    await source.user.create({ data: { id: userRevoked, email: `${userRevoked}@example.test`, name: "synthetic", role: "ADMIN" } });
    const encrypted = encryptSyntheticRecipient(
      Buffer.from("synthetic-recipient"),
      syntheticKey,
      1n,
      { environment: "preview", registrationId: recipientActive, registrationVersion: "v1", keyVersion },
      { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true },
    );
    await source.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt") VALUES (${recipientActive}, 'preview', 'application.received', ${userActive}, 'v1', 'active', 'v1', 'v1', ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${keyVersion}, 'synthetic_call', 'mock_ownership_v1', ${userActive}, ${at})`;
    await source.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "revokedAt") VALUES (${recipientRevoked}, 'preview', 'application.received', ${userRevoked}, 'v1', 'revoked', 'v1', 'v1', ${at})`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${auditOwnershipId}, ${auditOwnershipId}, 'preview', ${recipientActive}, 'synthetic_ownership_confirmed', 'v1', ${userActive}, 'mock_ownership_v1', ${at})`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${auditBaselineRevocationId}, ${auditBaselineRevocationId}, 'preview', ${recipientRevoked}, 'recipient_revoked', 'revoked', ${userActive}, ${`${runId}-baseline-revocation`}, ${at})`;
    const rows = await source.$queryRaw<{ id: string; state: string; version: string }[]>`SELECT "id", "state", "version" FROM "NotificationRecipientRegistration" ORDER BY "id"`;
    expect(rows).toEqual([
      { id: recipientActive, state: "active", version: "v1" },
      { id: recipientRevoked, state: "revoked", version: "v1" },
    ]);
    const audits = await source.$queryRaw<{ eventId: string; eventType: string }[]>`SELECT "eventId", "eventType" FROM "NotificationAudit" ORDER BY "eventId"`;
    expect(audits).toEqual([
      { eventId: auditBaselineRevocationId, eventType: "recipient_revoked" },
      { eventId: auditOwnershipId, eventType: "synthetic_ownership_confirmed" },
    ]);
  }, 60000);

  it("A3 records pending, sent and terminally skipped outboxes with dispatches", async () => {
    // entityId must satisfy outboxInputSchema: a cuid-like `c...` id or a
    // `phase8_<uuid>` id. The previous `${runId}-sub-*` ids matched neither
    // and failed parseOutboxInput before any row was created.
    const pendingInput = buildOutboxInput("application.received", `phase8_${randomUUID()}`, "created", "admin", at);
    const sentInput = buildOutboxInput("application.received", `phase8_${randomUUID()}`, "created", "admin", at);
    const skippedInput = buildOutboxInput("application.received", `phase8_${randomUUID()}`, "created", "admin", at);
    S.pendingInput = pendingInput;
    S.mainContext = {
      event: "application.received",
      audience: "admin",
      dedupeKey: pendingInput.dedupeKey,
      recipientId: recipientActive,
      recipientVersion: "v1",
      submittedAt: at,
      templateId: "mock_application_received_v1",
      templateVersion: "g2-v1",
      variables: { 접수시각: "2040-01-01 09:00" },
    };
    for (const input of [pendingInput, sentInput, skippedInput]) {
      await source.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "synthetic", submittedAt: at } });
    }
    await source.notificationOutbox.create({ data: { ...pendingInput, id: pendingOutboxId } });
    await source.notificationOutbox.create({ data: { ...sentInput, id: sentOutboxId, status: "sent" } });
    await source.notificationOutbox.create({ data: { ...skippedInput, id: skippedOutboxId, status: "skipped", lastErrorCode: "send_disabled" } });
    await source.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion", "slotCount") VALUES (${mainDispatchId}, ${pendingOutboxId}, 'preview', ${`${namespace}:${pendingInput.dedupeKey}`}, 'solapi', ${recipientActive}, 'v1', 'mock_application_received_v1', 'g2-v1', ${at}, 'ready', 'g2-v1', 0)`;
    await source.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion", "slotCount") VALUES (${sentDispatchId}, ${sentOutboxId}, 'preview', ${`${namespace}:${sentInput.dedupeKey}`}, 'solapi', ${recipientActive}, 'v1', 'mock_application_received_v1', 'g2-v1', ${at}, 'awaiting_final', 'g2-v1', 0)`;
    await source.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion", "slotCount") VALUES (${skippedDispatchId}, ${skippedOutboxId}, 'preview', ${`${namespace}:${skippedInput.dedupeKey}`}, 'solapi', ${recipientActive}, 'v1', 'mock_application_received_v1', 'g2-v1', ${at}, 'rejected', 'g2-v1', 0)`;
    const outboxes = await source.$queryRaw<{ id: string; status: string; dedupeKey: string }[]>`SELECT "id", "status", "dedupeKey" FROM "NotificationOutbox" ORDER BY "id"`;
    expect(outboxes).toEqual([
      { id: pendingOutboxId, status: "pending", dedupeKey: pendingInput.dedupeKey },
      { id: sentOutboxId, status: "sent", dedupeKey: sentInput.dedupeKey },
      { id: skippedOutboxId, status: "skipped", dedupeKey: skippedInput.dedupeKey },
    ]);
    const dispatches = await source.$queryRaw<{ id: string; outboxId: string; reconciliationState: string }[]>`SELECT "id", "outboxId", "reconciliationState" FROM "NotificationDispatch" ORDER BY "id"`;
    expect(dispatches).toEqual([
      { id: mainDispatchId, outboxId: pendingOutboxId, reconciliationState: "ready" },
      { id: sentDispatchId, outboxId: sentOutboxId, reconciliationState: "awaiting_final" },
      { id: skippedDispatchId, outboxId: skippedOutboxId, reconciliationState: "rejected" },
    ]);
  }, 60000);

  it("A4 records in_flight, accepted, rejected and settled slot usage", async () => {
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${mainSlotId}, ${mainDispatchId}, 1, 'in_flight', ${at}, '2040-01-01', '2040-01', ${15000n}, 'reserved_unknown')`;
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${sentSlotId}, ${sentDispatchId}, 1, 'accepted', ${at}, '2040-01-01', '2040-01', ${15000n}, 'reserved')`;
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${skippedRejectedSlotId}, ${skippedDispatchId}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', ${0n}, ${500n}, 'settled')`;
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${skippedDeliveredSlotId}, ${skippedDispatchId}, 2, 'delivered', ${at}, '2040-01-01', '2040-01', ${0n}, ${14300n}, 'settled')`;
    await source.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount" = 1 WHERE "id" IN (${mainDispatchId}, ${sentDispatchId})`;
    await source.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount" = 2 WHERE "id" = ${skippedDispatchId}`;
    const slots = await source.$queryRaw<{ id: string; status: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; costState: string }[]>`SELECT "id", "status", "reservedMilliKrw", "confirmedMilliKrw", "costState" FROM "NotificationCostReservation" WHERE "entryKind" = 'SEND_SLOT' ORDER BY "id"`;
    expect(slots).toEqual([
      { id: skippedDeliveredSlotId, status: "delivered", reservedMilliKrw: 0n, confirmedMilliKrw: 14300n, costState: "settled" },
      { id: mainSlotId, status: "in_flight", reservedMilliKrw: 15000n, confirmedMilliKrw: null, costState: "reserved_unknown" },
      { id: skippedRejectedSlotId, status: "rejected", reservedMilliKrw: 0n, confirmedMilliKrw: 500n, costState: "settled" },
      { id: sentSlotId, status: "accepted", reservedMilliKrw: 15000n, confirmedMilliKrw: null, costState: "reserved" },
    ]);
    const counts = await source.$queryRaw<{ id: string; slotCount: number }[]>`SELECT "id", "slotCount" FROM "NotificationDispatch" ORDER BY "id"`;
    expect(counts).toEqual([
      { id: mainDispatchId, slotCount: 1 },
      { id: sentDispatchId, slotCount: 1 },
      { id: skippedDispatchId, slotCount: 2 },
    ]);
  }, 60000);

  it("A5 records day and month budget reservations", async () => {
    for (const [periodType, periodKey] of [["day", "2040-01-01"], ["month", "2040-01"]] as const) {
      await source.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion", "requestCount", "reservedMilliKrw", "confirmedMilliKrw", "carryMilliKrw", "otherMilliKrw", "revision", "planApplied", "archivedConfirmedMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw", "lookupCarryMilliKrw", "lookupArchivedConfirmedMilliKrw") VALUES (${`${runId}-budget-${periodType}`}, 'preview', 'application.received', ${periodType}, ${periodKey}, 'g2-v1', 3, ${30000n}, ${500n}, ${0n}, ${0n}, 0, false, ${0n}, ${500n}, ${500n}, ${0n}, ${0n})`;
    }
    const rows = await source.$queryRaw<{ periodType: string; periodKey: string; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint }[]>`SELECT "periodType", "periodKey", "reservedMilliKrw", "confirmedMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" ORDER BY "periodType"`;
    expect(rows).toEqual([
      { periodType: "day", periodKey: "2040-01-01", reservedMilliKrw: 30000n, confirmedMilliKrw: 500n, lookupReservedMilliKrw: 500n, lookupConfirmedMilliKrw: 500n },
      { periodType: "month", periodKey: "2040-01", reservedMilliKrw: 30000n, confirmedMilliKrw: 500n, lookupReservedMilliKrw: 500n, lookupConfirmedMilliKrw: 500n },
    ]);
  }, 60000);

  it("A6 records one settled and one unresolved cost lookup", async () => {
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookupMainId}, ${mainDispatchId}, 'LOOKUP_COST', ${lookupMainId}, ${mainSlotId}, 'unknown', ${at}, '2040-01-01', '2040-01', ${500n}, 'reserved_unknown')`;
    await source.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${lookupSentId}, ${sentDispatchId}, 'LOOKUP_COST', ${lookupSentId}, ${sentSlotId}, 'resolved', ${at}, '2040-01-01', '2040-01', ${0n}, ${500n}, 'settled')`;
    const rows = await source.$queryRaw<{ id: string; status: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; costState: string }[]>`SELECT "id", "status", "reservedMilliKrw", "confirmedMilliKrw", "costState" FROM "NotificationCostReservation" WHERE "entryKind" = 'LOOKUP_COST' ORDER BY "id"`;
    expect(rows).toEqual([
      { id: lookupMainId, status: "unknown", reservedMilliKrw: 500n, confirmedMilliKrw: null, costState: "reserved_unknown" },
      { id: lookupSentId, status: "resolved", reservedMilliKrw: 0n, confirmedMilliKrw: 500n, costState: "settled" },
    ]);
  }, 60000);

  it("A7 records pre-purge personal-data fields (synthetic ciphertext only)", async () => {
    const [row] = await source.$queryRaw<{ ciphertext: Buffer | null; nonce: Buffer | null; tag: Buffer | null }[]>`SELECT "ciphertext", "nonce", "tag" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipientActive}`;
    expect(row!.ciphertext).not.toBeNull();
    expect(row!.nonce).not.toBeNull();
    expect(row!.tag).not.toBeNull();
    // The stored ciphertext decrypts with the synthetic key only; no real
    // number or key material is involved, and this row is the C2 purge target.
    // $queryRaw returns bytea as Uint8Array, not Buffer, so Buffer.isBuffer
    // inside decrypt rejects the raw values; normalize exactly as the
    // product's own dispatch-guard does before decrypting.
    expect(
      decryptSyntheticRecipient(
        { ciphertext: Buffer.from(row!.ciphertext!), nonce: Buffer.from(row!.nonce!), tag: Buffer.from(row!.tag!) },
        syntheticKey,
        { environment: "preview", registrationId: recipientActive, registrationVersion: "v1", keyVersion },
        { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true },
      ).toString("utf8"),
    ).toBe("synthetic-recipient");
  }, 60000);

  it("A8 records the nonce high-water baseline", async () => {
    const [row] = await source.$queryRaw<{ nonceHighWater: bigint; keyVersion: string | null }[]>`SELECT "nonceHighWater", "keyVersion" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    expect(row).toMatchObject({ nonceHighWater: 100n, keyVersion });
  }, 60000);

  it("A9 freezes the backup snapshot (counts and full rows, derived from A1-A8)", async () => {
    S.backupCounts = await tableCounts(source);
    S.backupRows = await snapshotRows(source);
    expect(S.backupCounts).toEqual({
      User: 2,
      NotificationRuntimeConfig: 1,
      NotificationRecipientRegistration: 2,
      ReservationApplicationSubmission: 3,
      NotificationOutbox: 3,
      NotificationDispatch: 3,
      NotificationCostReservation: 6,
      NotificationBudgetPeriod: 2,
      NotificationAudit: 2,
    });
    expect(S.backupRows["NotificationCostReservation"]).toHaveLength(6);
    expect(S.backupRows["NotificationAudit"]).toHaveLength(2);
  }, 60000);

  it("B1 executes the real pg_dump against the gated source database", async () => {
    requirePhase(S.backupCounts !== null, "backup snapshot from A9");
    runDump();
    expect(S.dump).not.toBeNull();
    expect(S.dump!.bytes).toBeGreaterThan(0);
    expect(S.dump!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(S.dump!.finishedAt).getTime()).toBeGreaterThanOrEqual(new Date(S.dump!.startedAt).getTime());
  }, 120000);

  it("B2 proves the derived-URL gate passes for this run and rejects tampered URLs", async () => {
    requirePhase(S.gatePass, "dump gate pass from B1");
    expect(assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", sourceUrl, sourceDb)).toMatchObject({
      host: sourceMeta.host,
      port: sourceMeta.port,
      database: sourceDb,
      user: sourceMeta.user,
    });
    expect(assertRestoreDatabaseUrl("RESTORE_TARGET_URL", targetUrl, targetDb)).toMatchObject({ database: targetDb });
    const tamper = (mutate: (url: URL) => void): string => {
      const url = new URL(sourceUrl);
      mutate(url);
      return url.toString();
    };
    expect(() => assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", tamper((url) => { url.pathname = "/yaho_e2e"; }), sourceDb)).toThrow();
    expect(() => assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", tamper((url) => { url.hostname = "db.example.supabase.co"; }), sourceDb)).toThrow();
    expect(() => assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", tamper((url) => { url.port = "5433"; }), sourceDb)).toThrow();
    expect(() => assertRestoreDatabaseUrl("RESTORE_SOURCE_URL", tamper((url) => { url.username = "postgres"; }), sourceDb)).toThrow();
  }, 60000);

  it("B3 records dump format, tool versions, service version and checksum", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    const magic = readFileSync(dumpPath).subarray(0, 5).toString("ascii");
    expect(magic).toBe("PGDMP");
    expect(S.pgDumpVersion).toMatch(/pg_dump \(PostgreSQL\) 16\./);
    expect(S.pgRestoreVersion).toMatch(/pg_restore \(PostgreSQL\) 16\./);
    const [service] = await source.$queryRaw<{ version: string }[]>`SELECT version()`;
    assertRestoreServiceVersion(service!.version);
    expect(sha256File(dumpPath)).toBe(S.dump!.sha256);
    expect(statSync(dumpPath).size).toBe(S.dump!.bytes);
  }, 60000);

  it("B4 confines the dump to a 0700 temp directory outside the repo, file 0600", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    expect(tmpDir.startsWith(tmpdir())).toBe(true);
    expect(tmpDir.startsWith(`${process.cwd()}/`)).toBe(false);
    expect(statMode(tmpDir)).toBe(0o700);
    expect(statMode(dumpPath)).toBe(0o600);
  }, 60000);

  it("B5 validates the dump without restoring (pg_restore --list)", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    const list = runTool(resolvePgTool("pg_restore"), ["--list", dumpPath]);
    for (const name of [...TABLES, "_prisma_migrations"]) {
      expect(list).toContain(name);
    }
  }, 60000);

  it("C1 revokes the active recipient after backup and fixes it in the ledger", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    await source.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'revoked', "revokedAt" = ${at2} WHERE "id" = ${recipientActive}`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${c1AuditId}, ${c1AuditId}, 'preview', ${recipientActive}, 'recipient_revoked', 'revoked', ${userActive}, ${c1AuditId}, ${at2})`;
    const [row] = await source.$queryRaw<{ state: string; revokedAt: Date | null }[]>`SELECT "state", "revokedAt" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipientActive}`;
    expect(row).toMatchObject({ state: "revoked", revokedAt: at2 });
    const audits = await source.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "eventId" = ${c1AuditId}`;
    expect(audits).toEqual([{ eventId: c1AuditId }]);
    S.ledger = {
      runId,
      capturedAt: at2.toISOString(),
      revocations: [{ registrationId: recipientActive, revokedAt: at2.toISOString(), auditEventId: c1AuditId }],
      destructions: [],
      slotStates: [],
      budgetStates: [],
      nonceHighWater: null,
      auditRefs: [],
      sourceSnapshot: S.backupCounts!,
      purgeCompletion: null,
      mismatchNotes: [],
      reviewNotes: [],
    };
  }, 60000);

  it("C2 purges the pre-purge fields after backup without claiming §8.5 completion", async () => {
    requirePhase(S.ledger !== null, "ledger from C1");
    await source.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "purgedAt" = ${at2} WHERE "id" = ${recipientActive}`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${c2AuditId}, ${c2AuditId}, 'preview', ${recipientActive}, 'recipient_purged', 'revoked', ${userActive}, ${c2AuditId}, ${at2})`;
    const [row] = await source.$queryRaw<{ ciphertext: Buffer | null; purgedAt: Date | null }[]>`SELECT "ciphertext", "purgedAt" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipientActive}`;
    expect(row!.ciphertext).toBeNull();
    expect(row!.purgedAt).toEqual(at2);
    const tombstone = createHash("sha256").update(JSON.stringify([recipientActive, at2.toISOString(), c2AuditId])).digest("hex");
    S.ledger!.destructions = [{ registrationId: recipientActive, tombstone, purgedAt: at2.toISOString(), auditEventId: c2AuditId }];
    // §8.5 completion is never claimed by this experiment: the purge ran, but
    // the five completion conditions are not proven here, so no flag exists.
    expect(S.ledger!.purgeCompletion).toBeNull();
  }, 60000);

  it("C3 finalizes the in_flight slot after backup and fixes it in the ledger", async () => {
    requirePhase(S.ledger !== null, "ledger from C1");
    await source.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'delivered', "providerRef" = ${ref}, "resultAt" = ${at2}, "reservedMilliKrw" = ${0n}, "confirmedMilliKrw" = ${15000n}, "costState" = 'settled' WHERE "id" = ${mainSlotId}`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "outboxId", "dispatchId", "slotId", "eventType", "actorId", "evidenceId", "occurredAt") VALUES (${c3AuditId}, ${c3AuditId}, 'preview', ${pendingOutboxId}, ${mainDispatchId}, ${mainSlotId}, 'result_recorded', ${userActive}, ${c3AuditId}, ${at2})`;
    const [row] = await source.$queryRaw<{ status: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; costState: string }[]>`SELECT "status", "reservedMilliKrw", "confirmedMilliKrw", "costState" FROM "NotificationCostReservation" WHERE "id" = ${mainSlotId}`;
    expect(row).toEqual({ status: "delivered", reservedMilliKrw: 0n, confirmedMilliKrw: 15000n, costState: "settled" });
    S.ledger!.slotStates = [{ slotId: mainSlotId, from: "in_flight", to: "delivered", at: at2.toISOString() }];
  }, 60000);

  it("C4 settles one lookup after backup and leaves the other unresolved", async () => {
    requirePhase(S.ledger !== null, "ledger from C1");
    await source.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'resolved', "reservedMilliKrw" = ${0n}, "confirmedMilliKrw" = ${500n}, "costState" = 'settled' WHERE "id" = ${lookupMainId}`;
    await source.$executeRaw`UPDATE "NotificationBudgetPeriod" SET "lookupReservedMilliKrw" = ${0n}, "lookupConfirmedMilliKrw" = ${1000n} WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'day' AND "periodKey" = '2040-01-01'`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "dispatchId", "slotId", "eventType", "actorId", "evidenceId", "occurredAt") VALUES (${c4AuditId}, ${c4AuditId}, 'preview', ${mainDispatchId}, ${lookupMainId}, 'lookup_reconciled', ${userActive}, ${c4AuditId}, ${at2})`;
    const [lookup] = await source.$queryRaw<{ status: string; reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; costState: string }[]>`SELECT "status", "reservedMilliKrw", "confirmedMilliKrw", "costState" FROM "NotificationCostReservation" WHERE "id" = ${lookupMainId}`;
    expect(lookup).toEqual({ status: "resolved", reservedMilliKrw: 0n, confirmedMilliKrw: 500n, costState: "settled" });
    const [day] = await source.$queryRaw<{ lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint }[]>`SELECT "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "periodType" = 'day' AND "periodKey" = '2040-01-01'`;
    expect(day).toEqual({ lookupReservedMilliKrw: 0n, lookupConfirmedMilliKrw: 1000n });
    const [sentSlot] = await source.$queryRaw<{ status: string }[]>`SELECT "status" FROM "NotificationCostReservation" WHERE "id" = ${sentSlotId}`;
    expect(sentSlot).toEqual({ status: "accepted" });
    const budgets = await source.$queryRaw<{ periodType: string; periodKey: string; reservedMilliKrw: bigint; confirmedMilliKrw: bigint; lookupReservedMilliKrw: bigint; lookupConfirmedMilliKrw: bigint }[]>`SELECT "periodType", "periodKey", "reservedMilliKrw", "confirmedMilliKrw", "lookupReservedMilliKrw", "lookupConfirmedMilliKrw" FROM "NotificationBudgetPeriod" ORDER BY "periodType"`;
    S.ledger!.budgetStates = budgets.map((row) => ({
      periodType: row.periodType,
      periodKey: row.periodKey,
      reservedMilliKrw: row.reservedMilliKrw.toString(),
      confirmedMilliKrw: row.confirmedMilliKrw.toString(),
      lookupReservedMilliKrw: row.lookupReservedMilliKrw.toString(),
      lookupConfirmedMilliKrw: row.lookupConfirmedMilliKrw.toString(),
    }));
  }, 60000);

  it("C5 advances the nonce high-water after backup and fixes it in the ledger", async () => {
    requirePhase(S.ledger !== null, "ledger from C1");
    await source.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "nonceHighWater" = ${101n} WHERE "environment" = 'preview'`;
    await source.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "actorId", "evidenceId", "occurredAt") VALUES (${c5AuditId}, ${c5AuditId}, 'preview', 'nonce_consumed', ${userActive}, ${c5AuditId}, ${at2})`;
    const [row] = await source.$queryRaw<{ nonceHighWater: bigint }[]>`SELECT "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    expect(row).toEqual({ nonceHighWater: 101n });
    S.ledger!.nonceHighWater = { before: "100", after: "101" };
  }, 60000);

  it("C6 proves every post-backup change has an audit row and mirrors the ledger", async () => {
    requirePhase(S.ledger !== null, "ledger from C1");
    const expected = [c1AuditId, c2AuditId, c3AuditId, c4AuditId, c5AuditId];
    const found = await source.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "eventId" IN (${c1AuditId}, ${c2AuditId}, ${c3AuditId}, ${c4AuditId}, ${c5AuditId}) ORDER BY "eventId"`;
    expect(found.map((row) => row.eventId).sort()).toEqual([...expected].sort());
    S.ledger!.auditRefs = expected;
    S.ledger!.capturedAt = at2.toISOString();
    writeFileSync(mirrorPath, JSON.stringify(S.ledger, null, 2), { mode: 0o600 });
    expect(statMode(mirrorPath)).toBe(0o600);
    expect(JSON.parse(readFileSync(mirrorPath, "utf8"))).toEqual(S.ledger);
    S.pristineLedger = cloneLedger(S.ledger!);
    S.postCCounts = await tableCounts(source);
    expect(S.postCCounts["NotificationAudit"]).toBe((S.backupCounts!["NotificationAudit"] ?? 0) + 5);
  }, 60000);

  it("D1 restores into the separate empty database without touching the source", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    requirePhase(S.postCCounts !== null, "post-backup source counts from C6");
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    runTool(resolvePgTool("pg_restore"), ["-h", targetMeta.host, "-p", targetMeta.port, "-U", targetMeta.user, "-d", targetDb, dumpPath], {
      env: { ...process.env, PGPASSWORD: pgPassword },
      timeout: 300000,
    });
    const finishedAt = new Date().toISOString();
    S.restore = { startedAt, finishedAt, ms: Date.now() - startedMs };
    // The source must be byte-for-byte the post-backup state: restore never
    // writes to it, and the row counts prove it.
    expect(await tableCounts(source)).toEqual(S.postCCounts);
    expect(await tableCounts(target)).toEqual(S.backupCounts);
  }, 120000);

  it("D2 verifies migration history, schema, FK, CHECK, partial uniques and RLS on the restore", async () => {
    requirePhase(S.restore !== null, "restore record from D1");
    const history = await target.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
    expect(history).toEqual(S.sourceHistory);
    const tables = await target.$queryRaw<{ name: string; rls: boolean }[]>`SELECT c.relname::text AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY(${MODELS}::text[]) ORDER BY c.relname`;
    expect(tables.map((row) => row.name)).toEqual([...MODELS].sort());
    expect(tables.every((row) => row.rls)).toBe(true);
    const policies = await target.$queryRaw<{ tablename: string }[]>`SELECT tablename::text FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${MODELS}::text[]) AND roles && ARRAY['public','anon','authenticated']::name[]`;
    expect(policies).toEqual([]);
    const grants = await target.$queryRaw<{ grantee: string; table_name: string }[]>`SELECT grantee::text, table_name::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = ANY(${MODELS}::text[]) AND grantee IN ('PUBLIC', 'anon', 'authenticated')`;
    expect(grants).toEqual([]);
    const uniques = await target.$queryRaw<{ indexname: string }[]>`SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('notification_one_active_recipient', 'notification_one_unresolved_slot') ORDER BY indexname`;
    expect(uniques.map((row) => row.indexname)).toEqual(["notification_one_active_recipient", "notification_one_unresolved_slot"]);
    const checks = await target.$queryRaw<{ conname: string }[]>`SELECT conname::text FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname IN ('notification_slot_sequence_range', 'notification_slot_cost_nonnegative', 'notification_cost_purged_numbers', 'notification_cost_state_values', 'notification_slot_status_allowed', 'notification_dispatch_slot_count', 'notification_budget_nonnegative', 'notification_budget_archive_valid', 'notification_nonce_nonnegative') ORDER BY conname`;
    expect(checks.map((row) => row.conname).sort()).toEqual(
      [
        "notification_budget_archive_valid",
        "notification_budget_nonnegative",
        "notification_cost_purged_numbers",
        "notification_cost_state_values",
        "notification_dispatch_slot_count",
        "notification_nonce_nonnegative",
        "notification_slot_cost_nonnegative",
        "notification_slot_sequence_range",
        "notification_slot_status_allowed",
      ].sort(),
    );
    const fks = await target.$queryRaw<{ conname: string }[]>`SELECT conname::text FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'f' AND conname IN ('NotificationRecipientRegistration_userId_fkey', 'NotificationDispatch_outboxId_fkey', 'NotificationDispatch_recipientId_fkey', 'NotificationAudit_registrationId_fkey', 'NotificationAudit_outboxId_fkey', 'NotificationAudit_dispatchId_fkey', 'NotificationAudit_slotId_fkey', 'NotificationAudit_costOperationId_fkey', 'NotificationCostReservation_dispatchId_fkey', 'notification_cost_source_slot_fk', 'notification_cost_source_cost_fk') ORDER BY conname`;
    expect(fks.map((row) => row.conname).sort()).toEqual(
      [
        "NotificationAudit_costOperationId_fkey",
        "NotificationAudit_dispatchId_fkey",
        "NotificationAudit_outboxId_fkey",
        "NotificationAudit_registrationId_fkey",
        "NotificationAudit_slotId_fkey",
        "NotificationCostReservation_dispatchId_fkey",
        "NotificationDispatch_outboxId_fkey",
        "NotificationDispatch_recipientId_fkey",
        "NotificationRecipientRegistration_userId_fkey",
        "notification_cost_source_cost_fk",
        "notification_cost_source_slot_fk",
      ].sort(),
    );
  }, 60000);

  it("D3 proves the restore succeeded with backup-identical rows", async () => {
    requirePhase(S.restore !== null, "restore record from D1");
    requirePhase(S.backupRows !== null, "backup rows from A9");
    expect(await tableCounts(target)).toEqual(S.backupCounts);
    expect(await snapshotRows(target)).toEqual(S.backupRows);
  }, 60000);

  it("D4 measures restore timing without asserting a threshold", async () => {
    requirePhase(S.restore !== null, "restore record from D1");
    expect(new Date(S.restore!.finishedAt).getTime()).toBeGreaterThanOrEqual(new Date(S.restore!.startedAt).getTime());
    expect(S.restore!.ms).toBeGreaterThanOrEqual(0);
  }, 60000);

  it("D5 proves dump integrity and that restore differs from post-backup source", async () => {
    requirePhase(S.dump !== null, "dump record from B1");
    requirePhase(S.postCCounts !== null, "post-backup source counts from C6");
    expect(sha256File(dumpPath)).toBe(S.dump!.sha256);
    expect(statSync(dumpPath).size).toBe(S.dump!.bytes);
    expect(await tableCounts(target)).toEqual(S.backupCounts);
    const targetCounts = await tableCounts(target);
    const sourceCounts = await tableCounts(source);
    expect(targetCounts["NotificationAudit"]).not.toBe(sourceCounts["NotificationAudit"]);
    expect(targetCounts["NotificationAudit"]).toBe(S.backupCounts!["NotificationAudit"]);
    expect(sourceCounts["NotificationAudit"]).toBe(S.postCCounts!["NotificationAudit"]);
  }, 60000);

  it("E1 holds OFF on the restore: gate disabled, live permit refused, worker sends nothing", async () => {
    requirePhase(S.restore !== null, "restore record from D1");
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const [runtime] = await target.$queryRaw<{ environment: string; blocked: boolean; nonceHighWater: bigint }[]>`SELECT "environment", "blocked", "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    const [backupRuntime] = (S.backupRows!["NotificationRuntimeConfig"] as { environment: string; blocked: boolean; nonceHighWater: bigint }[]);
    expect(runtime).toMatchObject({ environment: backupRuntime!.environment, blocked: backupRuntime!.blocked, nonceHighWater: backupRuntime!.nonceHighWater });
    expect(
      evaluateSendGate({
        config: dryRunConfig,
        runtime: { blocked: runtime!.blocked, environment: "preview", provider: "solapi", activationEpoch: at },
        policy,
        occurredAt: at,
      }),
    ).toEqual({ allowed: false, reason: "send_disabled" });
    expect(isExplicitSendDisabled(dryRunConfig, policy)).toBe(true);
    const slotsBefore = await target.$queryRaw`SELECT "id" FROM "NotificationCostReservation" ORDER BY "id"`;
    const auditsBefore = await target.$queryRaw`SELECT "eventId" FROM "NotificationAudit" ORDER BY "eventId"`;
    // Negative control, not a real issuance attempt: a live-config permit with
    // a mismatched recipient version must return null without mutating.
    const repository = new PrismaDispatchRepository(restoreScoped as unknown as PrismaGuardClient);
    const permit = await acquireDispatchPermit(repository, {
      dispatchId: mainDispatchId,
      context: { ...S.mainContext!, recipientVersion: "v9" },
      syntheticKey: { key: syntheticKey, keyVersion, synthetic: true as const },
      config: liveConfig,
      policy,
      quote,
      claimToken: "synthetic-claim-token",
      now: at,
    });
    expect(permit).toBeNull();
    expect(await target.$queryRaw`SELECT "id" FROM "NotificationCostReservation" ORDER BY "id"`).toEqual(slotsBefore);
    expect(await target.$queryRaw`SELECT "eventId" FROM "NotificationAudit" ORDER BY "eventId"`).toEqual(auditsBefore);
    // Dry-run worker probe at the pre-expiry instant: the skip itself is
    // refused while unresolved evidence exists (invalid_transition), the row
    // is preserved, and the mock provider is never called.
    const provider = new MockProvider({ code: "S_UNKNOWN" });
    const spy = vi.spyOn(MockProvider.prototype, "send");
    try {
      const store = new PrismaOutboxStore(restoreScoped);
      const result = await processOutboxBatch(store, {
        provider: null,
        now: at,
        safe: {
          repository,
          provider,
          clock: () => at,
          prepare: async () => ({
            dispatchId: mainDispatchId,
            context: S.mainContext!,
            syntheticKey: { key: syntheticKey, keyVersion, synthetic: true as const },
            config: dryRunConfig,
            policy,
            quote,
          }),
        },
      });
      expect(result.outcomes).toEqual([{ rowId: pendingOutboxId, status: "failed", reason: "invalid_transition" }]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await target.$queryRaw`SELECT "id" FROM "NotificationCostReservation" ORDER BY "id"`).toEqual(slotsBefore);
    const [outbox] = await target.$queryRaw<{ status: string; attemptCount: number }[]>`SELECT "status", "attemptCount" FROM "NotificationOutbox" WHERE "id" = ${pendingOutboxId}`;
    expect(outbox).toEqual({ status: "processing", attemptCount: 0 });
  }, 60000);

  it("E2 detects the pre-revocation registration on the restore and reapplies the revocation", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(before.revocation).toEqual({ ok: false, reason: `revocation_reapply_required:${recipientActive}` });
    await target.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "state" = 'revoked', "revokedAt" = ${at2} WHERE "id" = ${recipientActive}`;
    await target.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${c1AuditId}, ${c1AuditId}, 'preview', ${recipientActive}, 'recipient_revoked', 'revoked', ${userActive}, ${c1AuditId}, ${at2})`;
    const after = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(after.revocation).toEqual({ ok: true, reason: "revocation_matched" });
    const [row] = await target.$queryRaw<{ state: string }[]>`SELECT "state" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipientActive}`;
    expect(row).toEqual({ state: "revoked" });
  }, 60000);

  it("E3 detects the pre-purge fields on the restore, reapplies the purge, and claims no completion", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(before.purge).toEqual({ ok: false, reason: `purge_reapply_required:${recipientActive}` });
    await target.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "ciphertext" = NULL, "nonce" = NULL, "tag" = NULL, "purgedAt" = ${at2} WHERE "id" = ${recipientActive}`;
    await target.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${c2AuditId}, ${c2AuditId}, 'preview', ${recipientActive}, 'recipient_purged', 'revoked', ${userActive}, ${c2AuditId}, ${at2})`;
    const after = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(after.purge).toEqual({ ok: true, reason: "purge_matched" });
    const [row] = await target.$queryRaw<{ ciphertext: Buffer | null; purgedAt: Date | null }[]>`SELECT "ciphertext", "purgedAt" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipientActive}`;
    expect(row!.ciphertext).toBeNull();
    expect(row!.purgedAt).toEqual(at2);
    expect(S.pristineLedger!.purgeCompletion).toBeNull();
  }, 60000);

  it("E4 refuses to resurrect a send permit from stale slots or budget on the restore", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const gate = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(gate.slots).toEqual({ ok: false, reason: `slot_state_mismatch:${mainSlotId}` });
    expect(gate.budget).toEqual({ ok: false, reason: "budget_state_mismatch:day:2040-01-01" });
    const restoreSlots = await target.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "NotificationCostReservation" WHERE "entryKind" = 'SEND_SLOT' ORDER BY "id"`;
    const backupSlots = (S.backupRows!["NotificationCostReservation"] as { id: string; status: string; entryKind: string }[])
      .filter((row) => row.entryKind === "SEND_SLOT")
      .map((row) => ({ id: row.id, status: row.status }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(restoreSlots).toEqual(backupSlots);
    const permits = await target.$queryRaw<{ eventId: string }[]>`SELECT "eventId" FROM "NotificationAudit" WHERE "eventType" = 'permit_issued'`;
    expect(permits).toEqual([]);
    const restoreBudgets = await target.$queryRaw<{ periodType: string; periodKey: string }[]>`SELECT "periodType", "periodKey" FROM "NotificationBudgetPeriod" ORDER BY "periodType"`;
    const backupBudgets = (S.backupRows!["NotificationBudgetPeriod"] as { periodType: string; periodKey: string }[]).map((row) => ({ periodType: row.periodType, periodKey: row.periodKey }));
    expect(restoreBudgets).toEqual(backupBudgets);
  }, 60000);

  it("E5 blocks the stale nonce counter and keeps recovery unverified", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const gate = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(gate.nonce).toEqual({ ok: false, reason: "nonce_behind" });
    expect(gate.recoveryVerified).toBe(false);
    const [runtime] = await target.$queryRaw<{ nonceHighWater: bigint }[]>`SELECT "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    expect(runtime!.nonceHighWater).toBe(100n);
    // The ledger authorizes only sequence 102 (101 + 1); the restored counter
    // 100 is stale by construction and is never used as a fresh nonce.
    expect(BigInt(S.pristineLedger!.nonceHighWater!.after) + 1n).toBe(102n);
    expect(runtime!.nonceHighWater).not.toBe(102n);
  }, 60000);

  it("E6 refuses OFF-to-ON transition on restore success alone", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const gate = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    expect(gate.activation).toEqual({ ok: false, reason: "approval_missing" });
    const [runtime] = await target.$queryRaw<{ environment: string; blocked: boolean; nonceHighWater: bigint }[]>`SELECT "environment", "blocked", "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    const [backupRuntime] = S.backupRows!["NotificationRuntimeConfig"] as { environment: string; blocked: boolean; nonceHighWater: bigint }[];
    expect(runtime).toMatchObject({ environment: backupRuntime!.environment, blocked: backupRuntime!.blocked, nonceHighWater: backupRuntime!.nonceHighWater });
    expect(
      evaluateSendGate({
        config: dryRunConfig,
        runtime: { blocked: runtime!.blocked, environment: "preview", provider: "solapi", activationEpoch: at },
        policy,
        occurredAt: at,
      }),
    ).toEqual({ allowed: false, reason: "send_disabled" });
  }, 60000);

  it("F1 refuses every reconciliation when the latest evidence is entirely missing", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working: Ledger = {
      runId,
      capturedAt: at2.toISOString(),
      revocations: [],
      destructions: [],
      slotStates: [],
      budgetStates: [],
      nonceHighWater: null,
      auditRefs: [],
      sourceSnapshot: S.backupCounts!,
      purgeCompletion: null,
      mismatchNotes: [],
      reviewNotes: [],
    };
    try {
      writeFileSync(mirrorPath, JSON.stringify({}, null, 2), { mode: 0o600 });
      const gate = reconcileRestore(await restoreEvidence(target), working, null);
      expect(gate.revocation).toEqual({ ok: false, reason: "ledger_missing" });
      expect(gate.purge).toEqual({ ok: false, reason: "ledger_missing" });
      expect(gate.slots).toEqual({ ok: false, reason: "ledger_missing" });
      expect(gate.budget).toEqual({ ok: false, reason: "ledger_missing" });
      expect(gate.nonce).toEqual({ ok: false, reason: "ledger_missing" });
      expect(gate.activation).toEqual({ ok: false, reason: "approval_missing" });
      expect(gate.recoveryVerified).toBe(false);
      await probeWorkerNoSend([]);
    } finally {
      writeFileSync(mirrorPath, JSON.stringify(S.pristineLedger, null, 2), { mode: 0o600 });
    }
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F2 refuses only the registration whose revocation evidence is missing", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    working.revocations = [];
    const baseline = reconcileRestore(await restoreEvidence(target), S.pristineLedger, null);
    const gate = reconcileRestore(await restoreEvidence(target), working, null);
    expect(gate.revocation).toEqual({ ok: false, reason: `revocation_evidence_missing:${recipientActive}` });
    expect(gate.purge).toEqual(baseline.purge);
    expect(gate.slots).toEqual(baseline.slots);
    expect(gate.budget).toEqual(baseline.budget);
    expect(gate.nonce).toEqual(baseline.nonce);
    expect(gate.activation).toEqual(baseline.activation);
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F3 treats a tampered purge tombstone as not purged and records the mismatch", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    working.destructions[0]!.tombstone = "0".repeat(64);
    const gate = reconcileRestore(await restoreEvidence(target), working, null);
    expect(gate.purge).toEqual({ ok: false, reason: `tombstone_mismatch:${recipientActive}` });
    working.mismatchNotes.push(`tombstone_mismatch:${recipientActive}`);
    expect(working.mismatchNotes).toContain(`tombstone_mismatch:${recipientActive}`);
    expect(working.purgeCompletion).toBeNull();
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F4 refuses slot issuance and duplicate budget use on tampered reservations", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    working.slotStates[0]!.to = "accepted";
    const day = working.budgetStates.find((row) => row.periodType === "day")!;
    day.lookupConfirmedMilliKrw = "999999";
    const gate = reconcileRestore(await restoreEvidence(target), working, null);
    expect(gate.slots).toEqual({ ok: false, reason: `slot_state_mismatch:${mainSlotId}` });
    expect(gate.budget).toEqual({ ok: false, reason: "budget_state_mismatch:day:2040-01-01" });
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F5 refuses a reversed nonce high-water instead of treating it as newer", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    working.nonceHighWater = { before: "100", after: "50" };
    const gate = reconcileRestore(await restoreEvidence(target), working, null);
    expect(gate.nonce).toEqual({ ok: false, reason: "nonce_reversed" });
    expect(gate.recoveryVerified).toBe(false);
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F6 rolls back a reapply whose audit write fails and records review_required", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    // The audit insert reuses an existing eventId, so the unique constraint
    // fails and the whole reapply transaction rolls back: no partial purge.
    await expect(
      target.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "purgedAt" = ${at2} WHERE "id" = ${recipientRevoked}`;
        await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "occurredAt") VALUES (${`${runId}-f6-dup`}, ${c1AuditId}, 'preview', ${recipientRevoked}, 'recipient_purged', ${at2})`;
      }),
    ).rejects.toThrow();
    expect(await snapshotRows(target)).toEqual(before);
    working.reviewNotes.push("review_required:audit_write_failed");
    expect(working.reviewNotes).toContain("review_required:audit_write_failed");
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);

  it("F7 refuses activation without approver evidence and keeps OFF", async () => {
    requirePhase(S.pristineLedger !== null, "pristine ledger from C6");
    const before = await snapshotRows(target);
    const working = cloneLedger(S.pristineLedger!);
    const gate = reconcileRestore(await restoreEvidence(target), working, null);
    expect(gate.activation).toEqual({ ok: false, reason: "approval_missing" });
    working.reviewNotes.push("activation_refused:approval_missing");
    expect(working.reviewNotes).toContain("activation_refused:approval_missing");
    const [runtime] = await target.$queryRaw<{ environment: string; blocked: boolean; nonceHighWater: bigint }[]>`SELECT "environment", "blocked", "nonceHighWater" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview'`;
    const [backupRuntime] = S.backupRows!["NotificationRuntimeConfig"] as { environment: string; blocked: boolean; nonceHighWater: bigint }[];
    expect(runtime).toMatchObject({ environment: backupRuntime!.environment, blocked: backupRuntime!.blocked, nonceHighWater: backupRuntime!.nonceHighWater });
    expect(
      evaluateSendGate({
        config: dryRunConfig,
        runtime: { blocked: runtime!.blocked, environment: "preview", provider: "solapi", activationEpoch: at },
        policy,
        occurredAt: at,
      }),
    ).toEqual({ allowed: false, reason: "send_disabled" });
    await probeWorkerNoSend([]);
    expect(await snapshotRows(target)).toEqual(before);
  }, 60000);
});
