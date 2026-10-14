import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  claim,
  dispatch,
  settle,
  recover,
} from "@/server/ai-consultations/ledger";
import { type Scope, RETENTION_MS } from "@/lib/ai-consultations/contracts";
import type { Keyring } from "@/lib/ai-consultations/crypto";
import {
  syntheticSkill,
  phase21RequestScenarios,
  globalBucketDelta,
} from "../e2e/support/phase21-scenarios";
const limits = {
  subjectPerMinute: 1,
  globalPerMinute: 50,
  dailyCalls: 100,
  dailyCost: 0 as const,
};
/** Real PostgreSQL semantics; callers must hold the guarded owned Preview run. */
const PG_TEST_TRANSACTION_MS = 8000; // WAN harness only; HTTP four-second caps are unchanged.
export async function verifyPhase21Postgres(
  db: PrismaClient,
  scope: Scope,
  keys: Keyring,
) {
  const a = new PrismaClient(),
    b = new PrismaClient();
  try {
    const now = new Date();
    const scenarios = phase21RequestScenarios(scope);
    const before = await db.aiQuotaBucket.findMany({
      where: { runId: scope.runId },
    });
    const input = scenarios.duplicate;
    const same = await Promise.allSettled([
      claim(a, scope, input, keys, limits, now, PG_TEST_TRANSACTION_MS, new Date(now.getTime()+120000)),
      claim(b, scope, input, keys, limits, now, PG_TEST_TRANSACTION_MS, new Date(now.getTime()+120000)),
    ]);
    const won = same.flatMap((result) =>
      result.status === "fulfilled" && result.value.kind === "NEW"
        ? [result.value.row]
        : [],
    );
    assert.equal(won.length, 1);
    assert.equal(
      await db.aiConsultation.count({
        where: {
          runId: scope.runId,
          requestKey: input.action.params.requestId,
        },
      }),
      1,
    );
    assert.equal(
      (await claim(db, scope, input, keys, limits, now, PG_TEST_TRANSACTION_MS)).kind,
      "PENDING",
    );
    const last = await Promise.allSettled(
      scenarios.lastQuota.map((request, index) =>
        claim(index === 0 ? a : b, scope, request, keys, limits, now, PG_TEST_TRANSACTION_MS, new Date(now.getTime()+120000)),
      ),
    );
    const lastWon = last.flatMap((result) =>
      result.status === "fulfilled" && result.value.kind === "NEW"
        ? [result.value.row]
        : [],
    );
    assert.equal(lastWon.length, 1);
    assert.equal(
      await db.aiConsultation.count({
        where: {
          runId: scope.runId,
          requestKey: {
            in: scenarios.lastQuota.map(
              (request) => request.action.params.requestId,
            ),
          },
        },
      }),
      1,
    );
    const row = won[0];
    await dispatch(db, scope, row, new Date(), PG_TEST_TRANSACTION_MS);
    const settlement = {
      question: input.userRequest.utterance,
      reply: { category: "HUMAN_HANDOFF" as const, text: "합성 안내" },
      usedCalls: 1,
      uncertain: false,
    };
    const settled = await Promise.allSettled([
      settle(a, scope, row, keys, settlement, new Date(), PG_TEST_TRANSACTION_MS),
      settle(b, scope, row, keys, settlement, new Date(), PG_TEST_TRANSACTION_MS),
    ]);
    assert.equal(
      settled.filter((result) => result.status === "fulfilled" && result.value)
        .length,
      1,
    );
    assert.equal(
      await settle(db, scope, row, keys, settlement, new Date(), PG_TEST_TRANSACTION_MS),
      false,
    );
    const after = await db.aiQuotaBucket.findMany({
      where: { runId: scope.runId },
    });
    for (const key of [
      "global-minute:" + now.toISOString().slice(0, 16),
      "global-day:" + now.toISOString().slice(0, 10),
    ])
      assert.deepEqual(globalBucketDelta(before, after, key), {
        accepted: 2,
        usedCalls: 1,
        reservedCalls: 2,
      });
    const owned = await db.aiConsultation.findMany({
      where: { runId: scope.runId, id: { in: [row.id, lastWon[0].id] } },
    });
    assert.equal(owned.length, 2);
    assert.equal(owned.find((item) => item.id === row.id)?.status, "DONE");
    assert.equal(
      owned.find((item) => item.id === lastWon[0].id)?.status,
      "PROCESSING",
    );
    await assert.rejects(
      db.aiConsultation.update({
        where: { id: row.id },
        data: { expiresAt: new Date(row.expiresAt.getTime() + 1) },
      }),
    );
    await assert.rejects(
      db.aiConsultation.update({
        where: { id: row.id },
        data: { origin: "LIVE" },
      }),
    );
    const future = new Date(now.getTime() + 60_000);
    const crashed = await claim(
      db,
      scope,
      syntheticSkill(scope, "PROGRAMS", undefined, 1),
      keys,
      limits,
      future,
      PG_TEST_TRANSACTION_MS,
    );
    if (crashed.kind !== "NEW") throw new Error("AI_RACE_CLAIM_REQUIRED");
    await recover(db, scope, new Date(future.getTime() + 4000), PG_TEST_TRANSACTION_MS);
    assert.equal(
      await settle(
        db,
        scope,
        crashed.row,
        keys,
        {
          question: "synthetic",
          reply: { category: "HUMAN_HANDOFF", text: "late" },
          usedCalls: 0,
          uncertain: false,
        },
        future,
        PG_TEST_TRANSACTION_MS,
      ),
      false,
    );
    assert.equal(
      row.expiresAt.getTime() - row.createdAt.getTime(),
      RETENTION_MS,
    );
  } finally {
    await a.$disconnect();
    await b.$disconnect();
  }
}
