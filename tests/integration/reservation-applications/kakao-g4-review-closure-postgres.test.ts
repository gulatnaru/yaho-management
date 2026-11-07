import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
import { processOutboxBatch } from "@/lib/kakao/outbox-worker";
import type { SolapiTransport } from "@/lib/kakao/providers/solapi";
import { PrismaDispatchRepository, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { buildRealSafe, type RealSendEnv } from "@/server/kakao/real-send-wiring";
import {
  activatePrismaRealRecipient, recordPrismaRealOwnership, registerPrismaRealRecipient,
  verifyPrismaRealRecipient,
} from "@/server/kakao/recipient-storage-real";
import {
  closureNextReviewAt, executeClosure, pollEligibility, pollRowDelivery,
  record7dReview, recordClosureApproval, recordLookupApproval, recordResponsibilityReview,
} from "@/server/kakao/review-actions";
import { setPrismaRecipientAssignment } from "@/server/kakao/runtime-settings";
import { assertSafeE2eDatabaseUrls } from "@/tests/e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const DAY_MS = 86400000;
const unknownSince = new Date("2026-09-28T00:00:00Z");
const sevenDayDue = new Date("2026-10-05T00:00:00Z");
const thirtyDayDue = new Date("2026-10-28T00:00:00Z");
const closureAt = new Date("2026-10-29T00:00:00Z");
const lookupAt = new Date("2026-11-07T06:00:00Z");
const providerRef = "M4V20240525163506DRKMPITQDY5Q6F";
const fakePhone = "01000000000";

afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await db.$disconnect(); }, 30000);

