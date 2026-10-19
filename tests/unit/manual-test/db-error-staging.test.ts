import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseManualTestPrisma,
  emptyMockData,
  logManualDbError,
  type ManualDbStage,
  type ManualPrismaClient,
  type MockRun,
} from "@/lib/db/manual-test-prisma";
import type { ManualSqlClient } from "@/server/manual-test/persistence";

function lastLogged(errorSpy: ReturnType<typeof vi.spyOn>): { raw: string; parsed: Record<string, unknown> } {
  const raw = String(errorSpy.mock.calls[0]?.[0]);
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
}

describe("logManualDbError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs only safe fields and never the message, meta, URLs or tokens", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sensitive = Object.assign(
      new Error("SELECT * FROM secret WHERE token='tok-abc-123'"),
      { code: "P2031", meta: { params: ["tok-abc-123", "pw-hunter2"] } },
    );
    expect(() => logManualDbError("insert_run", sensitive)).toThrow("MANUAL_DB_STAGE_INSERT_RUN");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({ scope: "manual-test-db", stage: "insert_run", errorName: "Error", prismaCode: "P2031" });
    expect(Object.keys(parsed).sort()).toEqual(["errorName", "prismaCode", "scope", "stage"]);
    for (const secret of ["tok-abc-123", "pw-hunter2", "SELECT * FROM secret"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("drops non-alphanumeric Prisma codes and tags the thrown error with the stage", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const weird = Object.assign(new Error("boom"), { code: "P20;31 DROP" });
    const caught = (() => {
      try { logManualDbError("tx_commit", weird); } catch (error) { return error; }
      throw new Error("logManualDbError must throw");
    })();
    const { parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({ scope: "manual-test-db", stage: "tx_commit", errorName: "Error" });
    expect(parsed).not.toHaveProperty("prismaCode");
    expect((caught as Error).message).toBe("MANUAL_DB_STAGE_TX_COMMIT");
    expect((caught as { manualStage?: ManualDbStage }).manualStage).toBe("tx_commit");
  });

  it("wraps non-Error thrown values without logging them", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logManualDbError("tx_start", "plain string with secret-999")).toThrow("MANUAL_DB_STAGE_TX_START");
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({ scope: "manual-test-db", stage: "tx_start", errorName: "Error" });
    expect(raw).not.toContain("secret-999");
  });

  it("logs a whitelisted table and tags the staged error with manualTable", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = Object.assign(new Error("upsert failed"), { code: "P2031" });
    const caught = (() => {
      try { logManualDbError("persist_run", boom, { table: "Payment" }); } catch (error) { return error; }
      throw new Error("logManualDbError must throw");
    })();
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({
      scope: "manual-test-db", stage: "persist_run", table: "Payment",
      errorName: "Error", prismaCode: "P2031",
    });
    expect(Object.keys(parsed).sort()).toEqual(["errorName", "prismaCode", "scope", "stage", "table"]);
    expect((caught as Error).message).toBe("MANUAL_DB_STAGE_PERSIST_RUN");
    expect((caught as { manualStage?: ManualDbStage }).manualStage).toBe("persist_run");
    expect((caught as { manualTable?: string }).manualTable).toBe("Payment");
    expect(raw).not.toContain("upsert failed");
  });

  it("ignores non-whitelisted table values instead of logging them", () => {
    for (const badTable of ["payment", "Payment; DROP", "User\nEvil", "", "ManualTestRun"]) {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const caught = (() => {
        try { logManualDbError("persist_run", new Error("boom"), { table: badTable }); } catch (error) { return error; }
        throw new Error("logManualDbError must throw");
      })();
      const { parsed } = lastLogged(errorSpy);
      expect(parsed).not.toHaveProperty("table");
      expect(parsed).not.toHaveProperty("manualTable");
      expect(caught as Error).not.toHaveProperty("manualTable");
      vi.restoreAllMocks();
    }
  });
});

