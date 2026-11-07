import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { recordLateResult } from "@/server/kakao/late-result";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `g2-lateresult-${randomUUID()}`;
const at = new Date("2040-01-01T00:00:00Z");
const ref = `g2ref_${"a".repeat(32)}`;
beforeAll(async () => { await db.user.create({ data: { id: run, email: `${run}@example.test`, name: "synthetic", role: "ADMIN" } }); });
afterAll(async () => { try { await db.user.deleteMany({ where: { id: run } }); } finally { await db.$disconnect(); } });

// Preview is a fixed value in the real guard, so fail if any other fixture owns
// that namespace; never overwrite it or delete pre-existing rows.
async function withRealGuard<T>(test: (f: Awaited<ReturnType<typeof createRealGuard>>) => Promise<T>): Promise<T> {
  const f = await createRealGuard();
  try { return await test(f); } finally { await f.cleanup(); }
}
async function createRealGuard() {
  const id = randomUUID(), registration = `${id}-recipient`, eventId = `${id}-evidence`;
  const key = randomBytes(32), keyVersion = `k${randomUUID()}`, namespace = `test_${randomUUID()}`;
  const input = buildOutboxInput("application.received", `phase8_${id}`, "created", "admin", at);
  const encrypted = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), key, 1n,
    { environment: "preview", registrationId: registration, registrationVersion: "v1", keyVersion },
    { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true });
  let runtimeCreated = false;
  const cleanup = async () => {
    await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "registrationId"=${registration} OR "dispatchId"=${id}`;
    await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${id} AND "entryKind"='COST_CORRECTION'`;
    await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${id} AND "entryKind"='LOOKUP_COST'`;
    await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${id} AND "entryKind"='SEND_SLOT'`;
    await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "id"=${id}`;
    await db.$executeRaw`DELETE FROM "NotificationRecipientRegistration" WHERE "id"=${registration}`;
    if (runtimeCreated) {
      await db.$executeRaw`DELETE FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND (("periodType"='day' AND "periodKey"='2040-01-01') OR ("periodType"='month' AND "periodKey"='2040-01'))`;
      await db.$executeRaw`DELETE FROM "NotificationRuntimeConfig" WHERE "environment"='preview' AND "namespace"=${namespace}`;
    }
    await db.notificationOutbox.deleteMany({ where: { id } });
    await db.reservationApplicationSubmission.deleteMany({ where: { id: input.entityId } });
    key.fill(0);
  };
  try {
    const occupied = await db.$queryRaw<{ count: bigint }[]>`SELECT (SELECT count(*) FROM "NotificationRuntimeConfig" WHERE "environment"='preview') + (SELECT count(*) FROM "NotificationRecipientRegistration" WHERE "environment"='preview' AND "service"='application.received' AND "state"='active') + (SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND (("periodType"='day' AND "periodKey"='2040-01-01') OR ("periodType"='month' AND "periodKey"='2040-01') OR ("periodType"='day' AND "periodKey"='2040-02-01') OR ("periodType"='month' AND "periodKey"='2040-02'))) + (SELECT count(*) FROM "NotificationDispatch" WHERE "environment"='preview') AS count`;
    if (occupied[0]!.count !== 0n) throw new Error("Synthetic preview fixture namespace is occupied");
    await db.$executeRaw`INSERT INTO "NotificationRuntimeConfig" ("environment", "namespace", "blocked", "activationEpoch", "providerId", "recipientVersion", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "updatedAt") VALUES ('preview', ${namespace}, false, ${at}, 'solapi', 'v1', 'g2-v1', 'g2-v1', 'g2-v1', ${keyVersion}, 1, true, true, true, ${at})`;
    runtimeCreated = true;
    await db.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "synthetic", submittedAt: at } });
    await db.notificationOutbox.create({ data: { ...input, id } });
    await db.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt") VALUES (${registration}, 'preview', 'application.received', ${run}, 'v1', 'active', 'v1', 'v1', ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${keyVersion}, 'synthetic_call', 'mock_ownership_v1', ${run}, ${at})`;
    await db.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "registrationId", "eventType", "toState", "actorId", "evidenceId", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', ${registration}, 'synthetic_ownership_confirmed', 'v1', ${run}, 'mock_ownership_v1', ${at})`;
    await db.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion") VALUES (${id}, ${id}, 'preview', ${`${namespace}:${input.dedupeKey}`}, 'solapi', ${registration}, 'v1', 'mock_application_received_v1', 'g2-v1', ${at}, 'ready', 'g2-v1')`;
    const context = { event: "application.received" as const, audience: "admin" as const, dedupeKey: input.dedupeKey, recipientId: registration, recipientVersion: "v1", submittedAt: at, templateId: "mock_application_received_v1" as const, templateVersion: "g2-v1" as const, variables: { 접수시각: "2040-01-01 09:00" } };
    const prepared = { dispatchId: id, context, recipientKey: { key, keyVersion, synthetic: true as const }, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const };
    const scoped = db.$extends({ query: { notificationOutbox: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id }] } }); } } } });
    return { id, input, prepared, scoped, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

async function insertUnknownSlot(dispatchId: string, slot: string) {
  await db.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount"=1 WHERE "id"=${dispatchId}`;
  await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${slot}, ${dispatchId}, 'SEND_SLOT', 1, 'unknown', ${at}, '2040-01-01', '2040-01', 15000, 'reserved_unknown')`;
}

async function snapshot(f: { id: string; input: { dedupeKey: string } }) {
  return {
    outbox: await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } }),
    dispatch: await db.$queryRaw`SELECT * FROM "NotificationDispatch" WHERE "id"=${f.id}`,
    costs: await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`,
    audits: await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} OR "dispatchId"=${f.id} ORDER BY "id"`,
  };
}

describe.sequential("G2 late-result PostgreSQL evidence", () => {
  it("rejects a late result for a purged slot detail without regenerating it", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount"=1 WHERE "id"=${f.id}`;
      // Synthetic defense-in-depth check: this unknown slot + summary_purged /
      // detailPurgedAt combination is unreachable via the real purge path, which
      // rejects while unknown/in_flight/accepted slots remain. Amounts are NULL,
      // costState is summary_purged, costSummaryPurgedAt is set, and the slot
      // detail itself is purged.
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costState", "costSummaryPurgedAt", "detailPurgedAt") VALUES (${slot}, ${f.id}, 'SEND_SLOT', 1, 'unknown', ${at}, '2040-01-01', '2040-01', NULL, NULL, NULL, 'summary_purged', ${at}, ${at})`;
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='failed', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const before = await snapshot(f);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      const after = await snapshot(f);
      expect(after).toEqual(before);
      expect(await db.$queryRaw<{ providerRef: string | null; resultAt: Date | null }[]>`SELECT "providerRef", "resultAt" FROM "NotificationCostReservation" WHERE "id"=${slot}`).toEqual([{ providerRef: null, resultAt: null }]);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toEqual([]);
    });
  }, 30000);
  it("rejects a late result for a purged dispatch without changing it", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await insertUnknownSlot(f.id, slot);
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "purgedAt"=${at} WHERE "id"=${f.id}`;
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='failed', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const before = await snapshot(f);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      expect(await snapshot(f)).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toEqual([]);
    });
  }, 30000);
  it("rejects a late result for a terminally skipped outbox without reviving it", async () => {
    await withRealGuard(async (f) => {
      const store = new PrismaOutboxStore(f.scoped);
      const [claim] = await store.claimDue(1, at);
      expect(await store.markSkipped(f.id, claim!.claimToken!, "send_disabled")).toMatchObject({ status: "skipped" });
      // Direct insertion synthesizes a live unknown slot after terminal skip, outside
      // the normal path: even then the terminal outbox must not accept a late result.
      const slot = `${f.id}-slot`;
      await insertUnknownSlot(f.id, slot);
      const before = await snapshot(f);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      expect(await snapshot(f)).toEqual(before);
      expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "skipped", attemptCount: 0 });
      const provider = new MockProvider({ code: "S_ACCEPTED", ref });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const result = await processOutboxBatch(store, { provider: null, now: at, safe: { repository, provider, clock: () => at, prepare: async () => f.prepared } });
        expect(result.outcomes).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
      expect(await snapshot(f)).toEqual(before);
    });
  }, 30000);
  it.each([
    { status: "accepted" as const, result: { status: "accepted", providerId: "solapi", ref, phase: "accepted" } as const, slotStatus: "accepted", dispatchState: "awaiting_final", auditRef: ref },
    { status: "definite_rejection" as const, result: { status: "definite_rejection", retryable: false, nonBillableEvidence: true } as const, slotStatus: "rejected", dispatchState: "rejected", auditRef: null },
  ])("records a late $status for a sent outbox on the same slot only, without resending", async ({ result, slotStatus, dispatchState, auditRef }) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await insertUnknownSlot(f.id, slot);
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='sent', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const dispatchBefore = await db.$queryRaw<{ auditSequence: number }[]>`SELECT "auditSequence" FROM "NotificationDispatch" WHERE "id"=${f.id}`;
      const outboxBefore = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await recordLateResult(repository, permit, result, at);
      expect(await db.$queryRaw<{ status: string; providerRef: string | null; resultAt: Date }[]>`SELECT "status", "providerRef", "resultAt" FROM "NotificationCostReservation" WHERE "id"=${slot}`).toEqual([{ status: slotStatus, providerRef: auditRef, resultAt: at }]);
      expect(await db.$queryRaw<{ reconciliationState: string; auditSequence: number }[]>`SELECT "reconciliationState", "auditSequence" FROM "NotificationDispatch" WHERE "id"=${f.id}`).toEqual([{ reconciliationState: dispatchState, auditSequence: dispatchBefore[0]!.auditSequence + 1 }]);
      expect(await db.$queryRaw<{ providerRef: string | null; sequence: number }[]>`SELECT "providerRef", "sequence" FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toEqual([{ providerRef: auditRef, sequence: dispatchBefore[0]!.auditSequence + 1 }]);
      const outboxAfter = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      expect(outboxAfter.status).toBe("sent");
      expect(outboxAfter.dedupeKey).toBe(outboxBefore.dedupeKey);
      expect(outboxAfter.occurredAt).toEqual(outboxBefore.occurredAt);
      expect(outboxAfter.attemptCount).toBe(outboxBefore.attemptCount);
      expect(await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "dedupeKey"=${f.input.dedupeKey}`).toHaveLength(1);
      expect(await db.$queryRaw`SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${f.id}`).toHaveLength(1);
      expect(await db.$queryRaw`SELECT "id" FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id}`).toHaveLength(1);
      const store = new PrismaOutboxStore(f.scoped);
      const provider = new MockProvider({ code: "S_ACCEPTED", ref });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const batch = await processOutboxBatch(store, { provider: null, now: at, safe: { repository, provider, clock: () => at, prepare: async () => f.prepared } });
        expect(batch.outcomes).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
      expect(await db.$queryRaw`SELECT "id" FROM "NotificationOutbox" WHERE "dedupeKey"=${f.input.dedupeKey}`).toHaveLength(1);
    });
  }, 30000);
  it.each([
    { name: "dedupeKey", mutate: (context: { dedupeKey: string }) => ({ ...context, dedupeKey: context.dedupeKey.slice(0, -1) + (context.dedupeKey.endsWith("0") ? "1" : "0") }) },
    { name: "submittedAt", mutate: (context: { submittedAt: Date }) => ({ ...context, submittedAt: new Date(at.getTime() + 3600000), variables: { 접수시각: "2040-01-01 10:00" } }) },
    { name: "recipientId", mutate: (context: { recipientId: string }) => ({ ...context, recipientId: `${context.recipientId}-other` }) },
    { name: "recipientVersion", mutate: (context: { recipientVersion: string }) => ({ ...context, recipientVersion: "v2" }) },
  ])("rejects a late result with a tampered $name and preserves the original identity", async ({ mutate }) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await insertUnknownSlot(f.id, slot);
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='sent', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const before = await snapshot(f);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: mutate(f.prepared.context as never) as typeof f.prepared.context };
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      expect(await snapshot(f)).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toEqual([]);
    });
  }, 30000);
  it("rejects a second late result for the same slot instead of replaying it", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await insertUnknownSlot(f.id, slot);
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='sent', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at);
      const afterFirst = await snapshot(f);
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      expect(await snapshot(f)).toEqual(afterFirst);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toHaveLength(1);
    });
  }, 30000);
  it("rejects a late result against a settled rejected slot", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 'SEND_SLOT', 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 500, 'settled')`;
      await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='failed', "nextRetryAt"=NULL WHERE "id"=${f.id}`;
      const before = await snapshot(f);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const permit = { dispatchId: f.id, slotId: slot, claimToken: "synthetic-claim-token", providerId: "solapi" as const, context: f.prepared.context };
      await expect(recordLateResult(repository, permit, { status: "accepted", providerId: "solapi", ref, phase: "accepted" }, at)).rejects.toThrow("Late result unavailable.");
      expect(await snapshot(f)).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} AND "eventType"='result_recorded'`).toEqual([]);
      const store = new PrismaOutboxStore(f.scoped);
      const provider = new MockProvider({ code: "S_ACCEPTED", ref });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const batch = await processOutboxBatch(store, { provider: null, now: at, safe: { repository, provider, clock: () => at, prepare: async () => f.prepared } });
        expect(batch.outcomes).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
      expect(await snapshot(f)).toEqual(before);
    });
  }, 30000);
});