// Real recipient identifiers reject phone-like digit runs. Retain UUID
// uniqueness while replacing digits with distinct non-hex letters.
function safeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/\d/g, (digit) => String.fromCharCode(107 + Number(digit)))}`;
}
function afterUnknown(days: number): Date { return new Date(unknownSince.getTime() + days * DAY_MS); }

type FixtureOptions = {
  lookup?: boolean;
  reviewed7dAt?: Date | null;
  responsibilityReviewedAt?: Date | null;
  finalStatus?: string | null;
  closureExecutorId?: string | null;
  approvalActor?: "owner" | "nonOwner";
};
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function withFixture(options: FixtureOptions, test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await createFixture(options);
  try { await test(fixture); } finally { await fixture.cleanup(); }
}

async function createFixture(options: FixtureOptions) {
  const outboxId = randomUUID(), namespace = `test_${randomUUID()}`;
  const ownerId = safeId("owner"), closureExecutorId = safeId("closure"), costExecutorId = safeId("cost"), nonOwnerId = safeId("nonowner");
  const userIds = [ownerId, closureExecutorId, costExecutorId, nonOwnerId];
  const registrationId = safeId("recipient"), version = safeId("version"), keyVersion = safeId("key");
  const key = randomBytes(32), occurredAt = new Date();
  const submittedAt = options.lookup ? occurredAt : unknownSince;
  const input = buildOutboxInput("application.received", `phase8_${outboxId}`, "created", "admin", submittedAt);
  const scoped = db.$extends({ query: { notificationOutbox: {
    findMany({ args, query }) { return query({ ...args, where: { AND: [args.where ?? {}, { id: outboxId }] } }); },
  } } });
  const repository = new PrismaDispatchRepository(scoped as unknown as PrismaGuardClient);
  const env: RealSendEnv = {
    apiKey: "test-api-key", apiSecret: "test-api-secret", pfId: "KA01PF1234567890abcdef",
    templateId: "real-template-v1", recipientKey: key,
  };
  const configuredClosureExecutor = options.closureExecutorId === undefined ? closureExecutorId : options.closureExecutorId;
  let runtimeCreated = false;
  const cleanup = async () => {
    try {
      // Capture only the periods touched by this fixture's durable cost rows
      // before deleting those rows. The occupancy check also rejects old budgets.
      const costs = await db.notificationCostReservation.findMany({ where: { dispatch: { outboxId } }, select: { dayKey: true, monthKey: true } });
      await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "outboxId"=${outboxId}
        OR "dispatchId" IN (SELECT "id" FROM "NotificationDispatch" WHERE "outboxId"=${outboxId})
        OR "slotId" IN (SELECT c."id" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id"=c."dispatchId" WHERE d."outboxId"=${outboxId})
        OR "registrationId"=${registrationId} OR "actorId" IN (${ownerId}, ${closureExecutorId}, ${costExecutorId}, ${nonOwnerId}) OR "keyVersion"=${keyVersion}`;
      await db.notificationCostReservation.deleteMany({ where: { dispatch: { outboxId } } });
      if (runtimeCreated && costs.length > 0) {
        await db.notificationBudgetPeriod.deleteMany({ where: {
          environment: "preview", service: "application.received", policyVersion: "g4-v1",
          OR: costs.flatMap((cost) => [{ periodType: "day", periodKey: cost.dayKey }, { periodType: "month", periodKey: cost.monthKey }]),
        } });
      }
      await db.notificationDispatch.deleteMany({ where: { outboxId } });
      await db.notificationRecipientRegistration.deleteMany({ where: { id: registrationId } });
      if (runtimeCreated) await db.notificationRuntimeConfig.deleteMany({ where: { environment: "preview", namespace } });
      await db.notificationOutbox.deleteMany({ where: { id: outboxId } });
      await db.reservationApplicationSubmission.deleteMany({ where: { id: input.entityId } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally { key.fill(0); }
  };
  try {
    const [occupied] = await db.$queryRaw<{ count: bigint }[]>`SELECT
      (SELECT count(*) FROM "NotificationRuntimeConfig" WHERE "environment"='preview')
      + (SELECT count(*) FROM "NotificationRecipientRegistration" WHERE "environment"='preview' AND "service"='application.received' AND "state"='active')
      + (SELECT count(*) FROM "NotificationDispatch" WHERE "environment"='preview')
      + (SELECT count(*) FROM "NotificationBudgetPeriod" WHERE "environment"='preview' AND "service"='application.received') AS count`;
    if (!occupied || occupied.count !== 0n) throw new Error("G4 review preview fixture namespace is occupied");
    await db.user.createMany({ data: userIds.map((id) => ({ id, email: `${id}@example.test`, name: "synthetic", role: "ADMIN" as const, isActive: true, mustChangePassword: false })) });
    await db.$executeRaw`INSERT INTO "NotificationRuntimeConfig"
      ("environment", "namespace", "blocked", "activationEpoch", "providerId", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "ownerId", "costExecutorId", "closureExecutorId", "updatedAt")
      VALUES ('preview', ${namespace}, false, ${new Date("2026-11-01T00:00:00Z")}, 'solapi', ${env.templateId}, 'g4-v1', 'g4-v1', ${keyVersion}, 1, true, true, true, ${ownerId}, ${costExecutorId}, ${configuredClosureExecutor}, ${occurredAt})`;
    runtimeCreated = true;
    // Use the real storage state machine even for closure fixtures; only the
    // historical unknown dispatch itself is inserted directly.
    await setPrismaRecipientAssignment(repository, { commandId: safeId("assignment"), actorId: ownerId, executorId: nonOwnerId, assignment: "verify", active: true, at: occurredAt });
    await registerPrismaRealRecipient(repository, {
      registrationId, version, userId: ownerId, actorId: ownerId,
      purposeVersion: "application-received-v1", policyVersion: "g4-v1", phoneNumber: fakePhone,
      key: { keyVersion, key }, at: occurredAt,
    });
    const evidence = { id: "operator_call_verified", method: "operator_call", success: true, registrationId, version, verifierId: nonOwnerId, verifiedAt: occurredAt } as const;
    await recordPrismaRealOwnership(repository, { registrationId, actorId: nonOwnerId, evidence, at: occurredAt });
    await verifyPrismaRealRecipient(repository, { registrationId, actorId: nonOwnerId, evidence, at: occurredAt });
    await activatePrismaRealRecipient(repository, { registrationId, actorId: ownerId, key: { keyVersion, key }, at: occurredAt });
    await db.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "synthetic", submittedAt } });
    await db.notificationOutbox.create({ data: { ...input, id: outboxId } });
    let dispatchId: string, slotId: string | null = null;
    if (options.lookup) {
      const sendCalls: { url: string; init: Parameters<SolapiTransport["fetch"]>[1] }[] = [];
      const transport: SolapiTransport = { async fetch(url, init) {
        sendCalls.push({ url, init });
        return { status: 200, json: async () => ({ groupInfo: { groupId: "G4V20240525163506ABCDEFGHIJKLMNO", status: "SENDING" }, failedMessageList: [], messageList: [{ messageId: providerRef, statusCode: "2000" }] }) };
      } };
      const safe = await buildRealSafe(repository, env, { transport });
      if (!safe) throw new Error("Lookup fixture real safe unavailable");
      expect(await processOutboxBatch(new PrismaOutboxStore(scoped), { provider: null, now: new Date(), limit: 1, safe: { ...safe, canIssue: () => true } }))
        .toEqual({ outcomes: [{ rowId: outboxId, status: "sent", rowStatus: "sent" }] });
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]!.url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
      expect(JSON.parse(sendCalls[0]!.init.body)).toMatchObject({ messages: [{ to: fakePhone }] });
      const dispatch = await db.notificationDispatch.findUniqueOrThrow({ where: { outboxId } });
      expect(dispatch).toMatchObject({ reconciliationState: "awaiting_final", finalStatus: null });
      const slots = await db.notificationCostReservation.findMany({ where: { dispatchId: dispatch.id, entryKind: "SEND_SLOT" } });
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({ status: "accepted", providerRef, reservedMilliKrw: 15000n });
      expect(slots[0]!.providerRef).toMatch(/^M4V[0-9]{14}[0-9A-Za-z]{14}$/);
      dispatchId = dispatch.id;
      slotId = slots[0]!.id;
      // PG names the worker's accepted dispatch "awaiting_final". Seed the
      // unresolved review state while preserving its genuine accepted slot,
      // provider ref, send audit and sent outbox; never synthesize a slot.
      await db.notificationDispatch.update({ where: { id: dispatchId }, data: { reconciliationState: "unknown", unknownSince: occurredAt } });
    } else {
      dispatchId = randomUUID();
      await db.$executeRaw`INSERT INTO "NotificationDispatch"
        ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion", "unknownSince", "reviewed7dAt", "responsibilityReviewedAt", "finalStatus")
        VALUES (${dispatchId}, ${outboxId}, 'preview', ${`${namespace}:${input.dedupeKey}`}, 'solapi', ${registrationId}, ${version}, ${env.templateId}, 'g4-v1', ${submittedAt}, 'unknown', 'g4-v1', ${unknownSince}, ${options.reviewed7dAt ?? null}, ${options.responsibilityReviewedAt ?? null}, ${options.finalStatus ?? null})`;
      await db.notificationOutbox.update({ where: { id: outboxId }, data: { status: "sent", nextRetryAt: null } });
    }
    const fixture = { outboxId, dispatchId, slotId, namespace, ownerId, closureExecutorId, costExecutorId, nonOwnerId, registrationId, env, repository, cleanup };
    if (options.approvalActor) {
      expect(await recordClosureApproval(repository, closureCommand(fixture, options.approvalActor === "owner" ? ownerId : nonOwnerId))).toEqual(options.approvalActor === "owner" ? { ok: true } : { ok: false, reason: "not_owner" });
    }
    return fixture;
  } catch (error) { await cleanup(); throw error; }
}

