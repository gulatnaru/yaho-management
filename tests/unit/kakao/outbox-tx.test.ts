import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildDedupeKey } from "@/lib/kakao/notify";
import { insertApplicationReceivedOutbox, type OutboxTransaction } from "@/lib/kakao/outbox-tx";

type FakeRow = { id: string; entityId: string; dedupeKey: string };

// In-memory stand-in for a Prisma transaction client. Writes land in a
// staging buffer until commit() and vanish on rollback(), mirroring real
// transaction semantics without a database. The helper only reaches the
// database through this tx, so staged/committed visibility here proves the
// helper writes through the transaction and nothing else.
// NOTE: the fake reads Prisma.sql parameter order (INSERT values:
// [id, eventKind, entityId, dedupeKey, ...]; SELECT values: [dedupeKey]).
function createFakeTx() {
  const committed: FakeRow[] = [];
  const staged: FakeRow[] = [];
  let queryError: Error | null = null;
  const tx: OutboxTransaction & {
    committed: FakeRow[];
    staged: FakeRow[];
    failQuery(error: Error): void;
    commit(): void;
    rollback(): void;
  } = {
    committed,
    staged,
    failQuery(error: Error) { queryError = error; },
    commit() { committed.push(...staged); staged.length = 0; },
    rollback() { staged.length = 0; },
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      if (queryError) throw queryError;
      const dedupeKey = (query as unknown as { values: unknown[] }).values[0] as string;
      const found = [...committed, ...staged]
        .filter((row) => row.dedupeKey === dedupeKey)
        .map((row) => ({ id: row.id }));
      return found as T;
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const values = (query as unknown as { values: unknown[] }).values;
      staged.push({ id: values[0] as string, entityId: values[2] as string, dedupeKey: values[3] as string });
      return 1;
    },
  };
  return tx;
}

const now = new Date("2030-01-01T00:00:00.000Z");
const submissionId = `phase8_${randomUUID()}`;

describe("insertApplicationReceivedOutbox (fake transaction)", () => {
  it("first insert returns { inserted: true } and stages one row with the expected dedupeKey", async () => {
    const tx = createFakeTx();
    await expect(insertApplicationReceivedOutbox(tx, { submissionId, now })).resolves.toEqual({ inserted: true });
    expect(tx.staged).toHaveLength(1);
    expect(tx.staged[0]).toMatchObject({
      entityId: submissionId,
      dedupeKey: buildDedupeKey("application.received", submissionId, "created"),
    });
    expect(tx.committed).toHaveLength(0);
  });

  it("repeat insert returns { inserted: false } and stages no second row", async () => {
    const tx = createFakeTx();
    await insertApplicationReceivedOutbox(tx, { submissionId, now });
    await expect(insertApplicationReceivedOutbox(tx, { submissionId, now })).resolves.toEqual({ inserted: false });
    expect(tx.staged).toHaveLength(1);
  });

  it("a different submissionId inserts a second row", async () => {
    const tx = createFakeTx();
    await insertApplicationReceivedOutbox(tx, { submissionId, now });
    await expect(insertApplicationReceivedOutbox(tx, { submissionId: `phase8_${randomUUID()}`, now })).resolves.toEqual({ inserted: true });
    expect(tx.staged).toHaveLength(2);
  });

  it("a lookup failure propagates instead of reporting a silent skip", async () => {
    const tx = createFakeTx();
    tx.failQuery(new Error("lookup failed"));
    await expect(insertApplicationReceivedOutbox(tx, { submissionId, now })).rejects.toThrow("lookup failed");
    expect(tx.staged).toHaveLength(0);
  });

  it("rollback discards staged rows while commit keeps them", async () => {
    const tx = createFakeTx();
    await insertApplicationReceivedOutbox(tx, { submissionId, now });
    tx.commit();
    expect(tx.committed).toHaveLength(1);
    // A repeat after commit still sees the committed row (no duplicate).
    await expect(insertApplicationReceivedOutbox(tx, { submissionId, now })).resolves.toEqual({ inserted: false });
    const otherId = `phase8_${randomUUID()}`;
    await insertApplicationReceivedOutbox(tx, { submissionId: otherId, now });
    expect(tx.staged).toHaveLength(1);
    tx.rollback();
    expect(tx.staged).toHaveLength(0);
    expect(tx.committed).toHaveLength(1);
    expect(tx.committed[0]!.entityId).toBe(submissionId);
    // The rolled-back row is gone: inserting it again succeeds.
    await expect(insertApplicationReceivedOutbox(tx, { submissionId: otherId, now })).resolves.toEqual({ inserted: true });
  });

  it("invalid submissionId throws before any query", async () => {
    const tx = createFakeTx();
    await expect(insertApplicationReceivedOutbox(tx, { submissionId: "", now })).rejects.toThrow("Invalid notification dedupe input.");
    await expect(insertApplicationReceivedOutbox(tx, { submissionId: "   ", now })).rejects.toThrow("Invalid notification dedupe input.");
    expect(tx.staged).toHaveLength(0);
  });
});
