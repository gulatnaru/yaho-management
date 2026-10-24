import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseManualTestPrisma,
  emptyMockData,
  type ManualPrismaClient,
  type ManualTransactionOptions,
  type MockRun,
} from "@/lib/db/manual-test-prisma";
import type { ManualSqlClient } from "@/server/manual-test/persistence";

/**
 * Regression test for the bootstrap P2028 500: Prisma interactive transactions
 * default to a 5s callback timeout, which expired mid-transaction after 7+
 * sequential round-trips over Supabase + PgBouncer from Vercel serverless.
 * DatabaseManualTestPrisma must pass an explicit 30s timeout to both
 * $transaction calls. No real DB access; the factory is fully mocked.
 */
describe("DatabaseManualTestPrisma transaction timeout", () => {
  afterEach(() => vi.restoreAllMocks());

  const DATABASE_URL = "postgresql://tester@localhost:5432/yaho?schema=manual_test";
  const RUN_ID = "run-tx-timeout";

  function databaseRun(): MockRun {
    return {
      id: RUN_ID,
      mode: "DATABASE",
      status: "ACTIVE",
      expiresAt: Date.now() + 3_600_000,
      sessions: {},
      grants: {},
      receipts: {},
      data: emptyMockData(),
    };
  }

  /** Mock client that records the options arg of every $transaction call. */
  function capturingClient(captured: (ManualTransactionOptions | undefined)[]): ManualPrismaClient {
    const runRow = { id: RUN_ID, status: "ACTIVE", expiresAt: new Date() };
    const tx = {
      $executeRaw: async (): Promise<number> => 1,
      $queryRaw: async (query: { sql: string }): Promise<Record<string, unknown>[]> => {
        const sql = typeof query?.sql === "string" ? query.sql : "";
        if (sql.includes("current_schema")) return [{ schema: "manual_test", path: '"manual_test"' }];
        if (sql.includes('"ManualTestRun"')) return [runRow];
        return [];
      },
    } as unknown as ManualSqlClient;
    return {
      $transaction: async <T>(
        operation: (txArg: ManualSqlClient) => Promise<T>,
        options?: ManualTransactionOptions,
      ): Promise<T> => {
        captured.push(options);
        return operation(tx);
      },
      $disconnect: async () => {},
    };
  }

  it("passes { timeout: 30000 } to $transaction in createRun", async () => {
    const captured: (ManualTransactionOptions | undefined)[] = [];
    const db = new DatabaseManualTestPrisma(DATABASE_URL, () => capturingClient(captured));
    await db.createRun(databaseRun());
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ timeout: 30_000 });
  });

  it("passes { timeout: 30000 } to $transaction in the run-scoped $transaction", async () => {
    const captured: (ManualTransactionOptions | undefined)[] = [];
    const db = new DatabaseManualTestPrisma(DATABASE_URL, () => capturingClient(captured));
    const result = await db.$transaction(RUN_ID, () => "ok");
    expect(result).toBe("ok");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ timeout: 30_000 });
  });

  it("keeps single-arg $transaction mocks assignable to ManualPrismaClient", () => {
    // Existing tests pass $transaction fns without the options param; the
    // optional param must not break that assignability.
    const legacy: ManualPrismaClient = {
      $transaction: async <T>(operation: (txArg: ManualSqlClient) => Promise<T>): Promise<T> =>
        operation({} as ManualSqlClient),
      $disconnect: async () => {},
    };
    expect(typeof legacy.$transaction).toBe("function");
  });
});