function closureCommand(f: { dispatchId: string; outboxId: string }, actorId: string) {
  return { dispatchId: f.dispatchId, commandId: `close_${f.outboxId}`, approvalId: `approve_${f.outboxId}`, evidenceId: `evidence_${f.outboxId}`, actorId, at: closureAt };
}
const closureReviews = { reviewed7dAt: sevenDayDue, responsibilityReviewedAt: thirtyDayDue };
async function dispatchRow(f: Fixture) { return db.notificationDispatch.findUniqueOrThrow({ where: { id: f.dispatchId } }); }
async function audits(f: Fixture, eventType: string) { return db.notificationAudit.findMany({ where: { dispatchId: f.dispatchId, eventType } }); }

async function withLookupFixture(test: (fixture: Fixture & { slotId: string }) => Promise<void>) {
  await withFixture({ lookup: true }, async (f) => {
    if (!f.slotId) throw new Error("Accepted lookup slot unavailable");
    expect(await dispatchRow(f)).toMatchObject({ reconciliationState: "unknown" });
    expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: f.outboxId } })).toMatchObject({ status: "sent" });
    await test({ ...f, slotId: f.slotId });
  });
}
function lookupCommand(f: Fixture & { slotId: string }, at = lookupAt) {
  return { slotId: f.slotId, commandId: safeId("poll"), approvalId: safeId("lookup_approval"), actorId: f.costExecutorId, at };
}
async function approveLookup(f: Fixture, command: ReturnType<typeof lookupCommand>) {
  const { actorId, ...input } = command;
  expect(await recordLookupApproval(f.repository, { ...input, actorId: f.ownerId, executorId: actorId })).toEqual({ ok: true });
}
function stubLookup(statusCode: string) {
  const stub = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ messageList: { [providerRef]: { messageId: providerRef, statusCode } } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", stub);
  return stub;
}
function expectOneLookup(stub: ReturnType<typeof stubLookup>) {
  expect(stub).toHaveBeenCalledTimes(1);
  expect(stub).toHaveBeenCalledWith(`https://api.solapi.com/messages/v4/list?messagesId=${providerRef}`, expect.objectContaining({ method: "GET" }));
  expect(stub.mock.calls[0]![1]?.body).toBeUndefined();
}
async function lookupCosts(f: Fixture) { return db.notificationCostReservation.findMany({ where: { dispatchId: f.dispatchId, entryKind: "LOOKUP_COST" } }); }

