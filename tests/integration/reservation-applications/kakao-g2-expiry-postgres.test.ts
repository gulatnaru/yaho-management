import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore, PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { InMemoryDispatchRepository, PrismaDispatchRepository, type CoreState, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `g2-expiry-${randomUUID()}`;
const at = new Date("2040-01-01T00:00:00Z");
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
    const prepared = { dispatchId: id, context, syntheticKey: { key, keyVersion, synthetic: true as const }, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const };
    const scoped = db.$extends({ query: { notificationOutbox: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id }] } }); } } } });
    return { id, input, prepared, scoped, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

describe.sequential("G2 expiry PostgreSQL evidence", () => {
  it.each(["dry-run", "off"] as const)("terminally skips %s without sending", async (kind) => {
    await withRealGuard(async (f) => {
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const store = new PrismaOutboxStore(f.scoped);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const safe = { repository, provider, clock: () => at, prepare: async () => ({ ...f.prepared, config: { ...f.prepared.config, mode: kind === "dry-run" ? "dry-run" : "live", enabled: kind !== "off" } }) };
        const result = await processOutboxBatch(store, { provider: null, now: at, safe });
        expect(result.outcomes).toMatchObject([{ status: "skipped" }]);
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "skipped", lastErrorCode: "send_disabled", attemptCount: 0 });
        const audits = await db.$queryRaw<{ code: string }[]>`SELECT "code" FROM "NotificationAudit" WHERE "outboxId"=${f.id} AND "eventType"='outbox_skipped'`;
        expect(audits).toEqual([{ code: "send_disabled" }]); expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });
  }, 30000);
  it("preserves a rejected slot and its unresolved lookup across skip and expiry, then expires once settled", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, 'unknown', ${at}, '2040-01-01', '2040-01', 500, 'reserved_unknown')`;
      await db.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "blocked"=true WHERE "environment"='preview'`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000);
      const [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const evidence = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      await expect(store.markSkipped(f.id, claim!.claimToken!, "send_disabled")).rejects.toThrow();
      await expect(store.markExpired(f.id, "stale", expiry)).rejects.toThrow();
      await expect(store.markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(evidence);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
      await db.$executeRaw`UPDATE "NotificationCostReservation" SET "status"='resolved', "reservedMilliKrw"=0, "confirmedMilliKrw"=500, "costState"='settled' WHERE "id"=${lookup}`;
      const results = await Promise.allSettled([store.markExpired(f.id, claim!.claimToken!, expiry), store.markExpired(f.id, claim!.claimToken!, expiry)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "skipped", lastErrorCode: "event_expired" });
    });
  }, 30000);
  it.each(["unknown", "in_flight"] as const)("rejects a synthetic zero-reservation %s lookup on skip and expiry", async (status) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, ${status}, ${at}, '2040-01-01', '2040-01', 0, 'reserved')`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000);
      const [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const dispatch = await db.$queryRaw`SELECT * FROM "NotificationDispatch" WHERE "id"=${f.id}`;
      const costs = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      await expect(store.markSkipped(f.id, claim!.claimToken!, "send_disabled")).rejects.toThrow();
      await expect(store.markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationDispatch" WHERE "id"=${f.id}`).toEqual(dispatch);
      expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(costs);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
    });
  }, 30000);
  it.each(["skip", "expiry"] as const)("DB-permitted synthetic unresolved purged lookup with NULL reservation blocks %s", async (transition) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      // Direct insertion synthesizes an unresolved purged lookup, outside the normal purge path.
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "costState", "costSummaryPurgedAt") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, 'unknown', ${at}, '2040-01-01', '2040-01', NULL, NULL, NULL, 'summary_purged', ${at})`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000), [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const costs = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      await expect(transition === "skip" ? store.markSkipped(f.id, claim!.claimToken!, "send_disabled") : store.markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(costs);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
    });
  }, 30000);
  it.each(["skip", "expiry"] as const)("synthetic mixed dispatch, slot, lookup and correction evidence blocks %s", async (transition) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`, correction = `${f.id}-correction`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='open_unknown', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'unknown', ${at}, '2040-01-01', '2040-01', 15000, 'reserved_unknown')`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, 'unknown', ${at}, '2040-01-01', '2040-01', 500, 'reserved_unknown')`;
      // The proposed correction is synthetic; the real path requires a summary_purged source slot.
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "sourceCostId", "status", "issuedAt", "dayKey", "monthKey", "adjustmentMilliKrw", "adjustmentEvidenceId", "adjustmentApprovalId", "evidenceVerifiedAt", "expectedCostRevision", "expectedPeriodRevision", "correctionVersion", "costState") VALUES (${correction}, ${f.id}, 'COST_CORRECTION', ${correction}, ${slot}, ${lookup}, 'proposed', ${at}, '2040-01-01', '2040-01', 0, 'evidence', 'approval', ${at}, 0, 0, 'v1', 'proposed')`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000), [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const costs = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      await expect(transition === "skip" ? store.markSkipped(f.id, claim!.claimToken!, "send_disabled") : store.markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(costs);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
    });
  }, 30000);
  it("skips with a synthetic applied correction whose reservation is null", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, correction = `${f.id}-correction`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      // Synthetic insertion bypasses the real correction path's summary_purged source-slot requirement.
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "sourceCostId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "adjustmentEvidenceId", "adjustmentApprovalId", "evidenceVerifiedAt", "expectedCostRevision", "expectedPeriodRevision", "correctionVersion", "costState") VALUES (${correction}, ${f.id}, 'COST_CORRECTION', ${correction}, ${slot}, ${slot}, 'applied', ${at}, '2040-01-01', '2040-01', NULL, NULL, 0, 'evidence', 'approval', ${at}, 0, 0, 'v1', 'applied')`;
      const store = new PrismaOutboxStore(f.scoped), [claim] = await store.claimDue(1, at);
      expect(await store.markSkipped(f.id, claim!.claimToken!, 'send_disabled', at)).toMatchObject({ status: 'skipped' });
      const costs = await db.$queryRaw<{ reservedMilliKrw: bigint | null; status: string }[]>`SELECT "reservedMilliKrw", "status" FROM "NotificationCostReservation" WHERE "id"=${correction}`;
      expect(costs).toEqual([{ reservedMilliKrw: null, status: 'applied' }]);
    });
  }, 30000);
  it.each(["skip", "expiry"] as const)("DB-permitted synthetic resolved lookup with unsettled zero reservation blocks %s", async (transition) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, 'resolved', ${at}, '2040-01-01', '2040-01', 0, 'reserved')`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000), [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const costs = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      await expect(transition === "skip" ? store.markSkipped(f.id, claim!.claimToken!, "send_disabled") : store.markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(costs);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
    });
  }, 30000);
  it.each(["skip", "expiry"] as const)("DB-permitted synthetic applied purged correction allows %s", async (transition) => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, correction = `${f.id}-correction`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 500, 'settled')`;
      // Synthetic insertion bypasses the real correction path's summary_purged source-slot requirement.
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "sourceCostId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "adjustmentMilliKrw", "correctionVersion", "costState", "costSummaryPurgedAt") VALUES (${correction}, ${f.id}, 'COST_CORRECTION', ${correction}, ${slot}, ${slot}, 'applied', ${at}, '2040-01-01', '2040-01', NULL, NULL, NULL, 'v1', 'summary_purged', ${at})`;
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000), [claim] = await store.claimDue(1, expiry);
      const result = transition === "skip" ? await store.markSkipped(f.id, claim!.claimToken!, "send_disabled") : await store.markExpired(f.id, claim!.claimToken!, expiry);
      expect(result.status).toBe("skipped");
      expect(await db.$queryRaw`SELECT "eventType" FROM "NotificationAudit" WHERE "outboxId"=${f.id} AND "eventType"='outbox_skipped'`).toHaveLength(1);
    });
  }, 30000);
  it("worker preserves unresolved evidence past 24h without terminal processing or sending", async () => {
    await withRealGuard(async (f) => {
      const slot = `${f.id}-slot`, lookup = `${f.id}-lookup`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState"='rejected', "slotCount"=1 WHERE "id"=${f.id}`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "confirmedMilliKrw", "costState") VALUES (${slot}, ${f.id}, 1, 'rejected', ${at}, '2040-01-01', '2040-01', 0, 0, 'settled')`;
      await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "entryKind", "operationKey", "sourceSlotId", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${lookup}, ${f.id}, 'LOOKUP_COST', ${lookup}, ${slot}, 'unknown', ${at}, '2040-01-01', '2040-01', 500, 'reserved_unknown')`;
      await db.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "blocked"=true WHERE "environment"='preview'`;
      const dispatch = await db.$queryRaw`SELECT * FROM "NotificationDispatch" WHERE "id"=${f.id}`;
      const reservations = await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`;
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} OR "outboxId"=${f.id} OR "registrationId"=${f.prepared.context.recipientId} ORDER BY "id"`;
      const store = new PrismaOutboxStore(f.scoped), repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const provider = new MockProvider({ code: "S_UNKNOWN" }), expiry = new Date(at.getTime() + 86400000);
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const result = await processOutboxBatch(store, { provider: null, now: expiry, safe: { repository, provider, clock: () => expiry, prepare: async () => f.prepared } });
        expect(result.outcomes).toMatchObject([{ rowId: f.id, status: "failed", reason: "invalid_transition" }]);
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "processing", lastErrorCode: null, attemptCount: 0 });
        expect(await db.$queryRaw`SELECT * FROM "NotificationDispatch" WHERE "id"=${f.id}`).toEqual(dispatch);
        expect(await db.$queryRaw`SELECT * FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} ORDER BY "id"`).toEqual(reservations);
        expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "dispatchId"=${f.id} OR "outboxId"=${f.id} OR "registrationId"=${f.prepared.context.recipientId} ORDER BY "id"`).toEqual(audits);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });
  }, 30000);
  it("worker expires a clean blocked row past 24h as event_expired", async () => {
    await withRealGuard(async (f) => {
      await db.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "blocked"=true WHERE "environment"='preview'`;
      const store = new PrismaOutboxStore(f.scoped), repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const provider = new MockProvider({ code: "S_UNKNOWN" }), expiry = new Date(at.getTime() + 86400000);
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const result = await processOutboxBatch(store, { provider: null, now: expiry, safe: { repository, provider, clock: () => expiry, prepare: async () => f.prepared } });
        expect(result.outcomes).toMatchObject([{ rowId: f.id, status: "skipped", rowStatus: "skipped" }]);
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "skipped", lastErrorCode: "event_expired", attemptCount: 0 });
        const audits = await db.$queryRaw<{ code: string }[]>`SELECT "code" FROM "NotificationAudit" WHERE "outboxId"=${f.id} AND "eventType"='outbox_skipped'`;
        expect(audits).toEqual([{ code: "event_expired" }]);
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });
  }, 30000);
  it("fails closed without a guard and preserves a blocked pre-expiry claim", async () => {
    await withRealGuard(async (f) => {
      const store = new PrismaOutboxStore(f.scoped);
      expect(await processOutboxBatch(store, { provider: null, now: at })).toMatchObject({ error: "guard_unavailable", outcomes: [] });
      expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "pending", attemptCount: 0 });
      await db.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "blocked"=true WHERE "environment"='preview'`;
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      const prior = new Date(at.getTime() + 86400000 - 1);
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        await processOutboxBatch(store, { provider: null, now: prior, safe: { repository, provider, clock: () => prior, prepare: async () => f.prepared } });
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0 });
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    });
  }, 30000);
  it("rolls back a real expiry transaction when audit insertion fails", async () => {
    await withRealGuard(async (f) => {
      const store = new PrismaOutboxStore(f.scoped), expiry = new Date(at.getTime() + 86400000);
      const [claim] = await store.claimDue(1, expiry);
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const audits = await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`;
      const wrapped = { $transaction: async (work: (tx: unknown) => Promise<unknown>) => db.$transaction(async (tx) => work(new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "$executeRaw") return (parts: TemplateStringsArray, ...values: unknown[]) => {
            if (parts.join("?").includes('INSERT INTO "NotificationAudit"')) throw new Error("synthetic audit failure");
            return target.$executeRaw(parts, ...values);
          };
          return Reflect.get(target, property, receiver);
        },
      }))) };
      await expect(new PrismaOutboxStore(wrapped as unknown as ConstructorParameters<typeof PrismaOutboxStore>[0]).markExpired(f.id, claim!.claimToken!, expiry)).rejects.toThrow("synthetic audit failure");
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "outboxId"=${f.id} ORDER BY "id"`).toEqual(audits);
    });
  }, 30000);
  it("in-memory skip and expiry preserve the same linked lookup evidence", async () => {
    await withRealGuard(async (f) => {
      const state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
      const repository = new InMemoryDispatchRepository(state), store = new InMemoryOutboxStore(repository);
      await store.enqueue(f.input);
      const [claim] = await store.claimDue(1, at);
      await repository.transaction(async (candidate) => {
        candidate.dispatches.push({ id: "dispatch", outboxId: claim!.id, clientKey: "synthetic", context: f.prepared.context, slotCount: 1, auditSequence: 0, state: "rejected", unknownSince: null });
        candidate.slots.push({ id: "slot", dispatchId: "dispatch", sequence: 1, month: "2040-01", day: "2040-01-01", status: "rejected", reserved: 0, confirmed: 0, costState: "settled", issuedAt: at });
        candidate.lookups.push({ id: "lookup", slotId: "slot", month: "2040-01", status: "unknown", reserved: 500, confirmed: 0 });
      });
      const before = await repository.snapshot(), expiry = new Date(at.getTime() + 86400000);
      await expect(store.markSkipped(claim!.id, claim!.claimToken!, "send_disabled")).rejects.toThrow();
      await expect(store.markExpired(claim!.id, claim!.claimToken!, expiry)).rejects.toThrow();
      expect(await repository.snapshot()).toEqual(before);
    });
  }, 30000);
  it("retains the migration catalog constraints on cost reservations", async () => {
    // The previous third name exists in neither migrations nor schema; use the actual slot status CHECK name.
    const constraints = await db.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conrelid='"NotificationCostReservation"'::regclass AND conname IN ('notification_cost_source_slot_fk', 'notification_cost_source_cost_fk', 'notification_slot_status_allowed')`;
    expect(constraints.map((row) => row.conname)).toEqual(expect.arrayContaining(["notification_cost_source_slot_fk", "notification_cost_source_cost_fk", "notification_slot_status_allowed"]));
  });
});
