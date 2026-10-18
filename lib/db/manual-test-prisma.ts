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

/** Independently configured client; never imports lib/db/prisma or its public datasource. */
export class DatabaseManualTestPrisma implements ManualTestDatabase {
  readonly mode = "DATABASE" as const;
  private readonly client: ManualPrismaClient;
  constructor(url: string, factory: (url: string) => ManualPrismaClient = createManualPrismaClient) {
    assertManualDatabaseUrl(url);
    this.client = factory(url);
  }
  $disconnect() { return this.client.$disconnect(); }
  async createRun(run: MockRun) {
    if (run.mode !== "DATABASE") throw new Error("MANUAL_DATABASE_BINDING");
    await this.client.$transaction(async (tx) => {
      await setManualSearchPath(tx);
      const createdAt = new Date(run.expiresAt - 60 * 60_000);
      await tx.$executeRaw(Prisma.sql`INSERT INTO "manual_test"."ManualTestRun" ("id", "startRequestKey", "deploymentSha", "schemaVersion", "createdAt", "expiresAt") VALUES (${run.id}, ${run.id}, 'manual-test-runtime', 'relational-v1', ${createdAt}, ${new Date(run.expiresAt)})`);
      await persistManualRun(tx, structuredClone(run));
    });
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
