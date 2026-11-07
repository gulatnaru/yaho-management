import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOutboxInput } from "@/lib/kakao/outbox";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { PrismaDispatchRepository, closePrismaUnconfirmed, type PrismaGuardClient } from "@/server/kakao/dispatch-repository";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const run = `g2-closure-${randomUUID()}`;
const owner = `${run}-owner`;
const actor = `${run}-actor`;
const at = new Date("2026-10-28T00:00:00Z");
const unknownSince = new Date("2026-09-28T00:00:00Z");
const reviewed7dAt = new Date("2026-10-05T00:00:00Z");
const responsibilityReviewedAt = new Date("2026-10-28T00:00:00Z");
const nextReviewAt = new Date("2026-11-27T00:00:00Z");
beforeAll(async () => {
  await db.user.create({ data: { id: owner, email: `${owner}@example.test`, name: "synthetic", role: "ADMIN" } });
  await db.user.create({ data: { id: actor, email: `${actor}@example.test`, name: "synthetic", role: "ADMIN" } });
});
afterAll(async () => { try { await db.user.deleteMany({ where: { id: { in: [owner, actor] } } }); } finally { await db.$disconnect(); } });

async function withClosureGuard<T>(options: { finalStatus?: string | null; approvalActorId?: string; unknownSinceOverride?: Date } | undefined, test: (f: Awaited<ReturnType<typeof createClosureGuard>>) => Promise<T>): Promise<T> {
  const f = await createClosureGuard(options);
  try { return await test(f); } finally { await f.cleanup(); }
}
async function createClosureGuard(options: { finalStatus?: string | null; approvalActorId?: string; unknownSinceOverride?: Date } = {}) {
  const id = randomUUID(), registration = `${id}-recipient`;
  const key = randomBytes(32), keyVersion = `k${randomUUID()}`, namespace = `test_${randomUUID()}`;
  const input = buildOutboxInput("application.received", `phase8_${id}`, "created", "admin", at);
  const encrypted = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), key, 1n,
    { environment: "preview", registrationId: registration, registrationVersion: "v1", keyVersion },
    { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true });
  const finalStatus: string | null = options.finalStatus ?? null;
  const approvalActorId = options.approvalActorId ?? owner;
  const since = options.unknownSinceOverride ?? unknownSince;
  const approvalId = `${id}-approval`;
  const command = { commandId: `close-${id}`, dispatchId: id, actorId: actor, approvalId, evidenceId: `${id}-evidence`, at, nextReviewAt };
  let runtimeCreated = false;
  const cleanup = async () => {
    await db.$executeRaw`DELETE FROM "NotificationAudit" WHERE "dispatchId"=${id} OR "registrationId"=${registration}`;
    await db.$executeRaw`DELETE FROM "NotificationDispatch" WHERE "id"=${id}`;
    await db.$executeRaw`DELETE FROM "NotificationRecipientRegistration" WHERE "id"=${registration}`;
    if (runtimeCreated) await db.$executeRaw`DELETE FROM "NotificationRuntimeConfig" WHERE "environment"='preview' AND "namespace"=${namespace}`;
    await db.notificationOutbox.deleteMany({ where: { id } });
    await db.reservationApplicationSubmission.deleteMany({ where: { id: input.entityId } });
    key.fill(0);
  };
  try {
    const occupied = await db.$queryRaw<{ count: bigint }[]>`SELECT (SELECT count(*) FROM "NotificationRuntimeConfig" WHERE "environment"='preview') + (SELECT count(*) FROM "NotificationRecipientRegistration" WHERE "environment"='preview' AND "service"='application.received' AND "state"='active') + (SELECT count(*) FROM "NotificationDispatch" WHERE "environment"='preview') AS count`;
    if (occupied[0]!.count !== 0n) throw new Error("Synthetic preview fixture namespace is occupied");
    await db.$executeRaw`INSERT INTO "NotificationRuntimeConfig" ("environment", "namespace", "blocked", "activationEpoch", "providerId", "recipientVersion", "templateVersion", "costPolicyVersion", "policyVersion", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "updatedAt", "ownerId") VALUES ('preview', ${namespace}, false, ${at}, 'solapi', 'v1', 'g2-v1', 'g2-v1', 'g2-v1', ${keyVersion}, 1, true, true, true, ${at}, ${owner})`;
    runtimeCreated = true;
    await db.reservationApplicationSubmission.create({ data: { id: input.entityId, guardianName: "synthetic", submittedAt: at } });
    await db.notificationOutbox.create({ data: { ...input, id } });
    await db.$executeRaw`INSERT INTO "NotificationRecipientRegistration" ("id", "environment", "service", "userId", "version", "state", "purposeVersion", "policyVersion", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt") VALUES (${registration}, 'preview', 'application.received', ${owner}, 'v1', 'active', 'v1', 'v1', ${encrypted.ciphertext}, ${encrypted.nonce}, ${encrypted.tag}, ${keyVersion}, 'synthetic_call', 'mock_ownership_v1', ${owner}, ${at})`;
    await db.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "reconciliationState", "policyVersion", "unknownSince", "reviewed7dAt", "responsibilityReviewedAt", "finalStatus") VALUES (${id}, ${id}, 'preview', ${`${namespace}:${input.dedupeKey}`}, 'solapi', ${registration}, 'v1', 'mock_application_received_v1', 'g2-v1', ${at}, 'unknown', 'g2-v1', ${since}, ${reviewed7dAt}, ${responsibilityReviewedAt}, ${finalStatus})`;
    await db.$executeRaw`UPDATE "NotificationOutbox" SET "status"='sent', "nextRetryAt"=NULL WHERE "id"=${id}`;
    await db.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "dispatchId", "actorId", "commandId", "evidenceId", "occurredAt") VALUES (${approvalId}, ${approvalId}, 'preview', 'closure_approved', ${id}, ${approvalActorId}, ${command.commandId}, ${command.evidenceId}, ${at})`;
    return { id, command, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

async function dispatchRow(id: string) {
  const [row] = await db.$queryRaw<{ reconciliationState: string; finalStatus: string | null; closedAt: Date | null; approvalId: string | null; nextReviewAt: Date | null; auditSequence: number }[]>`SELECT "reconciliationState", "finalStatus", "closedAt", "approvalId", "nextReviewAt", "auditSequence" FROM "NotificationDispatch" WHERE "id"=${id}`;
  return row!;
}

describe.sequential("G3 closePrismaUnconfirmed PostgreSQL evidence", () => {
  it("closes an unknown dispatch and writes the closed_unconfirmed audit, then no-ops on retry", async () => {
    await withClosureGuard(undefined, async (f) => {
      const repository = new PrismaDispatchRepository(db as unknown as PrismaGuardClient);
      await closePrismaUnconfirmed(repository, f.command);
      expect(await dispatchRow(f.id)).toEqual({ reconciliationState: "closed_unconfirmed", finalStatus: "unknown", closedAt: at, approvalId: f.command.approvalId, nextReviewAt, auditSequence: 1 });
      expect(await db.$queryRaw<{ eventType: string; sequence: number; actorId: string; commandId: string; approvalId: string; evidenceId: string }[]>`SELECT "eventType", "sequence", "actorId", "commandId", "approvalId", "evidenceId" FROM "NotificationAudit" WHERE "eventId"=${f.command.commandId}`).toEqual([{ eventType: "closed_unconfirmed", sequence: 1, actorId: actor, commandId: f.command.commandId, approvalId: f.command.approvalId, evidenceId: f.command.evidenceId }]);
      await closePrismaUnconfirmed(repository, f.command);
      expect(await dispatchRow(f.id)).toEqual({ reconciliationState: "closed_unconfirmed", finalStatus: "unknown", closedAt: at, approvalId: f.command.approvalId, nextReviewAt, auditSequence: 1 });
      expect(await db.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "NotificationAudit" WHERE "eventId"=${f.command.commandId}`).toEqual([{ count: 1n }]);
    });
  }, 30000);

  it("preserves a delivered finalStatus when closing", async () => {
    await withClosureGuard({ finalStatus: "delivered" }, async (f) => {
      const repository = new PrismaDispatchRepository(db as unknown as PrismaGuardClient);
      await closePrismaUnconfirmed(repository, f.command);
      expect(await dispatchRow(f.id)).toMatchObject({ reconciliationState: "closed_unconfirmed", finalStatus: "delivered", auditSequence: 1 });
    });
  }, 30000);

  it("rejects closure when the approval actor is not the runtime owner", async () => {
    await withClosureGuard({ approvalActorId: actor }, async (f) => {
      const repository = new PrismaDispatchRepository(db as unknown as PrismaGuardClient);
      await expect(closePrismaUnconfirmed(repository, f.command)).rejects.toThrow("Closure approval unavailable.");
      expect(await dispatchRow(f.id)).toMatchObject({ reconciliationState: "unknown", auditSequence: 0 });
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "eventType"='closed_unconfirmed' AND "dispatchId"=${f.id}`).toEqual([]);
    });
  }, 30000);

  it("rejects closure when the 30-day condition is unmet", async () => {
    await withClosureGuard({ unknownSinceOverride: new Date("2026-10-18T00:00:00Z") }, async (f) => {
      const repository = new PrismaDispatchRepository(db as unknown as PrismaGuardClient);
      await expect(closePrismaUnconfirmed(repository, f.command)).rejects.toThrow("Closure conditions unavailable.");
      expect(await dispatchRow(f.id)).toMatchObject({ reconciliationState: "unknown", auditSequence: 0 });
      expect(await db.$queryRaw`SELECT * FROM "NotificationAudit" WHERE "eventType"='closed_unconfirmed' AND "dispatchId"=${f.id}`).toEqual([]);
    });
  }, 30000);
});
