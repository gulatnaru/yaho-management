import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOutboxInput, type OutboxRow } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { SolapiAdapter, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import { dispatchContextSchema } from "@/lib/kakao/send-contract";
import * as previewSafety from "@/lib/e2e/preview-safety";
import { prepareRealDispatch } from "@/server/kakao/dispatch-prepare-real";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { buildRealSafe, type RealSafe, type RealSendEnv } from "@/server/kakao/real-send-wiring";
import {
  activatePrismaRealRecipient, recordPrismaRealOwnership, registerPrismaRealRecipient,
  revokePrismaRealRecipient, verifyPrismaRealRecipient,
} from "@/server/kakao/recipient-storage-real";
import { blockNewSends, PrismaRuntimeRepository, setPrismaRecipientAssignment } from "@/server/kakao/runtime-settings";
import { assertSafeE2eDatabaseUrls } from "@/tests/e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const submittedAt = new Date("2026-11-01T00:00:00Z");
const fakeNumber = "01000000001";
const acceptedRef = "M4V20240525163506DRKMPITQDY5Q6F";
const failedRef = "M4V20240525163506CQKNPHTPCX4P5E";
const groupId = "G4V20240525163506ABCDEFGHIJKLMNO";
const originalFetch = globalThis.fetch;

// V8: even an accidental use of the production Transport cannot reach HTTP.
beforeAll(() => {
  globalThis.fetch = (() => { throw new Error("global fetch is blocked (use an injected Transport)"); }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await db.$disconnect();
}, 30000);

type RecordedCall = { url: string; init: Parameters<SolapiTransport["fetch"]>[1] };
function recordingTransport(body: unknown = {
  groupInfo: { groupId, status: "SENDING" },
  failedMessageList: [],
  messageList: [{ messageId: acceptedRef, statusCode: "2000" }],
}) {
  const calls: RecordedCall[] = [];
  const transport: SolapiTransport = {
    async fetch(url, init) {
      calls.push({ url, init });
      return { status: 200, headers: { get: () => null }, json: async () => body };
    },
  };
  return { transport, calls };
}

// Real storage rejects identifiers resembling phone numbers. Preserve UUID
// uniqueness while mapping digits to distinct letters outside the hex alphabet.
function safeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/\d/g, (digit) => String.fromCharCode(107 + Number(digit)))}`;
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function withFixture(test: (fixture: Fixture) => Promise<void>, options: { secondRecipient?: boolean } = {}) {
  const fixture = await createFixture(options);
  try { await test(fixture); } finally { await fixture.cleanup(); }
}

async function createFixture(options: { secondRecipient?: boolean }) {
  const id = randomUUID(), namespace = `test_${randomUUID()}`;
  const ownerId = safeId("owner"), verifierId = safeId("verifier");
  const registrationId = safeId("recipient"), secondRegistrationId = safeId("replacement");
  const version = safeId("version"), secondVersion = safeId("version");
  const key = randomBytes(32), keyVersion = safeId("key");
  const occurredAt = new Date();
  // Submission time pins Seoul template rendering. The event is due now so
  // buildRealSafe's wall clock does not expire it at the worker's 24h gate.
  const input = buildOutboxInput("application.received", `phase8_${id}`, "created", "admin", occurredAt);
  const scoped = db.$extends({ query: { notificationOutbox: {
    findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id }] } }); },
  } } });
  const repository = new PrismaDispatchRepository(scoped as unknown as PrismaGuardClient);
  const store = new PrismaOutboxStore(scoped);
  const env: RealSendEnv = {
    apiKey: "test-api-key", apiSecret: "test-api-secret", pfId: "KA01PF1234567890abcdef",
    templateId: "real-template-v1", recipientKey: key,
  };
  let runtimeCreated = false;
  const cleanup = async () => {
    try {
      await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "outboxId"=${id}
        OR "dispatchId" IN (SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${id})
        OR "registrationId" IN (${registrationId}, ${secondRegistrationId})
        OR "actorId" IN (${ownerId}, ${verifierId}) OR "keyVersion"=${keyVersion}`;
      await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId" IN (SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${id})`;
      await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "outboxId"=${id}`;
      if (runtimeCreated) {
        // All preview budget periods were checked empty before this fixture.
        await db.$executeRaw`DELETE FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received' AND "policyVersion"='g4-v1'`;
      }
      await db.$executeRaw`DELETE FROM "NotificationRecipientRegistration" WHERE "id" IN (${registrationId}, ${secondRegistrationId})`;
      if (runtimeCreated) await db.$executeRaw`DELETE FROM "NotificationRuntimeConfig" WHERE "environment"='preview' AND "namespace"=${namespace}`;
      await db.notificationOutbox.deleteMany({ where: { id } });
      await db.reservationApplicationSubmission.deleteMany({ where: { id: input.entityId } });
      await db.user.deleteMany({ where: { id: { in: [ownerId, verifierId] } } });
    } finally { key.fill(0); }
  };
  const registerAndVerify = async (recipientId: string, recipientVersion: string, phoneNumber: string) => {
    await registerPrismaRealRecipient(repository, {
      registrationId: recipientId, version: recipientVersion, userId: ownerId, actorId: ownerId,
      purposeVersion: "application-received-v1", policyVersion: "g4-v1", phoneNumber,
      key: { keyVersion, key }, at: occurredAt,
    });
    const evidence = {
      id: "operator_call_verified", method: "operator_call", success: true,
      registrationId: recipientId, version: recipientVersion, verifierId, verifiedAt: occurredAt,
    } as const;
    await recordPrismaRealOwnership(repository, { registrationId: recipientId, actorId: verifierId, evidence, at: occurredAt });
    await verifyPrismaRealRecipient(repository, { registrationId: recipientId, actorId: verifierId, evidence, at: occurredAt });
  };
  try {
    const [occupied] = await db.$queryRaw<{ count: bigint }[]>`SELECT
      (SELECT count(*) FROM "NotificationRuntimeConfig" WHERE "environment"='preview')
      + (SELECT count(*) FROM "NotificationRecipientRegistration" WHERE "environment"='preview' AND "service"='application.received' AND "state"='active')
      + (SELECT count(*) FROM "NotificationDispatch" WHERE "environment"='preview')
      + (SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received') AS count`;
    if (!occupied || occupied.count !== 0n) throw new Error("Real-send preview fixture namespace is occupied");
    await db.user.createMany({ data: [ownerId, verifierId].map((userId) => ({
      id: userId, email: `${userId}@example.test`, name: "synthetic", role: "ADMIN" as const,
      isActive: true, mustChangePassword: false,
    })) });
    await db.$executeRaw`INSERT INTO "NotificationRuntimeConfig"
      ("environment", "namespace", "blocked", "activationEpoch", "providerId", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "ownerId", "updatedAt")
      VALUES ('preview', ${namespace}, false, ${submittedAt}, 'solapi', ${env.templateId}, 'g4-v1', 'g4-v1', ${keyVersion}, 1, true, true, true, ${ownerId}, ${occurredAt})`;
    runtimeCreated = true;
    await setPrismaRecipientAssignment(repository, {
      commandId: safeId("assignment"), actorId: ownerId, executorId: verifierId,
      assignment: "verify", active: true, at: occurredAt,
    });
    await registerAndVerify(registrationId, version, fakeNumber);
    // A second service-created inactive recipient lets the cardinality test
    // corrupt only its state; no recipient is ever inserted with raw SQL.
    if (options.secondRecipient) await registerAndVerify(secondRegistrationId, secondVersion, "01000000002");
    await activatePrismaRealRecipient(repository, { registrationId, actorId: ownerId, key: { keyVersion, key }, at: occurredAt });
    await db.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "synthetic", submittedAt } });
    await db.notificationOutbox.create({ data: { ...input, id } });
    return {
      id, namespace, ownerId, verifierId, registrationId, secondRegistrationId, version, secondVersion,
      key, keyVersion, input, occurredAt, env, scoped, repository, store, registerAndVerify, cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}

