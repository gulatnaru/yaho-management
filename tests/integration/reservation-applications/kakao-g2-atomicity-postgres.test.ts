import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { submitApplicationGroupCore } from "@/server/reservation-applications/groups";

// Actual PostgreSQL only; these tests are not fake-repository evidence.
// Adapted from the kakao worktree: the admin core has no price-review
// (no recheckApplicationGroupPricesCore / verifyApplicationPriceReview), so
// test 2 captures the server-generated submission id from the wrapped
// transaction's return value instead of deriving `phase8_<operation>`
// beforehand, and the submit input carries no reviewedPriceProof. The admin
// groupSubmissionSchema also has no consentVersion inside `data` (it is a
// top-level input field only). No AUTH_SECRET stub: nothing here signs a
// price review.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `g2-${randomUUID()}`;
const at = new Date("2040-01-01T00:00:00Z");
const groupId = `${run}-group`, classId = `${run}-class`;
let submissionId = "";

beforeAll(async () => {
  await db.user.create({ data: { id: run, email: `${run}@example.test`, name: "synthetic", role: "ADMIN" } });
  await db.program.create({ data: { id: run, name: "synthetic", defaultPrice: 100 } });
  await db.classSchedule.create({ data: { id: classId, programId: run, status: "SCHEDULED", capacity: 8, startsAt: new Date("2040-02-01T00:00:00Z"), endsAt: new Date("2040-02-01T01:00:00Z"), location: "synthetic", applicationPrice: 100 } });
  await db.reservationApplicationGroup.create({ data: { id: groupId, createdById: run, classes: { create: { classScheduleId: classId } } } });
}, 30000);
afterAll(async () => {
  try {
    await db.notificationOutbox.deleteMany({ where: { entityId: submissionId } });
    await db.deviceSubmission.deleteMany({ where: { submissionId } });
    await db.reservationApplication.deleteMany({ where: { submissionId } });
    await db.reservationApplicationSubmission.deleteMany({ where: { id: submissionId } });
    await db.reservationApplicationLink.deleteMany({ where: { groupId } });
    await db.reservationApplicationGroupClass.deleteMany({ where: { groupId } });
    await db.reservationApplicationGroup.deleteMany({ where: { id: groupId } });
    await db.classSchedule.deleteMany({ where: { id: classId } });
    await db.program.deleteMany({ where: { id: run } });
    await db.user.deleteMany({ where: { id: run } });
  } finally { await db.$disconnect(); }
}, 30000);

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
    await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${id}`;
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

describe.sequential("G2 actual PostgreSQL transaction evidence", () => {
  it("2: rolls back the real submission core after both application and outbox INSERTs", async () => {
    const capability = `${randomUUID().replaceAll("-", "")}synthetic`;
    await db.reservationApplicationLink.create({ data: { groupId, tokenHash: hashApplicationCapabilityToken(capability), issuedById: run } });
    const expires = new Date(at.getTime() + 86400000);
    const failure = new Error("synthetic failure after outbox insertion");
    let inside = false;
    // Preserve the real core and Prisma transaction; inject only at the callback boundary.
    // Admin core has no price-review: the submission id is a server-generated cuid,
    // captured here from the core's return value inside the wrapped transaction.
    const wrapped = {
      classSchedule: db.classSchedule, reservationApplicationGroup: db.reservationApplicationGroup,
      reservationApplicationLink: db.reservationApplicationLink,
      $transaction: ((work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { maxWait: number; timeout: number }) => db.$transaction(async (tx) => {
        const result = await work(tx) as { submissionId: string; applicationIds: string[] };
        submissionId = result.submissionId;
        const apps = await tx.reservationApplication.count({ where: { submissionId } });
        const outbox = await tx.notificationOutbox.count({ where: { entityId: submissionId } });
        inside = apps === 1 && outbox === 1;
        throw failure;
      }, options)) as unknown as typeof db.$transaction,
    };
    await expect(submitApplicationGroupCore(wrapped, {
      token: capability, consentVersion: APPLICATION_CONSENT_CONTENT.version, now: at, configReady: true,
      completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: expires,
      deviceTokenHash: hashApplicationCapabilityToken(randomUUID()), deviceExpiresAt: expires,
      data: {
        guardianName: "synthetic", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "synthetic",
        children: [{ classScheduleId: classId, childName: "synthetic", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED", programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true, photoShareConsent: false, photoMarketingConsent: false }] },
    })).rejects.toBe(failure);
    expect(inside).toBe(true);
    expect(await db.reservationApplicationSubmission.count({ where: { id: submissionId } })).toBe(0);
    expect(await db.reservationApplication.count({ where: { submissionId } })).toBe(0);
    expect(await db.notificationOutbox.count({ where: { entityId: submissionId } })).toBe(0);
  }, 30000);

  it("3: rejects undeclared cost status, negative nonce, invalid archive and missing dispatch FK", async () => {
    const id = randomUUID();
    await expect(db.$executeRaw`INSERT INTO "NotificationRuntimeConfig" ("environment", "namespace", "nonceHighWater", "updatedAt") VALUES (${id}, ${id}, -1, ${at})`).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
    await expect(db.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion", "confirmedMilliKrw", "archivedConfirmedMilliKrw") VALUES (${id}, ${id}, 'synthetic', 'month', '2040-01', 'v1', 0, 1)`).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
    await expect(db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${id}, ${id}, 1, 'in_flight', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`).rejects.toMatchObject({ code: "P2010", meta: { code: "23503" } });
    await expect(db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${id}, ${id}, 1, 'invalid', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
  });

  it("6: real SQL commits slot, budget reservation and audit together and rolls them back on failure", async () => {
    const id = randomUUID(), slot = `${id}-slot`, audit = `${id}-audit`, budget = `${id}-budget`;
    const failure = new Error("synthetic transaction failure");
    await db.notificationOutbox.create({ data: { id, eventKind: "application.received", entityId: id, dedupeKey: id, audience: "admin", occurredAt: at } });
    try {
      await db.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion") VALUES (${id}, ${id}, 'synthetic', ${run}, 'v1', 'active', 'v1', 'v1')`;
      await db.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion") VALUES (${id}, ${id}, ${id}, ${id}, 'mock', ${id}, 'v1', 'synthetic', 'v1', ${at}, 'ready', 'v1')`;
      const write = async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${slot}, ${id}, 1, 'in_flight', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`;
        await tx.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion", "reservedMilliKrw") VALUES (${budget}, ${id}, 'synthetic', 'month', '2040-01', 'v1', 1)`;
        await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "dispatchId", "slotId", "eventType", "sequence", "occurredAt") VALUES (${audit}, ${audit}, ${id}, ${id}, ${slot}, 'permit_issued', 1, ${at})`;
      };
      await expect(db.$transaction(async (tx) => { await write(tx); throw failure; })).rejects.toBe(failure);
      const counts = () => db.$queryRaw<{ slots: bigint; budgets: bigint; audits: bigint }[]>`SELECT (SELECT count(*) FROM "NotificationCostReservation" WHERE "id"=${slot}) AS slots, (SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "id"=${budget}) AS budgets, (SELECT count(*) FROM "NotificationAudit" WHERE "id"=${audit}) AS audits`;
      expect(await counts()).toEqual([{ slots: 0n, budgets: 0n, audits: 0n }]);
      await db.$transaction(write);
      expect(await counts()).toEqual([{ slots: 1n, budgets: 1n, audits: 1n }]);
      const xids = await db.$queryRaw<{ slot: string; budget: string; audit: string }[]>`SELECT s.xmin::text AS slot, b.xmin::text AS budget, a.xmin::text AS audit FROM "NotificationCostReservation" s, "NotificationBudgetPeriod" b, "NotificationAudit" a WHERE s."id"=${slot} AND b."id"=${budget} AND a."id"=${audit}`;
      expect(xids).toHaveLength(1);
      expect(xids[0]!.slot).toBe(xids[0]!.budget);
      expect(xids[0]!.slot).toBe(xids[0]!.audit);
    } finally {
      await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "id"=${audit}`;
      await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "id"=${slot}`;
      await db.$executeRaw`DELETE FROM "NotificationBudgetPeriod" WHERE "id"=${budget}`;
      await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "id"=${id}`;
      await db.$executeRaw`DELETE FROM "NotificationRecipientRegistration" WHERE "id"=${id}`;
      await db.notificationOutbox.deleteMany({ where: { id } });
    }
  });

  it("7: concurrent day and month period creation has one winner per unique key", async () => {
    const environment = randomUUID();
    const a = new PrismaClient(), b = new PrismaClient();
    const insert = (client: PrismaClient, kind: string, key: string) => client.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "NotificationBudgetPeriod" ("id", "environment", "service", "periodType", "periodKey", "policyVersion") VALUES (${randomUUID()}, ${environment}, 'synthetic', ${kind}, ${key}, 'v1')`;
    });
    try {
      for (const [kind, key] of [["day", "2040-01-01"], ["month", "2040-01"]]) {
        const results = await Promise.allSettled([insert(a, kind!, key!), insert(b, kind!, key!)]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(rejected?.reason).toMatchObject({ code: "P2010", meta: { code: "23505" } });
      }
      const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "environment"=${environment}`;
      expect(rows[0]!.count).toBe(2n);
    } finally {
      await db.$executeRaw`DELETE FROM "NotificationBudgetPeriod" WHERE "environment"=${environment}`;
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
  }, 30000);

  it("7 and 9: concurrent final slot and unknown slot cannot be duplicated by SQL", async () => {
    const id = randomUUID();
    await db.notificationOutbox.create({ data: { id, eventKind: "application.received", entityId: id, dedupeKey: id, audience: "admin", occurredAt: at } });
    const a = new PrismaClient(), b = new PrismaClient();
    try {
      await db.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion") VALUES (${id}, ${id}, 'synthetic', ${run}, 'v1', 'active', 'v1', 'v1')`;
      await db.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion") VALUES (${id}, ${id}, ${id}, ${id}, 'mock', ${id}, 'v1', 'synthetic', 'v1', ${at}, 'ready', 'v1')`;
      for (let sequence = 1; sequence <= 4; sequence++) await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${`${id}-${sequence}`}, ${id}, ${sequence}, 'rejected', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`;
      const insert = (client: PrismaClient) => client.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${randomUUID()}, ${id}, 5, 'unknown', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`;
      });
      const results = await Promise.allSettled([insert(a), insert(b)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected?.reason).toMatchObject({ code: "P2010", meta: { code: "23505" } });
      const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId"=${id}`;
      expect(rows[0]!.count).toBe(5n);
    } finally {
      await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${id}`;
      await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "id"=${id}`;
      await db.$executeRaw`DELETE FROM "NotificationRecipientRegistration" WHERE "id"=${id}`;
      await db.notificationOutbox.deleteMany({ where: { id } });
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
  }, 30000);

  it("6, 7, 9 and 12: real worker commits one permit and stops after mock unknown under concurrent workers", async () => {
    await withRealGuard(async (f) => {
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const store = new PrismaOutboxStore(f.scoped);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      let sameCommitObserved = false;
      const originalSend = MockProvider.prototype.send;
      const spy = vi.spyOn(MockProvider.prototype, "send").mockImplementation(async function (this: MockProvider, permit) {
        const xids = await db.$queryRaw<{ slot: string; audit: string; day: string; month: string }[]>`
          SELECT s.xmin::text AS slot, a.xmin::text AS audit, d.xmin::text AS day, m.xmin::text AS month
          FROM "NotificationCostReservation" s JOIN "NotificationAudit" a ON a."slotId"=s."id" AND a."eventType"='permit_issued'
          JOIN "NotificationBudgetPeriod" d ON d."environment"='preview' AND d."service"='application.received' AND d."periodType"='day' AND d."periodKey"='2040-01-01'
          JOIN "NotificationBudgetPeriod" m ON m."environment"='preview' AND m."service"='application.received' AND m."periodType"='month' AND m."periodKey"='2040-01' WHERE s."dispatchId"=${f.id}`;
        expect(xids).toHaveLength(1);
        expect(new Set(Object.values(xids[0]!)).size).toBe(1);
        sameCommitObserved = true;
        return originalSend.call(this, permit);
      });
      const safe = { repository, provider, clock: () => at, prepare: async () => f.prepared };
      try {
        const batches = await Promise.all([processOutboxBatch(store, { provider: null, now: at, safe }), processOutboxBatch(store, { provider: null, now: at, safe })]);
        expect(batches.flatMap((b) => b.outcomes)).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(sameCommitObserved).toBe(true);
        const rows = await db.$queryRaw<{ slot_status: string; cost_state: string; amount: bigint; slot_xid: string; audit_xid: string; day_xid: string; month_xid: string; registration: string; runtime: string }[]>`
          SELECT s."status" AS slot_status, s."costState" AS cost_state, s."reservedMilliKrw" AS amount,
            s.xmin::text AS slot_xid, a.xmin::text AS audit_xid, d.xmin::text AS day_xid, m.xmin::text AS month_xid,
            r."state" AS registration, c."environment" AS runtime
          FROM "NotificationDispatch" x JOIN "NotificationRecipientRegistration" r ON r."id"=x."recipientId"
          JOIN "NotificationRuntimeConfig" c ON c."environment"=x."environment"
          JOIN "NotificationCostReservation" s ON s."dispatchId"=x."id"
          JOIN "NotificationAudit" a ON a."slotId"=s."id" AND a."eventType"='permit_issued'
          JOIN "NotificationBudgetPeriod" d ON d."environment"=x."environment" AND d."service"='application.received' AND d."periodType"='day' AND d."periodKey"='2040-01-01'
          JOIN "NotificationBudgetPeriod" m ON m."environment"=x."environment" AND m."service"='application.received' AND m."periodType"='month' AND m."periodKey"='2040-01'
          WHERE x."id"=${f.id}`;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ slot_status: "unknown", cost_state: "reserved_unknown", amount: 15000n, registration: "active", runtime: "preview" });
        // Slot is updated when the result becomes unknown, so the original xmin
        // is replaced. Audit and period rows still identify the permit commit.
        expect(rows[0]!.audit_xid).toBe(rows[0]!.day_xid);
        expect(rows[0]!.audit_xid).toBe(rows[0]!.month_xid);
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "failed", nextRetryAt: null });
        expect((await processOutboxBatch(store, { provider: null, now: new Date(at.getTime() + 86400000), safe })).outcomes).toEqual([]);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally { spy.mockRestore(); }
    });
  }, 30000);

  it("7: two real permit transactions contend for the last slot", async () => {
    await withRealGuard(async (f) => {
      for (let sequence = 1; sequence <= 4; sequence++) await db.$executeRaw`INSERT INTO "NotificationCostReservation" ("id", "dispatchId", "sequence", "status", "issuedAt", "dayKey", "monthKey", "reservedMilliKrw", "costState") VALUES (${randomUUID()}, ${f.id}, ${sequence}, 'rejected', ${at}, '2040-01-01', '2040-01', 1, 'reserved')`;
      await db.$executeRaw`UPDATE "NotificationDispatch" SET "slotCount"=4, "reconciliationState"='rejected' WHERE "id"=${f.id}`;
      const store = new PrismaOutboxStore(f.scoped);
      const [claim] = await store.claimDue(1, at);
      expect(claim?.claimToken).toBeTruthy();
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const attempts = await Promise.allSettled([0, 1].map(() => acquireDispatchPermit(repository, { ...f.prepared, claimToken: claim!.claimToken!, now: at })));
      const permits = attempts.filter((r) => r.status === "fulfilled" && r.value !== null);
      expect(permits).toHaveLength(1);
      const rows = await db.$queryRaw<{ slots: bigint; last: bigint; issued: number }[]>`SELECT (SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id}) AS slots, (SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id} AND "sequence"=5) AS last, (SELECT "slotCount" FROM "NotificationDispatch" WHERE "id"=${f.id}) AS issued`;
      expect(rows).toEqual([{ slots: 5n, last: 1n, issued: 5 }]);
    });
  }, 30000);

  it("9: real guard carries unknown exposure into the next month without reissuing the earlier event", async () => {
    await withRealGuard(async (f) => {
      const later = new Date("2040-02-01T00:00:00Z"), nextId = randomUUID();
      const next = buildOutboxInput("application.received", `phase8_${nextId}`, "created", "admin", later);
      const store = new PrismaOutboxStore(f.scoped);
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        await processOutboxBatch(store, { provider: null, now: at, safe: { repository, provider, clock: () => at, prepare: async () => f.prepared } });
        expect(spy).toHaveBeenCalledTimes(1);
        await db.reservationApplicationSubmission.create({ data: { id: next.entityId, guardianName: "synthetic", submittedAt: later } });
        await db.notificationOutbox.create({ data: { ...next, id: nextId } });
        await db.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion") SELECT ${nextId}, ${nextId}, "environment", (SELECT "namespace" FROM "NotificationRuntimeConfig" WHERE "environment"='preview') || ':' || ${next.dedupeKey}, "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", ${later}, 'ready', "policyVersion" FROM "NotificationDispatch" WHERE "id"=${f.id}`;
        const scoped = db.$extends({ query: { notificationOutbox: { findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: nextId }] } }); } } } });
        const nextRepository = new PrismaDispatchRepository(scoped as unknown as PrismaGuardClient);
        const nextStore = new PrismaOutboxStore(scoped);
        const prepared = { ...f.prepared, dispatchId: nextId, context: { ...f.prepared.context, dedupeKey: next.dedupeKey, submittedAt: later, variables: { 접수시각: "2040-02-01 09:00" } } };
        await processOutboxBatch(nextStore, { provider: null, now: later, safe: { repository: nextRepository, provider, clock: () => later, prepare: async () => prepared } });
        expect(spy).toHaveBeenCalledTimes(2);
        const carry = await db.$queryRaw<{ carry: bigint; count: bigint }[]>`SELECT "carryMilliKrw" AS carry, (SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id}) AS count FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND "periodType"='month' AND "periodKey"='2040-02'`;
        expect(carry).toEqual([{ carry: 15000n, count: 1n }]);
        expect((await processOutboxBatch(store, { provider: null, now: later, safe: { repository, provider, clock: () => later, prepare: async () => f.prepared } })).outcomes).toEqual([]);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
        await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "dispatchId"=${nextId}`;
        await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId"=${nextId}`;
        await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "id"=${nextId}`;
        await db.$executeRaw`DELETE FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND (("periodType"='day' AND "periodKey"='2040-02-01') OR ("periodType"='month' AND "periodKey"='2040-02'))`;
        await db.notificationOutbox.deleteMany({ where: { id: nextId } });
        await db.reservationApplicationSubmission.deleteMany({ where: { id: next.entityId } });
      }
    });
  }, 30000);

  it("8: a throwing mock after committed permit retains unknown exposure and is not called again", async () => {
    await withRealGuard(async (f) => {
      const repository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const store = new PrismaOutboxStore(f.scoped);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      const spy = vi.spyOn(MockProvider.prototype, "send").mockRejectedValueOnce(new Error("synthetic provider failure"));
      const safe = { repository, provider, clock: () => at, prepare: async () => f.prepared };
      try {
        await processOutboxBatch(store, { provider: null, now: at, safe });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(await store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "failed", nextRetryAt: null });
        const slots = await db.$queryRaw<{ status: string; costState: string; reservedMilliKrw: bigint }[]>`SELECT "status", "costState", "reservedMilliKrw" FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id}`;
        expect(slots).toEqual([{ status: "unknown", costState: "reserved_unknown", reservedMilliKrw: 15000n }]);
        expect((await processOutboxBatch(store, { provider: null, now: at, safe })).outcomes).toEqual([]);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally { spy.mockRestore(); }
    });
  }, 30000);

  it("8: real permit transaction storage failure rolls back its writes before any mock invocation", async () => {
    await withRealGuard(async (f) => {
      let sawPermit = false;
      const injected = new Proxy(f.scoped, { get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => f.scoped.$transaction(async (tx) => {
          const result = await work(tx as unknown as Prisma.TransactionClient);
          if (result && typeof result === "object" && "slotId" in result) { sawPermit = true; throw new Error("synthetic permit commit failure"); }
          return result;
        }, options);
      } });
      const repository = new PrismaDispatchRepository(injected as unknown as PrismaGuardClient);
      const store = new PrismaOutboxStore(injected);
      const provider = new MockProvider({ code: "S_UNKNOWN" });
      const spy = vi.spyOn(MockProvider.prototype, "send");
      try {
        const result = await processOutboxBatch(store, { provider: null, now: at, safe: { repository, provider, clock: () => at, prepare: async () => f.prepared } });
        expect(result.outcomes).toMatchObject([{ status: "failed", reason: "store_error" }]);
        expect(sawPermit).toBe(true);
        expect(spy).not.toHaveBeenCalled();
        const evidence = await db.$queryRaw<{ slots: bigint; audits: bigint; periods: bigint; slot_count: number }[]>`
          SELECT (SELECT count(*) FROM "NotificationCostReservation" WHERE "dispatchId"=${f.id}) AS slots,
            (SELECT count(*) FROM "NotificationAudit" WHERE "dispatchId"=${f.id}) AS audits,
            (SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND "periodKey" IN ('2040-01','2040-01-01')) AS periods,
            (SELECT "slotCount" FROM "NotificationDispatch" WHERE "id"=${f.id}) AS slot_count`;
        expect(evidence).toEqual([{ slots: 0n, audits: 0n, periods: 0n, slot_count: 0 }]);
      } finally { spy.mockRestore(); }
    });
  }, 30000);

  it("5: examines transitive view dependencies and function bodies, including dynamic SQL", async () => {
    const models = ["NotificationRecipientRegistration", "NotificationDispatch", "NotificationAudit", "NotificationBudgetPeriod", "NotificationCostReservation", "NotificationRuntimeConfig"];
    const views = await db.$queryRaw<{ path: string; exposed: boolean }[]>`
      WITH RECURSIVE walk(oid, path, visited) AS (
        SELECT c.oid, c.relname::text, ARRAY[c.oid] FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${models}::text[])
        UNION ALL
        SELECT v.oid, w.path || ' -> ' || v.relname, w.visited || v.oid FROM walk w
        JOIN pg_depend d ON d.refobjid=w.oid AND d.classid='pg_rewrite'::regclass
        JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class
        WHERE v.relkind IN ('v','m') AND NOT v.oid=ANY(w.visited)
      ) SELECT w.path, (has_table_privilege('anon', w.oid, 'SELECT') OR has_table_privilege('authenticated', w.oid, 'SELECT')) AS exposed FROM walk w JOIN pg_class c ON c.oid=w.oid WHERE c.relkind IN ('v','m')`;
    expect(views.filter((v) => v.exposed)).toEqual([]);
    // Conservative check: any public-callable SECURITY DEFINER with dynamic SQL needs review,
    // even when table names are assembled and absent from the function body.
    const functions = await db.$queryRaw<{ name: string }[]>`
      SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
      AND (p.prosrc ~* '\\mexecute\\M' OR EXISTS (SELECT 1 FROM unnest(${models}::text[]) m WHERE position(lower(m) IN lower(p.prosrc))>0))`;
    expect(functions).toEqual([]);
    // PostgreSQL does not expose dependencies for arbitrary PL/pgSQL strings.
    // Conservatively follow literal function calls in stored source; dynamically
    // assembled names remain a manual-review limitation.
    const bodies = await db.$queryRaw<{ name: string; source: string; exposed_definer: boolean }[]>`
      SELECT p.proname::text AS name, p.prosrc::text AS source,
        (p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) AS exposed_definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'`;
    const sensitive = new Set(bodies.filter((f) => models.some((m) => f.source.toLowerCase().includes(m.toLowerCase()))).map((f) => f.name));
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of bodies) {
        if (sensitive.has(f.name)) continue;
        const calls = [...f.source.matchAll(/(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*\(/gi)].map((match) => match[1]!.toLowerCase());
        if (calls.some((name) => [...sensitive].some((target) => target.toLowerCase() === name))) { sensitive.add(f.name); changed = true; }
      }
    }
    expect(bodies.filter((f) => f.exposed_definer && sensitive.has(f.name)).map((f) => f.name)).toEqual([]);
  });
});
