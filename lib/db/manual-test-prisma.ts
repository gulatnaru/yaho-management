import "server-only";
/** In-memory Prisma-shaped test adapter. NEVER imports a generated/real Prisma client.
 * search_path is a simulation, not PostgreSQL ACL or pooler verification.
 */
export type MockSession = {
  hash: string; csrfHash?: string; scope: "OPERATOR" | "RESERVATION";
  runId: string; classId?: string; applicationId?: string; applicationIds?: string[]; expiresAt: number; revoked: boolean;
};
export type MockGrant = { hash: string; runId: string; classId: string; expiresAt: number; consumed: boolean };
export type MockClass = {
  id: string; capacity: number; teacherIds: string[]; quotedAmount: number;
  startsAt: number; endsAt: number; status: "SCHEDULED" | "CANCELLED";
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockApplication = {
  id: string; classId: string; childId: string; quotedAmount: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED"; reservationId?: string;
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockReservation = {
  id: string; applicationId: string; classId: string; childId: string;
  status: "RESERVED" | "CANCELLED" | "NO_SHOW"; attendance?: "PRESENT" | "ABSENT";
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockPayment = {
  id: string; reservationId: string; amount: number; refundedAmount: number;
  status: "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
};
export type MockData = {
  children: Record<string, { id: string; active: boolean }>;
  classes: Record<string, MockClass>; applications: Record<string, MockApplication>;
  deposits: { id: string; applicationId: string; amount: number }[];
  reservations: Record<string, MockReservation>; payments: Record<string, MockPayment>;
  refunds: { id: string; paymentId: string; amount: number; reason: string; detail?: string }[];
};
export type MockRun = {
  id: string; mode: "MOCK_ONLY" | "DATABASE"; status: "ACTIVE" | "CLOSED" | "CLEANED"; expiresAt: number;
  sessions: Record<string, MockSession>; grants: Record<string, MockGrant>;
  receipts: Record<string, { payload: string; result: unknown }>;
  data: MockData;
};

export function emptyMockData(): MockData {
  return { children: {}, classes: {}, applications: {}, deposits: [], reservations: {}, payments: {}, refunds: [] };
}

export class MockManualTestTransaction {
  private active = true;
  private searchPath: string | undefined;
  constructor(private readonly state: MockRun) {
    this.setLocalSearchPath("manual_test");
    this.verifySearchPath();
  }
  get run(): MockRun { this.verifySearchPath(); return this.state; }
  setLocalSearchPath(path: string) {
    if (!this.active || path !== "manual_test") throw new Error("MOCK_SCHEMA_DENIED");
    this.searchPath = path;
  }
  verifySearchPath() {
    if (!this.active || this.searchPath !== "manual_test") throw new Error("MOCK_TRANSACTION_CLOSED");
    return "manual_test" as const;
  }
  finish() { this.active = false; this.searchPath = undefined; }
}

export interface ManualTestDatabase {
  readonly mode: MockRun["mode"];
  createRun(run: MockRun): Promise<void>;
  $transaction<T>(runId: string, operation: (tx: MockManualTestTransaction) => Promise<T> | T): Promise<T>;
  $disconnect?(): Promise<void>;
}

export class MockManualTestPrisma implements ManualTestDatabase {
  readonly mode = "MOCK_ONLY" as const;
  private readonly runs = new Map<string, MockRun>();
  private tail: Promise<void> = Promise.resolve();

  // One mock process serializes all transactions; production database locking is not simulated faithfully.
  private async exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async createRun(run: MockRun): Promise<void> {
    await this.exclusive(() => {
      if (this.runs.has(run.id)) throw new Error("MOCK_RUN_EXISTS");
      this.runs.set(run.id, structuredClone(run));
    });
  }

  async $transaction<T>(runId: string, operation: (tx: MockManualTestTransaction) => Promise<T> | T): Promise<T> {
    return this.exclusive(async () => {
      const existing = this.runs.get(runId);
      if (!existing) throw new Error("MOCK_RUN_UNAVAILABLE");
      const draft = structuredClone(existing);
      const tx = new MockManualTestTransaction(draft);
      try {
        const result = await operation(tx);
        tx.verifySearchPath();
        if (draft.id !== runId || draft.mode !== "MOCK_ONLY") throw new Error("MOCK_RUN_BINDING");
        const detachedResult = structuredClone(result);
        this.runs.set(runId, structuredClone(draft));
        return detachedResult;
      } finally { tx.finish(); }
    });
  }
}

/** Failure stages of the DATABASE bootstrap path; surfaced in logs and 500 responses for diagnosis. */
export type ManualDbStage = "prisma_init" | "tx_start" | "search_path" | "insert_run" | "persist_run" | "tx_commit";

/**
 * Logs structured diagnostic with SAFE fields only, then throws a stage-tagged error.
 * SAFE: stage, error.name, Prisma error code (alphanumeric only).
 * NEVER LOG: error.message (may contain SQL/values), error.meta (params), URLs, passwords, tokens, session data.
 */
export function logManualDbError(stage: ManualDbStage, error: unknown): never {
  const err = error instanceof Error ? error : new Error(String(error));
  const rawCode = (err as { code?: unknown }).code;
  const prismaCode = typeof rawCode === "string" && /^[A-Z0-9]{2,10}$/.test(rawCode) ? rawCode : undefined;
  console.error(JSON.stringify({
    scope: "manual-test-db",
    stage,
    errorName: err.name,
    ...(prismaCode ? { prismaCode } : {}),
  }));
  const staged = new Error(`MANUAL_DB_STAGE_${stage.toUpperCase()}`);
  (staged as { manualStage?: ManualDbStage }).manualStage = stage;
  throw staged;
}

/** True when the error was already staged (and logged) by logManualDbError. */
function hasManualStage(error: unknown): error is Error & { manualStage: ManualDbStage } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { manualStage?: unknown }).manualStage === "string"
  );
}