async function realSafe(f: Fixture, transport: SolapiTransport) {
  const safe = await buildRealSafe(f.repository, f.env, { transport });
  if (!safe) throw new Error("Valid fixture did not produce a real safe");
  expect(safe.provider).toBeInstanceOf(SolapiAdapter);
  return { ...safe, canIssue: () => true };
}
async function expectNullSafe(f: Fixture, env = f.env) {
  const { transport, calls } = recordingTransport();
  expect(await buildRealSafe(f.repository, env, { transport })).toBeNull();
  expect(calls).toHaveLength(0);
}
async function claim(f: Fixture) {
  const rows = await f.store.claimDue(1, new Date());
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row?.claimToken) throw new Error("Fixture claim unavailable");
  expect(row).toMatchObject({ id: f.id, status: "processing", attemptCount: 0 });
  return row;
}
function prepare(f: Fixture, row: OutboxRow) {
  if (!row.claimToken) throw new Error("Fixture claim token unavailable");
  return prepareRealDispatch(f.repository, {
    rowId: row.id, claimToken: row.claimToken, recipientKey: { keyVersion: f.keyVersion, key: f.key }, templateId: f.env.templateId,
  });
}
async function dispatch(f: Fixture) {
  return db.notificationDispatch.findUniqueOrThrow({ where: { outboxId: f.id } });
}
async function assertRefused(f: Fixture, safe: RealSafe) {
  expect(await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe }))
    .toEqual({ outcomes: [{ rowId: f.id, status: "failed", reason: "store_error" }] });
  expect(await f.store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "processing", attemptCount: 0, nextRetryAt: null });
  expect(await db.notificationCostReservation.count({ where: { dispatch: { outboxId: f.id } } })).toBe(0);
  expect(await db.notificationAudit.count({ where: { outboxId: f.id, eventType: "permit_issued" } })).toBe(0);
}