describe.sequential("G4 review, closure and lookup PostgreSQL evidence", () => {
  it("rejects a 7d review at unknownSince + 6d without writing review evidence", async () => {
    await withFixture({}, async (f) => {
      expect(await record7dReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("review"), actorId: f.ownerId, at: afterUnknown(6) })).toEqual({ ok: false, reason: "too_early" });
      expect((await dispatchRow(f)).reviewed7dAt).toBeNull();
      expect(await audits(f, "review_7d_recorded")).toEqual([]);
    });
  }, 30000);

  it("records a 7d review after seven days with eventId equal to commandId", async () => {
    await withFixture({}, async (f) => {
      const commandId = safeId("review"), at = afterUnknown(8);
      expect(await record7dReview(f.repository, { dispatchId: f.dispatchId, commandId, actorId: f.ownerId, at })).toEqual({ ok: true });
      expect((await dispatchRow(f)).reviewed7dAt).toEqual(at);
      expect(await audits(f, "review_7d_recorded")).toMatchObject([{ eventId: commandId, commandId, actorId: f.ownerId, occurredAt: at }]);
    });
  }, 30000);

  it("rejects an owner's responsibility review at unknownSince + 29d", async () => {
    await withFixture({}, async (f) => {
      expect(await recordResponsibilityReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("responsibility"), actorId: f.ownerId, at: afterUnknown(29) })).toEqual({ ok: false, reason: "too_early" });
      expect((await dispatchRow(f)).responsibilityReviewedAt).toBeNull();
      expect(await audits(f, "responsibility_reviewed")).toEqual([]);
    });
  }, 30000);

  it("records the owner's responsibility review after 30d and rejects a non-owner", async () => {
    await withFixture({}, async (f) => {
      const commandId = safeId("responsibility"), at = afterUnknown(31);
      expect(await recordResponsibilityReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("nonowner_review"), actorId: f.nonOwnerId, at })).toEqual({ ok: false, reason: "not_owner" });
      expect((await dispatchRow(f)).responsibilityReviewedAt).toBeNull();
      expect(await audits(f, "responsibility_reviewed")).toEqual([]);
      expect(await recordResponsibilityReview(f.repository, { dispatchId: f.dispatchId, commandId, actorId: f.ownerId, at })).toEqual({ ok: true });
      expect((await dispatchRow(f)).responsibilityReviewedAt).toEqual(at);
      expect(await audits(f, "responsibility_reviewed")).toMatchObject([{ eventId: commandId, commandId, actorId: f.ownerId, occurredAt: at }]);
      expect(await recordResponsibilityReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("repeat_review"), actorId: f.ownerId, at: afterUnknown(32) })).toEqual({ ok: false, reason: "already_recorded" });
      expect(await audits(f, "responsibility_reviewed")).toHaveLength(1);
    });
  }, 30000);

  it("rejects closure approval by a non-owner without a closure_approved row", async () => {
    await withFixture(closureReviews, async (f) => {
      expect(await recordClosureApproval(f.repository, closureCommand(f, f.nonOwnerId))).toEqual({ ok: false, reason: "not_owner" });
      expect(await audits(f, "closure_approved")).toEqual([]);
    });
  }, 30000);

  it("records owner closure approval after both reviews without changing the unknown dispatch", async () => {
    await withFixture({}, async (f) => {
      expect(await record7dReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("seven"), actorId: f.ownerId, at: sevenDayDue })).toEqual({ ok: true });
      expect(await recordResponsibilityReview(f.repository, { dispatchId: f.dispatchId, commandId: safeId("thirty"), actorId: f.ownerId, at: thirtyDayDue })).toEqual({ ok: true });
      const before = await dispatchRow(f), command = closureCommand(f, f.ownerId);
      expect(await recordClosureApproval(f.repository, command)).toEqual({ ok: true });
      expect(await audits(f, "closure_approved")).toMatchObject([{ eventId: command.approvalId, commandId: command.commandId, approvalId: command.approvalId, actorId: f.ownerId, evidenceId: command.evidenceId }]);
      expect(await dispatchRow(f)).toEqual(before);
      expect(before.reconciliationState).toBe("unknown");
    });
  }, 30000);

  it("rejects owner closure execution as not_closure_executor after owner approval", async () => {
    await withFixture({ ...closureReviews, approvalActor: "owner" }, async (f) => {
      expect(f.ownerId).not.toBe(f.closureExecutorId);
      expect(await executeClosure(f.repository, closureCommand(f, f.ownerId))).toEqual({ ok: false, reason: "not_closure_executor" });
      expect((await dispatchRow(f)).reconciliationState).toBe("unknown");
      expect(await audits(f, "closed_unconfirmed")).toEqual([]);
    });
  }, 30000);

  it("lets the closureExecutor close while preserving delivered finalStatus and scheduling exactly 30d", async () => {
    await withFixture({ ...closureReviews, finalStatus: "delivered", approvalActor: "owner" }, async (f) => {
      const command = closureCommand(f, f.closureExecutorId);
      expect(await executeClosure(f.repository, command)).toEqual({ ok: true });
      const nextReviewAt = new Date(closureAt.getTime() + 30 * DAY_MS);
      expect(closureNextReviewAt(closureAt)).toEqual(nextReviewAt);
      expect(await dispatchRow(f)).toMatchObject({ reconciliationState: "closed_unconfirmed", finalStatus: "delivered", closedAt: closureAt, nextReviewAt, approvalId: command.approvalId });
      expect(await audits(f, "closed_unconfirmed")).toMatchObject([{ eventId: command.commandId, actorId: f.closureExecutorId, approvalId: command.approvalId, occurredAt: closureAt }]);
    });
  }, 30000);

  it("rejects closure execution when runtime closureExecutorId is NULL despite owner approval", async () => {
    await withFixture({ ...closureReviews, closureExecutorId: null, approvalActor: "owner" }, async (f) => {
      expect(await audits(f, "closure_approved")).toHaveLength(1);
      expect(await executeClosure(f.repository, closureCommand(f, f.closureExecutorId))).toEqual({ ok: false, reason: "not_closure_executor" });
      expect(await dispatchRow(f)).toMatchObject({ reconciliationState: "unknown", closedAt: null });
      expect(await audits(f, "closed_unconfirmed")).toEqual([]);
    });
  }, 30000);

  it("pollEligibility enforces the five-minute interval and in-flight exclusion", () => {
    expect(pollEligibility(new Date(lookupAt.getTime() - 4 * 60000), false, lookupAt)).toEqual({ ok: false, reason: "too_soon" });
    expect(pollEligibility(new Date(lookupAt.getTime() - 6 * 60000), false, lookupAt)).toEqual({ ok: true });
    expect(pollEligibility(null, true, lookupAt)).toEqual({ ok: false, reason: "lookup_in_flight" });
    expect(pollEligibility(null, false, lookupAt)).toEqual({ ok: true });
  });

  it("blocks polling without approval before global fetch or LOOKUP_COST reservation", async () => {
    const stub = stubLookup("4000");
    await withLookupFixture(async (f) => {
      expect(await pollRowDelivery(f.repository, f.env, lookupCommand(f))).toEqual({ ok: false, reason: "blocked" });
      expect(stub).toHaveBeenCalledTimes(0);
      expect(await lookupCosts(f)).toEqual([]);
    });
  }, 30000);

  it("records delivered after owner lookup approval and one mocked list request with 500 milliKRW reserved", async () => {
    const stub = stubLookup("4000");
    await withLookupFixture(async (f) => {
      const command = lookupCommand(f);
      await approveLookup(f, command);
      expect(await pollRowDelivery(f.repository, f.env, command)).toEqual({ ok: true, result: "recorded" });
      expect((await dispatchRow(f)).finalStatus).toBe("delivered");
      expect(await lookupCosts(f)).toMatchObject([{ entryKind: "LOOKUP_COST", sourceSlotId: f.slotId, operationKey: command.commandId, reservedMilliKrw: 500n, issuedAt: lookupAt }]);
      expectOneLookup(stub);
    });
  }, 30000);

  it("treats lookup statusCode 3014 as unknown without recording delivery_failed", async () => {
    const stub = stubLookup("3014");
    await withLookupFixture(async (f) => {
      const command = lookupCommand(f);
      await approveLookup(f, command);
      expect(await pollRowDelivery(f.repository, f.env, command)).toEqual({ ok: true, result: "unknown" });
      expect((await dispatchRow(f)).finalStatus).toBeNull();
      expect(await lookupCosts(f)).toMatchObject([{ status: "unknown", costState: "reserved_unknown", reservedMilliKrw: 500n }]);
      expectOneLookup(stub);
    });
  }, 30000);

  it("rejects polling one minute after the previous lookup as too_soon with no additional fetch", async () => {
    const stub = stubLookup("3014");
    await withLookupFixture(async (f) => {
      const first = lookupCommand(f);
      await approveLookup(f, first);
      expect(await pollRowDelivery(f.repository, f.env, first)).toEqual({ ok: true, result: "unknown" });
      expectOneLookup(stub);
      const [last] = await db.$queryRaw<{ issuedAt: Date | null }[]>`SELECT MAX("issuedAt") AS "issuedAt" FROM "NotificationCostReservation" WHERE "dispatchId"=${f.dispatchId} AND "entryKind"='LOOKUP_COST'`;
      expect(last?.issuedAt).toEqual(first.at);
      expect(await lookupCosts(f)).toMatchObject([{ status: "unknown" }]);
      const second = lookupCommand(f, new Date(first.at.getTime() + 60000));
      expect(second.commandId).not.toBe(first.commandId);
      expect(second.approvalId).not.toBe(first.approvalId);
      await approveLookup(f, second);
      expect(await pollRowDelivery(f.repository, f.env, second)).toEqual({ ok: false, reason: "too_soon" });
      expectOneLookup(stub);
      expect(await lookupCosts(f)).toHaveLength(1);
    });
  }, 30000);

  it("blocks a previous Seoul-day approval across midnight with the same command and no fetch", async () => {
    const stub = stubLookup("4000");
    await withLookupFixture(async (f) => {
      // Same UTC date, different Seoul days: 23:59 on Nov 7 -> 00:01 on Nov 8.
      const command = lookupCommand(f, new Date("2026-11-07T14:59:00Z"));
      await approveLookup(f, command);
      expect(await pollRowDelivery(f.repository, f.env, { ...command, at: new Date("2026-11-07T15:01:00Z") })).toEqual({ ok: false, reason: "blocked" });
      expect(stub).toHaveBeenCalledTimes(0);
      expect(await lookupCosts(f)).toEqual([]);
    });
  }, 30000);
});
