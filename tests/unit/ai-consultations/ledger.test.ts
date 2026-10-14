import { describe, it, expect } from "vitest";
import {
  claim,
  dispatch,
  settle,
  recover,
  reservationSettlement,
} from "@/server/ai-consultations/ledger";
import { readKeys } from "@/lib/ai-consultations/crypto";
import {
  scope,
  skill,
  keys,
  limits,
  memoryClient,
  environment,
} from "./fixtures";
const reply = {
  category: "HUMAN_HANDOFF" as const,
  text: "safe synthetic reply",
};
describe("AC21-07 atomic ledger model (not PostgreSQL proof)", () => {
  it("simultaneous duplicate claims accept once and never charge twice", async () => {
    const db = memoryClient();
    const input = skill();
    const results = await Promise.all([
      claim(db.client, scope, input, keys, limits, new Date()),
      claim(db.client, scope, input, keys, limits, new Date()),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["NEW", "PENDING"]);
    expect(db.state.consultations).toHaveLength(1);
    expect(
      db.state.quotas.every((x) => x.accepted === 1 && x.reservedCalls === 2),
    ).toBe(true);
  });
  it("same key/different input refuses without mutating counters", async () => {
    const db = memoryClient();
    const input = skill();
    await claim(db.client, scope, input, keys, limits, new Date());
    const before = structuredClone(db.state);
    await expect(
      claim(
        db.client,
        scope,
        skill("RAIN", input.action.params.requestId),
        keys,
        limits,
        new Date(),
      ),
    ).rejects.toThrow();
    expect(db.state).toEqual(before);
  });
  it("last subject/global quota accepts one concurrent new request", async () => {
    const db = memoryClient();
    const results = await Promise.allSettled([
      claim(
        db.client,
        scope,
        skill(),
        keys,
        { ...limits, subjectPerMinute: 1 },
        new Date(),
      ),
      claim(
        db.client,
        scope,
        skill(),
        keys,
        { ...limits, subjectPerMinute: 1 },
        new Date(),
      ),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(db.state.consultations).toHaveLength(1);
    expect(db.state.quotas.every((x) => x.accepted === 1)).toBe(true);
  });
  it("settles once, returns cached result and aggregates once", async () => {
    const db = memoryClient();
    const input = skill();
    const first = await claim(
      db.client,
      scope,
      input,
      keys,
      limits,
      new Date(),
    );
    if (first.kind !== "NEW") throw new Error("expected new");
    await dispatch(db.client, scope, first.row, new Date());
    expect(
      await settle(
        db.client,
        scope,
        first.row,
        keys,
        {
          question: input.userRequest.utterance,
          reply,
          usedCalls: 1,
          uncertain: false,
        },
        new Date(),
      ),
    ).toBe(true);
    expect(
      await settle(
        db.client,
        scope,
        first.row,
        keys,
        {
          question: input.userRequest.utterance,
          reply,
          usedCalls: 1,
          uncertain: false,
        },
        new Date(),
      ),
    ).toBe(false);
    expect(
      (await claim(db.client, scope, input, keys, limits, new Date())).kind,
    ).toBe("CACHED");
    expect(
      db.state.quotas.every(
        (x) => x.accepted === 1 && x.reservedCalls === 0 && x.usedCalls === 1,
      ),
    ).toBe(true);
    expect(db.state.metrics).toHaveLength(1);
    expect(db.state.metrics[0].count).toBe(1);
  });
  it("provably unstarted failure refunds model reservations, never accepted burst", async () => {
    const db = memoryClient();
    const first = await claim(
      db.client,
      scope,
      skill(),
      keys,
      limits,
      new Date(),
    );
    if (first.kind !== "NEW") throw new Error("expected new");
    await settle(
      db.client,
      scope,
      first.row,
      keys,
      { question: "synthetic", usedCalls: 0, uncertain: false },
      new Date(),
    );
    expect(
      db.state.quotas.every((x) => x.accepted === 1 && x.reservedCalls === 0),
    ).toBe(true);
    expect(
      (
        await claim(
          db.client,
          scope,
          skill("PROGRAMS", first.row.requestKey),
          keys,
          limits,
          new Date(),
        )
      ).kind,
    ).toBe("PENDING");
  });
  it("dispatched unknown failure keeps reservations and blocks implicit retry", async () => {
    const db = memoryClient();
    const input = skill();
    const first = await claim(
      db.client,
      scope,
      input,
      keys,
      limits,
      new Date(),
    );
    if (first.kind !== "NEW") throw new Error("expected new");
    await dispatch(db.client, scope, first.row, new Date());
    await settle(
      db.client,
      scope,
      first.row,
      keys,
      { question: input.userRequest.utterance, usedCalls: 0, uncertain: true },
      new Date(),
    );
    expect(db.state.consultations[0].status).toBe("UNCERTAIN");
    expect(db.state.quotas.every((x) => x.reservedCalls === 2)).toBe(true);
    expect(
      (await claim(db.client, scope, input, keys, limits, new Date())).kind,
    ).toBe("PENDING");
  });
  it.each([false, true])(
    "recovery fences late completion, dispatched=%s",
    async (dispatched) => {
      const db = memoryClient();
      const first = await claim(
        db.client,
        scope,
        skill(),
        keys,
        limits,
        new Date(),
      );
      if (first.kind !== "NEW") throw new Error("expected new");
      if (dispatched) await dispatch(db.client, scope, first.row, new Date());
      expect(await recover(db.client, scope, new Date(Date.now() + 4000))).toBe(
        1,
      );
      expect(
        await settle(
          db.client,
          scope,
          first.row,
          keys,
          { question: "synthetic", reply, usedCalls: 1, uncertain: false },
          new Date(),
        ),
      ).toBe(false);
      expect(await recover(db.client, scope, new Date(Date.now() + 4000))).toBe(
        0,
      );
      expect(
        db.state.quotas.every((x) => x.reservedCalls === (dispatched ? 2 : 0)),
      ).toBe(true);
    },
  );
  it("rotation retains subject bucket and old request digest; missing retained key refuses", async () => {
    const db = memoryClient();
    await claim(db.client, scope, skill(), keys, limits, new Date());
    const env = environment();
    env.AI_HMAC_KEYS = JSON.stringify({
      v1: Buffer.alloc(32, 2).toString("base64"),
      v2: Buffer.alloc(32, 5).toString("base64"),
    });
    env.AI_HMAC_ACTIVE = "v2";
    await claim(db.client, scope, skill(), readKeys(env), limits, new Date());
    expect(db.state.quotas).toHaveLength(3);
    expect(
      db.state.quotas.find((x) => String(x.bucketKey).startsWith("subject:"))
        ?.accepted,
    ).toBe(2);
    env.AI_HMAC_KEYS = JSON.stringify({
      v2: Buffer.alloc(32, 5).toString("base64"),
    });
    await expect(
      claim(db.client, scope, skill(), readKeys(env), limits, new Date()),
    ).rejects.toThrow();
  });
  it("revoked lease refuses all writes without row creation", async () => {
    const db = memoryClient();
    db.revoke();
    await expect(
      claim(db.client, scope, skill(), keys, limits, new Date()),
    ).rejects.toThrow();
    expect(db.state.consultations).toHaveLength(0);
    expect(db.state.quotas).toHaveLength(0);
  });
  it("cost arithmetic rejects overshoot/negative and conservatively retains unknown", () => {
    expect(() =>
      reservationSettlement({
        reservedCalls: 2,
        reservedCost: 100,
        usedCalls: 3,
        usedCost: 1,
        dispatched: true,
        uncertain: false,
      }),
    ).toThrow();
    expect(() =>
      reservationSettlement({
        reservedCalls: 2,
        reservedCost: 100,
        usedCalls: 1,
        usedCost: -1,
        dispatched: true,
        uncertain: false,
      }),
    ).toThrow();
    expect(
      reservationSettlement({
        reservedCalls: 2,
        reservedCost: 100,
        usedCalls: 1,
        usedCost: 25,
        dispatched: true,
        uncertain: false,
      }),
    ).toEqual({ refundCalls: 1, refundCost: 75, usedCalls: 1, usedCost: 25 });
    expect(
      reservationSettlement({
        reservedCalls: 2,
        reservedCost: 100,
        usedCalls: 0,
        usedCost: 0,
        dispatched: true,
        uncertain: true,
      }),
    ).toEqual({ refundCalls: 0, refundCost: 0, usedCalls: 0, usedCost: 0 });
  });
});

it("transaction failures never expose raw database messages", async () => {
  const db = memoryClient();
  db.client.$transaction = async () => {
    throw new Error("postgresql://SECRET_CREDENTIAL@host");
  };
  await expect(
    claim(db.client, scope, skill(), keys, limits, new Date()),
  ).rejects.toThrow(/^AI_REQUEST_DENIED$/);
});

it.each([false, true])(
  "recovery counts anonymous handoff exactly once through concurrency/retry/late settle/purge, dispatched=%s",
  async (dispatched) => {
    const db = memoryClient();
    const now = new Date();
    const input = skill();
    const result = await claim(db.client, scope, input, keys, limits, now);
    if (result.kind !== "NEW") throw new Error("NEW expected");
    if (dispatched) await dispatch(db.client, scope, result.row, now);
    const stale = new Date(now.getTime() + 4000);
    const recovered = await Promise.all([
      recover(db.client, scope, stale),
      recover(db.client, scope, stale),
    ]);
    expect(recovered.sort()).toEqual([0, 1]);
    expect(await recover(db.client, scope, stale)).toBe(0);
    expect(
      await settle(
        db.client,
        scope,
        result.row,
        keys,
        {
          question: input.userRequest.utterance,
          reply: { category: "HUMAN_HANDOFF", text: "late" },
          usedCalls: 1,
          uncertain: false,
        },
        stale,
      ),
    ).toBe(false);
    expect(db.state.metrics).toHaveLength(1);
    expect(db.state.metrics[0]).toEqual(
      expect.objectContaining({
        category: "HUMAN_HANDOFF",
        count: 1,
        modelCalls: 0,
        syntheticCost: 0,
      }),
    );
    expect(
      db.state.quotas.every(
        (row) => row.reservedCalls === (dispatched ? 2 : 0),
      ),
    ).toBe(true);
    const serialized = JSON.stringify(db.state.metrics);
    for (const secret of [
      scope.runId,
      input.userRequest.user.id,
      input.action.params.requestId,
      "subjectHashes",
      "rawCiphertext",
      "question",
    ])
      expect(serialized).not.toContain(secret);
    const { purgeExpired } = await import(
      "@/server/ai-consultations/retention"
    );
    const { RETENTION_MS } = await import("@/lib/ai-consultations/contracts");
    expect(
      (
        await purgeExpired(
          db.client,
          scope,
          new Date(now.getTime() + RETENTION_MS),
        )
      ).deleted,
    ).toBe(1);
    expect(db.state.metrics[0].count).toBe(1);
  },
);