describe.sequential("G4 real-send PostgreSQL evidence (Mock Transport only)", () => {
  it("buildRealSafe returns null without RuntimeConfig", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.delete({ where: { environment: "preview" } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null when blocked", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { blocked: true } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null before a future activationEpoch", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { activationEpoch: new Date(Date.now() + 86400000) } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null for a policyVersion other than g4-v1", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { policyVersion: "g2-v1" } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null for a costPolicyVersion other than g4-v1", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { costPolicyVersion: "g2-v1" } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null for a null templateVersion", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { templateVersion: null } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null for a null recipientVersion", async () => {
    await withFixture(async (f) => {
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { recipientVersion: null } });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null with zero active recipients", async () => {
    await withFixture(async (f) => {
      await db.notificationRecipientRegistration.update({ where: { id: f.registrationId }, data: { state: "verified_inactive" } });
      expect(await db.notificationRecipientRegistration.count({ where: { environment: "preview", service: "application.received", state: "active" } })).toBe(0);
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null with two active recipients", async () => {
    await withFixture(async (f) => {
      const rollback = new Error("Roll back impossible recipient cardinality fixture");
      const { transport, calls } = recordingTransport();
      // The database prevents this state with a partial unique index. Relax
      // it only inside an always-rolled-back transaction; the real queries
      // and ciphertext remain PostgreSQL-backed and the index is restored.
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`DROP INDEX "notification_one_active_recipient"`;
        await tx.notificationRecipientRegistration.update({ where: { id: f.secondRegistrationId }, data: { state: "active" } });
        expect(await tx.notificationRecipientRegistration.count({ where: { environment: "preview", service: "application.received", state: "active" } })).toBe(2);
        const repository = new PrismaDispatchRepository({ $transaction: (work) => work(tx) });
        expect(await buildRealSafe(repository, f.env, { transport })).toBeNull();
        throw rollback;
      })).rejects.toBe(rollback);
      expect(calls).toHaveLength(0);
      expect(await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='notification_one_active_recipient'`).toHaveLength(1);
      expect(await db.notificationRecipientRegistration.count({ where: { environment: "preview", service: "application.received", state: "active" } })).toBe(1);
    }, { secondRecipient: true });
  }, 30000);
  it("buildRealSafe returns null without the activated recipient ownership audit", async () => {
    await withFixture(async (f) => {
      const deleted = await db.notificationAudit.deleteMany({ where: { registrationId: f.registrationId, eventType: "recipient_ownership_confirmed" } });
      expect(deleted.count).toBe(1);
      expect(await db.notificationRecipientRegistration.findUniqueOrThrow({ where: { id: f.registrationId } })).toMatchObject({ state: "active" });
      await expectNullSafe(f);
    });
  }, 30000);
  it("buildRealSafe returns null when the recipient key cannot decrypt", async () => {
    await withFixture(async (f) => {
      const wrongKey = randomBytes(32);
      try { await expectNullSafe(f, { ...f.env, recipientKey: wrongKey }); } finally { wrongKey.fill(0); }
    });
  }, 30000);

  it("sends submission to Outbox through the real guard and SolapiAdapter with the exact ATA body", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      expect(await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: f.input.entityId } })).toMatchObject({ submittedAt });
      expect(await f.store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({
        ...f.input, status: "pending", attemptCount: 0, claimToken: null, providerRef: null,
      });
      expect(Object.keys(f.input).sort()).toEqual(["audience", "dedupeKey", "entityId", "eventKind", "occurredAt"]);
      const safe = await realSafe(f, transport);
      expect(await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe }))
        .toEqual({ outcomes: [{ rowId: f.id, status: "sent", rowStatus: "sent" }] });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.init.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(calls[0]!.init.body)).toEqual({
        messages: [{ to: fakeNumber, type: "ATA", country: "82", kakaoOptions: {
          pfId: f.env.pfId, templateId: f.env.templateId, variables: { "#{접수시각}": "2026-11-01 09:00" }, disableSms: true,
        } }],
        strict: true, allowDuplicates: false, showMessageList: true,
      });
      expect(fakeNumber).toMatch(/^\d{9,15}$/);
      expect(calls[0]!.init.body).not.toContain('"text"');
      expect(calls[0]!.init.body).not.toContain('"from"');
      const sent = await f.store.findByDedupeKey(f.input.dedupeKey);
      expect(sent).toMatchObject({ status: "sent", providerId: "solapi", providerRef: acceptedRef, nextRetryAt: null });
      expect(sent!.providerRef).toMatch(/^M4V[0-9]{14}[0-9A-Za-z]{14}$/);
      expect(sent!.providerRef).toHaveLength(31);
      const saved = await dispatch(f);
      // PG records transport acceptance as awaiting_final on the dispatch;
      // the durable send slot itself is accepted (not proof of delivery).
      expect(saved).toMatchObject({ reconciliationState: "awaiting_final", slotCount: 1, recipientId: f.registrationId, recipientVersion: f.version, policyVersion: "g4-v1" });
      // SEND_SLOT is the schema's send-cost ledger entry, not LOOKUP_COST.
      expect(await db.notificationCostReservation.findMany({ where: { dispatchId: saved.id } })).toMatchObject([
        { entryKind: "SEND_SLOT", sequence: 1, status: "accepted", providerRef: acceptedRef, reservedMilliKrw: 15000n },
      ]);
      const audits = await db.notificationAudit.findMany({ where: { dispatchId: saved.id, eventType: { in: ["permit_issued", "result_recorded"] } }, orderBy: { sequence: "asc" } });
      expect(audits).toMatchObject([{ eventType: "permit_issued", sequence: 1 }, { eventType: "result_recorded", sequence: 2, providerRef: acceptedRef }]);
    });
  }, 30000);

  it("rejects a mock context with the real SolapiAdapter before calling the provider", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport);
      await assertRefused(f, { ...safe, prepare: async (row) => {
        const prepared = await prepare(f, row);
        if (!prepared) throw new Error("Real prepare unavailable");
        return { ...prepared, context: dispatchContextSchema.parse({ ...prepared.context, templateId: "mock_application_received_v1", templateVersion: "g2-v1" }) };
      } });
      expect(calls).toHaveLength(0);
    });
  }, 30000);
  it("rejects a real context with MockProvider before calling the provider", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport);
      const provider = new MockProvider({ code: "S_ACCEPTED", ref: `g2ref_${"a".repeat(32)}` });
      const send = vi.spyOn(provider, "send");
      try { await assertRefused(f, { ...safe, provider }); expect(send).not.toHaveBeenCalled(); }
      finally { send.mockRestore(); }
      expect(calls).toHaveLength(0);
    });
  }, 30000);
  it("rejects a real recipient key carrying a synthetic marker", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport);
      await assertRefused(f, { ...safe, prepare: async (row) => {
        const prepared = await prepare(f, row);
        return prepared && { ...prepared, recipientKey: { ...prepared.recipientKey, synthetic: true as const } };
      } });
      expect(calls).toHaveLength(0);
    });
  }, 30000);
  it("rejects a mock key for a real context", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport), mockKey = randomBytes(32);
      try {
        await assertRefused(f, { ...safe, prepare: async (row) => {
          const prepared = await prepare(f, row);
          return prepared && { ...prepared, recipientKey: { keyVersion: "mock-key-v1", key: mockKey, synthetic: true as const } };
        } });
        expect(calls).toHaveLength(0);
      } finally { mockKey.fill(0); }
    });
  }, 30000);
  it("rejects a real prepared context after runtime policyVersion changes to g2-v1", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport);
      await assertRefused(f, { ...safe, prepare: async (row) => {
        const prepared = await prepare(f, row);
        if (!prepared) throw new Error("Real prepare unavailable");
        // Policy versions belong to RuntimeConfig, not to the strict policy
        // object. Change that version after prepare to exercise the guard's
        // own real-branch version recheck rather than prepare-null.
        await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { policyVersion: "g2-v1" } });
        return prepared;
      } });
      expect(calls).toHaveLength(0);
    });
  }, 30000);

  it("prepareRealDispatch creates a new dispatch for a processing claim", async () => {
    await withFixture(async (f) => {
      const row = await claim(f), prepared = await prepare(f, row);
      expect(prepared).not.toBeNull();
      expect(prepared).toMatchObject({
        context: { recipientId: f.registrationId, recipientVersion: f.version, templateId: f.env.templateId, templateVersion: f.env.templateId, submittedAt, variables: { 접수시각: "2026-11-01 09:00" } },
        config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" },
        policy: { mode: "single_real_preview" }, quote: { send: 15000 },
      });
      expect(await dispatch(f)).toMatchObject({ id: prepared!.dispatchId, clientKey: `${f.namespace}:${f.input.dedupeKey}`, reconciliationState: "ready", slotCount: 0 });
    });
  }, 30000);
  it("prepareRealDispatch reuses the same dispatchId for the same claim", async () => {
    await withFixture(async (f) => {
      const row = await claim(f), first = await prepare(f, row), second = await prepare(f, row);
      expect(first).not.toBeNull();
      expect(second).toEqual(first);
      expect(await db.notificationDispatch.count({ where: { outboxId: f.id } })).toBe(1);
    });
  }, 30000);
  it("prepareRealDispatch returns null for an old dispatch after recipient replacement", async () => {
    await withFixture(async (f) => {
      const row = await claim(f), first = await prepare(f, row);
      expect(first).not.toBeNull();
      await revokePrismaRealRecipient(f.repository, { registrationId: f.registrationId, actorId: f.ownerId, reason: "replaced", at: new Date() });
      await f.registerAndVerify(f.secondRegistrationId, f.secondVersion, "01000000002");
      await activatePrismaRealRecipient(f.repository, { registrationId: f.secondRegistrationId, actorId: f.ownerId, key: { keyVersion: f.keyVersion, key: f.key }, at: new Date() });
      expect(await db.notificationRuntimeConfig.findUniqueOrThrow({ where: { environment: "preview" } })).toMatchObject({ recipientVersion: f.secondVersion });
      expect(await prepare(f, row)).toBeNull();
      expect(await dispatch(f)).toMatchObject({ id: first!.dispatchId, recipientId: f.registrationId, recipientVersion: f.version, slotCount: 0 });
    });
  }, 30000);
  it("prepareRealDispatch returns null when runtime is blocked", async () => {
    await withFixture(async (f) => {
      const row = await claim(f);
      await db.notificationRuntimeConfig.update({ where: { environment: "preview" }, data: { blocked: true } });
      expect(await prepare(f, row)).toBeNull();
      expect(await db.notificationDispatch.count({ where: { outboxId: f.id } })).toBe(0);
    });
  }, 30000);
  it("prepareRealDispatch returns null for a mismatched claimToken", async () => {
    await withFixture(async (f) => {
      const row = await claim(f);
      expect(await prepare(f, { ...row, claimToken: safeId("wrong_claim") })).toBeNull();
      expect(await db.notificationDispatch.count({ where: { outboxId: f.id } })).toBe(0);
    });
  }, 30000);

  it("S_REJECT_PERM is terminal delivery_failed and never resends", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport({
        groupInfo: { groupId, status: "SENDING" },
        failedMessageList: [{ to: fakeNumber, messageId: failedRef, statusCode: "3040" }], messageList: [],
      });
      const safe = await realSafe(f, transport);
      expect(await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe }))
        .toMatchObject({ outcomes: [{ rowId: f.id, status: "failed", rowStatus: "failed", nextRetryAt: null }] });
      expect(await f.store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "failed", nextRetryAt: null, attemptCount: 1 });
      expect((await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe })).outcomes).toEqual([]);
      expect(calls).toHaveLength(1);
      expect(await db.notificationCostReservation.findMany({ where: { dispatch: { outboxId: f.id } } })).toMatchObject([{ status: "rejected" }]);
      // Terminal state is reconciliationState='rejected' (markDefiniteRejection);
      // finalStatus is written only by lookup results / closure, never by a
      // definite rejection — it must stay null, not be fabricated.
      expect(await dispatch(f)).toMatchObject({ reconciliationState: "rejected", finalStatus: null });
    });
  }, 30000);
  it("S_UNKNOWN is terminal provider_result_unknown with reserved exposure and never resends", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport({ groupInfo: { groupId, status: "SENDING" }, failedMessageList: [], messageList: [] });
      const safe = await realSafe(f, transport);
      expect(await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe }))
        .toMatchObject({ outcomes: [{ rowId: f.id, status: "failed", rowStatus: "failed", nextRetryAt: null }] });
      expect(await f.store.findByDedupeKey(f.input.dedupeKey)).toMatchObject({ status: "failed", nextRetryAt: null, lastErrorCode: "provider_result_unknown" });
      expect(await dispatch(f)).toMatchObject({ reconciliationState: "open_unknown", slotCount: 1 });
      expect(await db.notificationCostReservation.findMany({ where: { dispatch: { outboxId: f.id } } })).toMatchObject([
        { status: "unknown", costState: "reserved_unknown", reservedMilliKrw: 15000n },
      ]);
      expect((await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe })).outcomes).toEqual([]);
      expect(calls).toHaveLength(1);
    });
  }, 30000);
  it("concurrent workers issue one permit and make exactly one provider call", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const firstSafe = await realSafe(f, transport);
      const secondRepository = new PrismaDispatchRepository(f.scoped as unknown as PrismaGuardClient);
      const secondStore = new PrismaOutboxStore(f.scoped);
      const secondSafe = await buildRealSafe(secondRepository, f.env, { transport });
      if (!secondSafe) throw new Error("Second real safe unavailable");
      const batches = await Promise.all([
        processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe: firstSafe }),
        processOutboxBatch(secondStore, { provider: null, now: new Date(), limit: 1, safe: { ...secondSafe, canIssue: () => true } }),
      ]);
      expect(batches.every((batch) => batch.error === undefined)).toBe(true);
      expect(batches.flatMap((batch) => batch.outcomes)).toEqual([{ rowId: f.id, status: "sent", rowStatus: "sent" }]);
      expect(calls).toHaveLength(1);
      expect(await db.notificationAudit.count({ where: { outboxId: f.id, eventType: "permit_issued" } })).toBe(1);
      expect(await db.notificationCostReservation.count({ where: { dispatch: { outboxId: f.id } } })).toBe(1);
    });
  }, 30000);
  it("dispatcher returns batch_failed 503 without real env before sweep or claim", async () => {
    await withFixture(async (f) => {
      const before = await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } });
      const [identity] = await db.$queryRaw<previewSafety.RuntimeDatabaseIdentity[]>`SELECT current_database() AS database, current_user AS "currentUser", current_schema() AS "currentSchema"`;
      if (!identity) throw new Error("Local PG identity unavailable");
      const secret = randomBytes(32).toString("base64url"), projectRef = "syntheticpreview";
      // Keep the real GET/dispatcher/env parser and local PG identity query.
      // Only the Preview URL gate is adapted for this isolated localhost DB;
      // neither DATABASE_URL nor DIRECT_URL is ever replaced with a remote URL.
      const project = vi.spyOn(previewSafety, "assertApprovedSupabaseProjectRef").mockReturnValue(projectRef);
      const sweep = vi.spyOn(PrismaOutboxStore.prototype, "recoverStale");
      const claimed = vi.spyOn(PrismaOutboxStore.prototype, "claimDue");
      vi.doMock("@/lib/db/prisma", () => ({ prisma: db }));
      try {
        vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", secret);
        vi.stubEnv("VERCEL_ENV", "preview");
        vi.stubEnv("KAKAO_PREVIEW_PROJECT_REF", projectRef);
        vi.stubEnv("KAKAO_PRODUCTION_PROJECT_REF", "syntheticproduction");
        vi.stubEnv("KAKAO_PREVIEW_DB_IDENTITY_SHA256", previewSafety.runtimeDatabaseIdentityFingerprint(identity, projectRef));
        for (const name of ["KAKAO_SOLAPI_API_KEY", "KAKAO_SOLAPI_API_SECRET", "KAKAO_ALIMTALK_PF_ID", "KAKAO_ALIMTALK_TEMPLATE_ID", "KAKAO_RECIPIENT_KEY"]) vi.stubEnv(name, undefined);
        // The implemented route is kakao-notifications, not the older plan's
        // nonexistent /api/cron/kakao/dispatch path.
        const { GET } = await import("@/app/api/cron/kakao-notifications/route");
        const response = await GET(new Request("http://fixture.invalid/api/cron/kakao-notifications", { headers: { authorization: `Bearer ${secret}` } }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ code: "batch_failed", detail: "실 발송 설정을 확인할 수 없습니다" });
        expect(project).toHaveBeenCalledTimes(1);
        expect(sweep).not.toHaveBeenCalled();
        expect(claimed).not.toHaveBeenCalled();
        expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.id } })).toEqual(before);
      } finally {
        vi.unstubAllEnvs();
        project.mockRestore(); sweep.mockRestore(); claimed.mockRestore();
        vi.doUnmock("@/lib/db/prisma");
      }
    });
  }, 30000);
  it("blockNewSends refuses a previously built real safe without a provider call", async () => {
    await withFixture(async (f) => {
      const { transport, calls } = recordingTransport();
      const safe = await realSafe(f, transport);
      const runtime = await db.notificationRuntimeConfig.findUniqueOrThrow({ where: { environment: "preview" } });
      const commandId = safeId("block");
      await blockNewSends(new PrismaRuntimeRepository(f.repository), {
        commandId, actorId: f.ownerId, reason: "operator_stop", expectedRevision: runtime.revision, at: new Date(),
      });
      expect(await db.notificationAudit.findUniqueOrThrow({ where: { eventId: commandId } })).toMatchObject({ eventType: "send_blocked" });
      await assertRefused(f, safe);
      expect(calls).toHaveLength(0);
      expect(await db.notificationDispatch.count({ where: { outboxId: f.id } })).toBe(0);
    });
  }, 30000);
});
