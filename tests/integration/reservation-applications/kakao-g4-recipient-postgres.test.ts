import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import { SolapiAdapter, type SolapiTransport } from "@/lib/kakao/providers/solapi";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { buildRealSafe, type RealSendEnv } from "@/server/kakao/real-send-wiring";
import {
  activatePrismaRealRecipient, decryptActiveRecipientPhone, recordPrismaRealOwnership,
  registerPrismaRealRecipient, revokePrismaRealRecipient, verifyPrismaRealRecipient,
} from "@/server/kakao/recipient-storage-real";
import { setPrismaRecipientAssignment } from "@/server/kakao/runtime-settings";
import { assertSafeE2eDatabaseUrls } from "@/tests/e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const activationEpoch = new Date("2026-11-01T00:00:00Z");
const fakeNumber = "01000000001";
const acceptedRef = "M4V20240525163506DRKMPITQDY5Q6F";

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP is blocked; use the injected Mock Transport"); }));
});
afterAll(async () => {
  try { await db.$disconnect(); } finally { vi.unstubAllGlobals(); }
}, 30000);

// The real storage schema rejects phone-shaped identifiers. Retry UUIDs with
// seven consecutive digits so keys still use the required k<uuid> format.
function uniqueId(prefix: string) {
  let value: string;
  do { value = `${prefix}${randomUUID()}`; } while (/(?:\d[-_]*){7,}/.test(value));
  return value;
}

function mockTransport() {
  const send = vi.fn<SolapiTransport["fetch"]>(async () => ({
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      groupInfo: { groupId: "G4V20240525163506ABCDEFGHIJKLMNO", status: "SENDING" },
      failedMessageList: [],
      messageList: [{ messageId: acceptedRef, statusCode: "2000" }],
    }),
  }));
  return { transport: { fetch: send } satisfies SolapiTransport, send };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function withFixture(test: (fixture: Fixture) => Promise<void>) {
  const fixture = await createFixture();
  try { await test(fixture); } finally { await fixture.cleanup(); }
}

