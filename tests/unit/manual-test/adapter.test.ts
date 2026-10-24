import { describe, expect, it } from "vitest";
import type { MockManualTestTransaction } from "@/lib/db/manual-test-prisma";
import { bootstrap, setup } from "./helpers";

describe("manual_test in-memory Prisma adapter", () => {
  it("sets and verifies transaction-local manual_test; rejects public and expires context", async () => {
    const context = setup();
    const run = await bootstrap(context);
    let captured: MockManualTestTransaction | undefined;
    await context.db.$transaction(run.runId, (tx) => {
      captured = tx;
      expect(tx.verifySearchPath()).toBe("manual_test");
      expect(() => tx.setLocalSearchPath("public")).toThrow("MOCK_SCHEMA_DENIED");
      expect(tx.run.mode).toBe("MOCK_ONLY");
    });
    expect(() => captured!.verifySearchPath()).toThrow("MOCK_TRANSACTION_CLOSED");
    expect(() => captured!.run).toThrow("MOCK_TRANSACTION_CLOSED");
    await context.db.$transaction(run.runId, (tx) => {
      expect(tx.verifySearchPath()).toBe("manual_test");
    });
  });

  it("rolls back a failed transaction and keeps another run sentinel unchanged", async () => {
    const context = setup();
    const first = await bootstrap(context);
    const second = await bootstrap(context);
    await expect(context.db.$transaction(first.runId, (tx) => {
      tx.run.status = "CLOSED";
      tx.run.data.children = {};
      throw new Error("synthetic failure");
    })).rejects.toThrow("synthetic failure");
    for (const run of [first, second]) {
      await context.db.$transaction(run.runId, (tx) => {
        expect(tx.run.status).toBe("ACTIVE");
        expect(Object.keys(tx.run.data.children)).toHaveLength(12);
      });
    }
  });

  it("serializes asynchronous writes and detaches returned/leaked objects", async () => {
    const context = setup();
    const run = await bootstrap(context);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((number) => context.db.$transaction(run.runId, async (tx) => {
      await Promise.resolve();
      order.push(number);
      tx.run.expiresAt += number;
    })));
    expect(order).toEqual([1, 2, 3]);
    const data = await context.db.$transaction(run.runId, (tx) => tx.run.data);
    data.children = {};
    await context.db.$transaction(run.runId, (tx) => {
      expect(Object.keys(tx.run.data.children)).toHaveLength(12);
    });
  });

  it("rejects run rebinding and nonexistent runs without live fallbacks", async () => {
    const context = setup();
    const run = await bootstrap(context);
    await expect(context.db.$transaction(run.runId, (tx) => { tx.run.id = "another-run"; })).rejects.toThrow("MOCK_RUN_BINDING");
    await expect(context.db.$transaction("public", () => null)).rejects.toThrow("MOCK_RUN_UNAVAILABLE");
    expect("$connect" in context.db).toBe(false);
    expect("$queryRaw" in context.db).toBe(false);
  });
});