/** Independently configured client; never imports lib/db/prisma or its public datasource. */
export class DatabaseManualTestPrisma implements ManualTestDatabase {
  readonly mode = "DATABASE" as const;
  private readonly client: ManualPrismaClient;
  constructor(url: string, factory: (url: string) => ManualPrismaClient = createManualPrismaClient) {
    try {
      assertManualDatabaseUrl(url);
    } catch (error) {
      logManualDbError("prisma_init", error);
    }
    this.client = factory(url);
  }
  $disconnect() { return this.client.$disconnect(); }
  async createRun(run: MockRun) {
    if (run.mode !== "DATABASE") throw new Error("MANUAL_DATABASE_BINDING");
    let entered = false;
    let completed = false;
    try {
      await this.client.$transaction(async (tx) => {
        entered = true;
        try {
          await setManualSearchPath(tx);
        } catch (error) {
          logManualDbError("search_path", error);
        }
        const createdAt = new Date(run.expiresAt - 60 * 60_000);
        try {
          await tx.$executeRaw(Prisma.sql`INSERT INTO "manual_test"."ManualTestRun" ("id", "startRequestKey", "deploymentSha", "schemaVersion", "createdAt", "expiresAt") VALUES (${run.id}, ${run.id}, 'manual-test-runtime', 'relational-v1', ${createdAt}, ${new Date(run.expiresAt)})`);
        } catch (error) {
          logManualDbError("insert_run", error);
        }
        try {
          await persistManualRun(tx, structuredClone(run));
        } catch (error) {
          logManualDbError("persist_run", error);
        }
        completed = true;
      });
    } catch (error) {
      // A staged error is rethrown untouched (already logged exactly once).
      // Otherwise the failure hit transaction startup (entered=false), aborted
      // the callback outside the instrumented steps, or surfaced after the
      // callback finished (commit) — only the last case is tx_commit.
      if (hasManualStage(error)) throw error;
      logManualDbError(!entered || !completed ? "tx_start" : "tx_commit", error);
    }
  }
  async $transaction<T>(runId: string, operation: (tx: MockManualTestTransaction) => Promise<T> | T): Promise<T> {
    return this.client.$transaction(async (client) => {
      await setManualSearchPath(client);
      const root = await lockManualRun(client, runId);
      const previous = await hydrateManualRun(client, root);
      const draft = structuredClone(previous);
      const tx = new MockManualTestTransaction(draft);
      try {
        const result = await operation(tx);
        tx.verifySearchPath();
        if (draft.id !== runId || draft.mode !== "DATABASE") throw new Error("MANUAL_DATABASE_BINDING");
        const detached = structuredClone(result);
        await persistManualRun(client, draft, previous);
        return detached;
      } finally { tx.finish(); }
    });
  }
}

import { Prisma, PrismaClient } from "@prisma/client";
import { hydrateManualRun, lockManualRun, persistManualRun, setManualSearchPath, type ManualSqlClient } from "@/server/manual-test/persistence";
export interface ManualPrismaClient {
  $transaction<T>(operation: (tx: ManualSqlClient) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
}
export function assertManualDatabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.searchParams.getAll("schema").length !== 1 || url.searchParams.get("schema") !== "manual_test") throw new Error();
  } catch { throw new Error("MANUAL_DATABASE_CONFIG_INVALID"); }
}
function createManualPrismaClient(url: string): ManualPrismaClient {
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}