describe("DatabaseManualTestPrisma stage tagging", () => {
  afterEach(() => vi.restoreAllMocks());

  const DATABASE_URL = "postgresql://tester@localhost:5432/yaho?schema=manual_test";

  /** Mock client whose transaction fails at the INSERT (second $executeRaw call). */
  function failingInsertClient(): ManualPrismaClient {
    let executeRawCalls = 0;
    const tx = {
      $executeRaw: async (): Promise<number> => {
        executeRawCalls += 1;
        if (executeRawCalls === 2) {
          const boom = Object.assign(
            new Error("INSERT leaked secret-token-xyz with params"),
            { code: "P2031", meta: { params: ["secret-token-xyz"] } },
          );
          throw boom;
        }
        return 1;
      },
      $queryRaw: async (): Promise<{ schema: string; path: string }[]> => [
        { schema: "manual_test", path: '"manual_test"' },
      ],
    } as unknown as ManualSqlClient;
    return {
      $transaction: async <T>(operation: (txArg: ManualSqlClient) => Promise<T>): Promise<T> => operation(tx),
      $disconnect: async () => {},
    };
  }

  function databaseRun(): MockRun {
    return {
      id: "run-stage-test",
      mode: "DATABASE",
      status: "ACTIVE",
      expiresAt: Date.now() + 3_600_000,
      sessions: {},
      grants: {},
      receipts: {},
      data: emptyMockData(),
    };
  }

  it("tags insert failures with insert_run and keeps secrets out of the log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new DatabaseManualTestPrisma(DATABASE_URL, () => failingInsertClient());
    const caught = await db.createRun(databaseRun()).then(
      () => { throw new Error("createRun was expected to throw"); },
      (error: unknown) => error,
    );
    expect((caught as Error).message).toBe("MANUAL_DB_STAGE_INSERT_RUN");
    expect((caught as { manualStage?: ManualDbStage }).manualStage).toBe("insert_run");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({ scope: "manual-test-db", stage: "insert_run", errorName: "Error", prismaCode: "P2031" });
    expect(raw).not.toContain("secret-token-xyz");
  });

  it("tags search_path failures with search_path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = {
      $executeRaw: async (): Promise<number> => { throw new Error("connection reset"); },
      $queryRaw: async (): Promise<unknown[]> => [],
    } as unknown as ManualSqlClient;
    const client: ManualPrismaClient = {
      $transaction: async <T>(operation: (txArg: ManualSqlClient) => Promise<T>): Promise<T> => operation(tx),
      $disconnect: async () => {},
    };
    const db = new DatabaseManualTestPrisma(DATABASE_URL, () => client);
    const caught = await db.createRun(databaseRun()).then(
      () => { throw new Error("createRun was expected to throw"); },
      (error: unknown) => error,
    );
    expect((caught as { manualStage?: ManualDbStage }).manualStage).toBe("search_path");
    const { parsed } = lastLogged(errorSpy);
    expect(parsed).toMatchObject({ scope: "manual-test-db", stage: "search_path" });
  });

  it("tags transaction-startup failures with tx_start and post-callback failures with tx_commit", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Transaction never starts: the client itself throws before invoking the callback.
    const startupClient: ManualPrismaClient = {
      $transaction: async <T>(): Promise<T> => { throw new Error("pool exhausted"); },
      $disconnect: async () => {},
    };
    const startupDb = new DatabaseManualTestPrisma(DATABASE_URL, () => startupClient);
    const startupCaught = await startupDb.createRun(databaseRun()).then(
      () => { throw new Error("createRun was expected to throw"); },
      (error: unknown) => error,
    );
    expect((startupCaught as { manualStage?: ManualDbStage }).manualStage).toBe("tx_start");

    // Callback completes, then the transaction fails (commit): stage tx_commit.
    const tx = {
      $executeRaw: async (): Promise<number> => 1,
      $queryRaw: async (): Promise<{ schema: string; path: string }[]> => [
        { schema: "manual_test", path: '"manual_test"' },
      ],
    } as unknown as ManualSqlClient;
    const commitClient: ManualPrismaClient = {
      $transaction: async <T>(operation: (txArg: ManualSqlClient) => Promise<T>): Promise<T> => {
        await operation(tx);
        throw new Error("commit failed");
      },
      $disconnect: async () => {},
    };
    const commitDb = new DatabaseManualTestPrisma(DATABASE_URL, () => commitClient);
    const commitCaught = await commitDb.createRun(databaseRun()).then(
      () => { throw new Error("createRun was expected to throw"); },
      (error: unknown) => error,
    );
    expect((commitCaught as { manualStage?: ManualDbStage }).manualStage).toBe("tx_commit");
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("tags persist_run failures with the failing table from the real upsert path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Call order in createRun: 1 = SET LOCAL search_path, 2 = INSERT ManualTestRun,
    // 3 = first persistManualRun upsert (the User fixture row). The real upsert
    // tags the error with manualTable before createRun whitelists and logs it.
    let executeRawCalls = 0;
    const tx = {
      $executeRaw: async (): Promise<number> => {
        executeRawCalls += 1;
        if (executeRawCalls === 3) {
          throw Object.assign(new Error("upsert leaked secret-token-persist"), { code: "P2031" });
        }
        return 1;
      },
      $queryRaw: async (): Promise<{ schema: string; path: string }[]> => [
        { schema: "manual_test", path: '"manual_test"' },
      ],
    } as unknown as ManualSqlClient;
    const client: ManualPrismaClient = {
      $transaction: async <T>(operation: (txArg: ManualSqlClient) => Promise<T>): Promise<T> => operation(tx),
      $disconnect: async () => {},
    };
    const db = new DatabaseManualTestPrisma(DATABASE_URL, () => client);
    const caught = await db.createRun(databaseRun()).then(
      () => { throw new Error("createRun was expected to throw"); },
      (error: unknown) => error,
    );
    expect((caught as Error).message).toBe("MANUAL_DB_STAGE_PERSIST_RUN");
    expect((caught as { manualStage?: ManualDbStage }).manualStage).toBe("persist_run");
    expect((caught as { manualTable?: string }).manualTable).toBe("User");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({
      scope: "manual-test-db", stage: "persist_run", table: "User",
      errorName: "Error", prismaCode: "P2031",
    });
    expect(raw).not.toContain("secret-token-persist");
  });

  it("tags invalid database URLs with prisma_init before any client is built", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const factory = vi.fn((): ManualPrismaClient => { throw new Error("factory must not run"); });
    expect(() => new DatabaseManualTestPrisma("https://not-a-database-url", factory))
      .toThrow("MANUAL_DB_STAGE_PRISMA_INIT");
    expect(factory).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const { raw, parsed } = lastLogged(errorSpy);
    expect(parsed).toEqual({ scope: "manual-test-db", stage: "prisma_init", errorName: "Error" });
    expect(raw).not.toContain("not-a-database-url");
  });
});