async function createFixture() {
  const namespace = `test_${randomUUID()}`, outboxId = randomUUID();
  const ownerId = uniqueId("owner_"), verifierId = uniqueId("verifier_"), thirdId = uniqueId("third_");
  const userIds = [ownerId, verifierId, thirdId];
  const registrationId = uniqueId("recipient_"), version = uniqueId("v_");
  const secondId = uniqueId("recipient_"), secondVersion = uniqueId("v_");
  const rejectedId = uniqueId("recipient_"), rejectedVersion = uniqueId("v_");
  const registrationIds = [registrationId, secondId, rejectedId];
  const key = randomBytes(32), keyVersion = uniqueId("k");
  const recipientKey = { keyVersion, key };
  const at = new Date();
  const input = buildOutboxInput("application.received", `phase8_${outboxId}`, "created", "admin", at);
  const scoped = db.$extends({ query: { notificationOutbox: {
    findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: outboxId }] } }); },
  } } });
  const repository = new PrismaDispatchRepository(scoped as unknown as PrismaGuardClient);
  const store = new PrismaOutboxStore(scoped);
  const env: RealSendEnv = {
    apiKey: "test-api-key", apiSecret: "test-api-secret", pfId: "KA01PF1234567890abcdef",
    templateId: "real-template-v1", recipientKey: key,
  };
  let runtimeCreated = false;
  let cleanupNeeded = false;
  const cleanup = async () => {
    try {
      if (!cleanupNeeded) return;
      // Capture only periods referenced by this fixture's slots before deleting
      // those slots. Never clear another namespace's budget rows.
      const periods = runtimeCreated ? await db.$queryRaw<{ id: string }[]>`
        SELECT p."id" FROM "NotificationBudgetPeriod" p
        WHERE p."environment"='preview' AND p."service"='application.received'
          AND EXISTS (SELECT 1 FROM "NotificationCostReservation" c
            JOIN "NotificationDispatch" d ON d."id"=c."dispatchId"
            WHERE d."outboxId"=${outboxId}
              AND ((p."periodType"='day' AND p."periodKey"=c."dayKey")
                OR (p."periodType"='month' AND p."periodKey"=c."monthKey")))` : [];
      await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "registrationId" IN (${registrationId}, ${secondId}, ${rejectedId})
        OR "outboxId"=${outboxId} OR "dispatchId" IN (SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${outboxId})
        OR "actorId" IN (${ownerId}, ${verifierId}, ${thirdId}) OR "keyVersion"=${keyVersion}`;
      await db.$executeRaw`DELETE FROM "NotificationCostReservation" WHERE "dispatchId" IN (SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${outboxId})`;
      await db.notificationDispatch.deleteMany({ where: { outboxId } });
      await db.notificationRecipientRegistration.deleteMany({ where: { id: { in: registrationIds } } });
      if (runtimeCreated) await db.notificationRuntimeConfig.deleteMany({ where: { environment: "preview", namespace } });
      if (periods.length) await db.notificationBudgetPeriod.deleteMany({ where: { id: { in: periods.map((period) => period.id) } } });
      await db.notificationOutbox.deleteMany({ where: { id: outboxId } });
      await db.reservationApplicationSubmission.deleteMany({ where: { id: input.entityId } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally { key.fill(0); }
  };
  const registrationInput = (id = registrationId, recipientVersion = version, phoneNumber = fakeNumber) => ({
    registrationId: id, version: recipientVersion, userId: ownerId, actorId: ownerId,
    purposeVersion: "application-received-v1", policyVersion: "g4-v1", phoneNumber, key: recipientKey, at,
  });
  const register = (id = registrationId, recipientVersion = version, phoneNumber = fakeNumber) =>
    registerPrismaRealRecipient(repository, registrationInput(id, recipientVersion, phoneNumber));
  const proof = (actorId = verifierId, id = registrationId, recipientVersion = version) => ({
    id: "operator_call_verified" as const, method: "operator_call" as const, success: true as const,
    registrationId: id, version: recipientVersion, verifierId: actorId, verifiedAt: at,
  });
  const verificationInput = (actorId = verifierId, id = registrationId, recipientVersion = version) => ({
    registrationId: id, actorId, evidence: proof(actorId, id, recipientVersion), at,
  });
  const grant = (executorId = verifierId) => setPrismaRecipientAssignment(repository, {
    commandId: uniqueId("assignment_"), actorId: ownerId, executorId, assignment: "verify", active: true, at,
  });
  const verify = async (actorId = verifierId, id = registrationId, recipientVersion = version) => {
    const command = verificationInput(actorId, id, recipientVersion);
    await recordPrismaRealOwnership(repository, command);
    await verifyPrismaRealRecipient(repository, command);
  };
  const activate = (id = registrationId) => activatePrismaRealRecipient(repository, {
    registrationId: id, actorId: ownerId, key: recipientKey, at,
  });
  const row = (id = registrationId) => db.notificationRecipientRegistration.findUniqueOrThrow({ where: { id } });
  const runtime = () => db.notificationRuntimeConfig.findUniqueOrThrow({ where: { environment: "preview" } });
  const ownershipCount = (id = registrationId) => db.notificationAudit.count({
    where: { registrationId: id, eventType: "recipient_ownership_confirmed" },
  });
  try {
    const [occupied] = await db.$queryRaw<{ count: bigint }[]>`SELECT
      (SELECT count(*) FROM "NotificationRuntimeConfig" WHERE "environment"='preview')
      + (SELECT count(*) FROM "NotificationRecipientRegistration" WHERE "environment"='preview' AND "service"='application.received' AND "state"='active')
      + (SELECT count(*) FROM "NotificationDispatch" WHERE "environment"='preview') AS count`;
    if (!occupied || occupied.count !== 0n) throw new Error("Real-recipient preview fixture namespace is occupied");
    // Guard issuance uses preview-wide period keys. Refuse existing budgets
    // as well so the happy-path cleanup only owns newly created periods.
    if (await db.notificationBudgetPeriod.count({ where: { environment: "preview", service: "application.received" } })) {
      throw new Error("Real-recipient preview budget namespace is occupied");
    }
    cleanupNeeded = true;
    for (const userId of userIds) await db.user.create({ data: {
      id: userId, email: `${userId}@example.test`, name: "synthetic", role: "ADMIN",
      isActive: true, mustChangePassword: false,
    } });
    await db.notificationRuntimeConfig.create({ data: {
      environment: "preview", namespace, blocked: false, activationEpoch, providerId: "solapi",
      recipientVersion: null, policyVersion: "g4-v1", costPolicyVersion: "g4-v1", templateVersion: env.templateId,
      keyVersion, nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true, ownerId,
    } });
    runtimeCreated = true;
    return {
      namespace, outboxId, ownerId, verifierId, thirdId, registrationId, version, secondId, secondVersion,
      rejectedId, rejectedVersion, at, recipientKey, input, env, repository, store, cleanup,
      registrationInput, register, verificationInput, grant, verify, activate, row, runtime, ownershipCount,
    };
  } catch (error) { await cleanup(); throw error; }
}

async function verifiedFixture(f: Fixture) {
  await f.register();
  await f.grant();
  await f.verify();
}

describe.sequential("G4 real-recipient PostgreSQL lifecycle (fake numbers only)", () => {
  it("registers, independently verifies, activates and decrypts the supplied number, then sends through the real guard", async () => {
    await withFixture(async (f) => {
      expect((await f.runtime()).recipientVersion).toBeNull();
      await f.register();
      const pending = await f.row();
      expect(pending).toMatchObject({
        state: "verification_pending", purposeVersion: "application-received-v1", policyVersion: "g4-v1",
        keyVersion: f.recipientKey.keyVersion, verificationMethod: null, verificationEvidenceId: null,
      });
      expect(pending.ciphertext).not.toBeNull();
      expect(pending.ciphertext?.length).toBeGreaterThan(0);
      expect(pending.nonce).toHaveLength(12);
      expect(pending.tag).toHaveLength(16);
      expect((await f.runtime()).nonceHighWater).toBe(2n);
      await f.grant();
      await f.verify();
      const verified = await f.row();
      expect(verified).toMatchObject({
        state: "verified_inactive", verificationMethod: "operator_call", verificationEvidenceId: "operator_call_verified",
        verifiedBy: f.verifierId, verifiedAt: f.at,
      });
      expect(await f.ownershipCount()).toBe(1);
      await f.activate();
      expect(await f.row()).toMatchObject({ state: "active", activatedAt: f.at });
      expect((await f.runtime()).recipientVersion).toBe(f.version);
      expect(await decryptActiveRecipientPhone(f.repository, { key: f.recipientKey, now: new Date() })).toEqual({
        to: fakeNumber, registrationId: f.registrationId, version: f.version,
      });

      // One minimal real-path send: only the HTTP transport is mocked. The
      // recipient, prepare, permit, and result transitions all use PostgreSQL.
      await db.reservationApplicationSubmission.create({ data: {
        id: f.input.entityId, guardianName: "synthetic", submittedAt: f.at,
      } });
      await db.notificationOutbox.create({ data: { ...f.input, id: f.outboxId } });
      const { transport, send } = mockTransport();
      const safe = await buildRealSafe(f.repository, f.env, { transport });
      if (!safe) throw new Error("Activated recipient did not produce a real safe");
      expect(safe.provider).toBeInstanceOf(SolapiAdapter);
      const result = await processOutboxBatch(f.store, { provider: null, now: new Date(), limit: 1, safe });
      expect(result.outcomes).toEqual([{ rowId: f.outboxId, status: "sent", rowStatus: "sent" }]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.outboxId } })).toMatchObject({ status: "sent" });
      expect(await db.notificationAudit.count({ where: { outboxId: f.outboxId, eventType: "permit_issued", policyVersion: "g4-v1" } })).toBe(1);
      expect(await db.notificationDispatch.findUniqueOrThrow({ where: { outboxId: f.outboxId } })).toMatchObject({
        recipientId: f.registrationId, recipientVersion: f.version, reconciliationState: "awaiting_final", slotCount: 1,
      });
    });
  }, 30000);

  it("rejects ownership recording and verification by the registrant without an ownership audit", async () => {
    await withFixture(async (f) => {
      await f.register();
      const command = f.verificationInput(f.ownerId);
      await expect(recordPrismaRealOwnership(f.repository, command)).rejects.toThrow("Invalid verification.");
      await expect(verifyPrismaRealRecipient(f.repository, command)).rejects.toThrow();
      expect(await f.row()).toMatchObject({ state: "verification_pending", verifiedBy: null, verifiedAt: null });
      expect(await f.ownershipCount()).toBe(0);
    });
  }, 30000);

  it("rejects ownership recording and verification by an unassigned ADMIN", async () => {
    await withFixture(async (f) => {
      await f.register();
      const command = f.verificationInput(f.thirdId);
      await expect(recordPrismaRealOwnership(f.repository, command)).rejects.toThrow("Recipient authority unavailable.");
      await expect(verifyPrismaRealRecipient(f.repository, command)).rejects.toThrow("Recipient authority unavailable.");
      expect(await f.row()).toMatchObject({ state: "verification_pending", verifiedBy: null, verifiedAt: null });
      expect(await f.ownershipCount()).toBe(0);
    });
  }, 30000);

  it("allows the third ADMIN to record ownership and verify after the owner grants verify", async () => {
    await withFixture(async (f) => {
      await f.register();
      expect(await db.notificationAudit.count({ where: { actorId: f.ownerId, payloadBinding: f.thirdId, eventType: "recipient_assignment_granted" } })).toBe(0);
      await f.grant(f.thirdId);
      await f.verify(f.thirdId);
      expect(await f.row()).toMatchObject({
        state: "verified_inactive", verificationMethod: "operator_call", verificationEvidenceId: "operator_call_verified",
        verifiedBy: f.thirdId, verifiedAt: f.at,
      });
      expect(await f.ownershipCount()).toBe(1);
      expect(await db.notificationAudit.findFirstOrThrow({ where: { registrationId: f.registrationId, eventType: "recipient_ownership_confirmed" } })).toMatchObject({
        actorId: f.thirdId, toState: f.version, evidenceId: "operator_call_verified", occurredAt: f.at,
      });
    });
  }, 30000);

  it("sets recipientVersion to the activated version and increments runtime revision exactly once", async () => {
    await withFixture(async (f) => {
      await verifiedFixture(f);
      const before = await f.runtime();
      expect(before.recipientVersion).toBeNull();
      await f.activate();
      expect(await f.runtime()).toMatchObject({ recipientVersion: f.version, revision: before.revision + 1 });
      expect(await f.row()).toMatchObject({ state: "active" });
      expect(await db.notificationAudit.count({ where: { registrationId: f.registrationId, eventType: "recipient_activated" } })).toBe(1);
    });
  }, 30000);

  it("revokes an active recipient on withdrawal, erases its cipher fields and refuses decryption and real wiring", async () => {
    await withFixture(async (f) => {
      await verifiedFixture(f);
      await f.activate();
      expect(await decryptActiveRecipientPhone(f.repository, { key: f.recipientKey, now: new Date() })).toMatchObject({ to: fakeNumber });
      const { transport, send } = mockTransport();
      expect(await buildRealSafe(f.repository, f.env, { transport })).not.toBeNull();
      await revokePrismaRealRecipient(f.repository, {
        registrationId: f.registrationId, actorId: f.ownerId, reason: "withdrawn", at: f.at,
      });
      expect(await f.row()).toMatchObject({
        state: "revoked", ciphertext: null, nonce: null, tag: null, keyVersion: null, revokedAt: f.at,
      });
      expect(await db.notificationAudit.findFirstOrThrow({ where: { registrationId: f.registrationId, eventType: "recipient_revoked" } })).toMatchObject({
        actorId: f.ownerId, fromState: "active", toState: "revoked", code: "withdrawn",
      });
      expect(await decryptActiveRecipientPhone(f.repository, { key: f.recipientKey, now: new Date() })).toBeNull();
      expect(await buildRealSafe(f.repository, f.env, { transport })).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  }, 30000);

  it("rejects a synthetic registration marker and mock ownership evidence without creating ownership proof", async () => {
    await withFixture(async (f) => {
      await expect(registerPrismaRealRecipient(f.repository, { ...f.registrationInput(), synthetic: true })).rejects.toBeInstanceOf(ZodError);
      expect(await db.notificationRecipientRegistration.count({ where: { id: f.registrationId } })).toBe(0);
      expect((await f.runtime()).nonceHighWater).toBe(1n);
      await f.register();
      await f.grant();
      // Registration has no evidence parameter. Exercise the real evidence
      // schema at both record and verify instead of inventing such an input.
      const command = f.verificationInput();
      const invalid = { ...command, evidence: {
        ...command.evidence, id: "mock_ownership_v1", method: "synthetic_call", synthetic: true,
      } };
      await expect(recordPrismaRealOwnership(f.repository, invalid)).rejects.toBeInstanceOf(ZodError);
      await expect(verifyPrismaRealRecipient(f.repository, invalid)).rejects.toBeInstanceOf(ZodError);
      expect(await f.row()).toMatchObject({ state: "verification_pending", verifiedBy: null, verifiedAt: null });
      expect(await f.ownershipCount()).toBe(0);
    });
  }, 30000);

  it("blocks another registration and a second activation while the first version remains active", async () => {
    await withFixture(async (f) => {
      await verifiedFixture(f);
      // Registration itself rejects an occupied active slot. Prepare the
      // second version beforehand to also reach activateRealRecipient's
      // activeRegistration check through the real storage API.
      await f.register(f.secondId, f.secondVersion, "01000000002");
      await f.verify(f.verifierId, f.secondId, f.secondVersion);
      await f.activate();
      const before = await f.runtime();
      await expect(f.register(f.rejectedId, f.rejectedVersion, "01000000003")).rejects.toThrow("Invalid registration.");
      expect(await db.notificationRecipientRegistration.count({ where: { id: f.rejectedId } })).toBe(0);
      await expect(f.activate(f.secondId)).rejects.toThrow("Invalid activation.");
      expect(await f.row()).toMatchObject({ state: "active", version: f.version });
      expect(await f.row(f.secondId)).toMatchObject({ state: "verified_inactive", version: f.secondVersion });
      expect(await f.runtime()).toMatchObject({ recipientVersion: f.version, revision: before.revision });
      expect(await db.notificationRecipientRegistration.count({ where: { environment: "preview", service: "application.received", state: "active" } })).toBe(1);
      expect(await db.notificationAudit.count({ where: { registrationId: f.secondId, eventType: "recipient_activated" } })).toBe(0);
    });
  }, 30000);
});
