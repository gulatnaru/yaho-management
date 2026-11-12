import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readConsultation, deleteConsultation } from "@/server/ai-service/admin";
import { purgeOldAudits, runRetentionCron } from "@/server/ai-service/retention";
import { hashes } from "@/server/ai-service/crypto";
import { handleKakaoSkill } from "@/server/ai-service/skill";
import { createTools } from "@/server/ai-service/tools";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
import { skillReply, type Environment } from "@/server/ai-service/contracts";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const db = new PrismaClient();
const now = new Date("2026-10-15T00:00:00Z");
const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const keys = { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" };
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const subject = `synthetic-subject-${suffix}`;
const subjectHashes = hashes(keys, "subject", "PREVIEW", subject);
const guidance = "합성 준비물은 모자입니다.";
const cronSecret = "synthetic-cron-secret";

async function auditCount() {
    return db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW" } });
}
async function seedExpiredRow(id: string, createdAt: Date) {
    const expiresAt = new Date(createdAt.getTime() + 90 * 86400000);
    return db.aiServiceRequest.create({
        data: { id, environment: "PREVIEW", month: "2026-07", requestKey: `oq12-p0-${suffix}-${id}`,
            requestHashes: [`v1:${"a".repeat(64)}`], payloadHash: `v1:${"b".repeat(64)}`, subjectHashes: [`v1:${"c".repeat(64)}`],
            status: "SETTLED", reservedKrw: 2, usedKrw: 0, provider: "DETERMINISTIC", model: "deterministic-v1",
            priceSnapshot: {}, createdAt, expiresAt, attemptDeadline: new Date(createdAt.getTime() + 3500) },
    });
}

beforeAll(async () => {
    await db.aiServiceRequest.deleteMany({ where: { environment: "PREVIEW", requestKey: { startsWith: `oq12-p0-${suffix}` } } });
    await db.aiServiceBudgetMonth.upsert({
        where: { environment_month: { environment: "PREVIEW", month: "2026-07" } },
        update: {},
        create: { id: "PREVIEW:2026-07", environment: "PREVIEW", month: "2026-07", capKrw: 1000, reservedKrw: 0, usedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0, version: 1 },
    });
    await db.aiServiceConfig.upsert({
        where: { environment: "PREVIEW" },
        update: { paused: false, schedulerEnabled: false, provider: "TEST_DOUBLE", model: "gpt-6-luna" },
        create: { environment: "PREVIEW", paused: false, schedulerEnabled: false, provider: "TEST_DOUBLE", model: "gpt-6-luna",
            priceVersion: "price-v1", version: 1, inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500,
            fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", updatedById: "synthetic-admin" },
    });
    await db.aiServiceKnowledgeEntry.upsert({
        where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
        update: { content: guidance, approved: true },
        create: { environment: "PREVIEW", topic: "PREPARATION", content: guidance, approved: true, updatedById: "synthetic-admin" },
    });
});
afterAll(async () => {
    // Audit rows are append-only by the guard trigger (fresh rows cannot be
    // deleted) and stay in this throwaway cluster as documented residue,
    // like the AiServiceBudgetMonth / AiServiceKeyPin rows before them.
    await db.aiServiceRequest.deleteMany({ where: { environment: "PREVIEW", requestKey: { startsWith: `oq12-p0-${suffix}` } } });
    // updateMany (not update): if beforeAll failed before the config upsert,
    // teardown must not throw on the missing row.
    await db.aiServiceConfig.updateMany({ where: { environment: "PREVIEW" }, data: { schedulerEnabled: false } });
    await db.$disconnect();
});

describe.sequential("OQ-12 P0 on real PostgreSQL (isolated DB 55435)", () => {
    it("guard trigger blocks UPDATE and in-window DELETE, and allows old-row DELETE", async () => {
        const fresh = await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "DELETE_SINGLE", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "USER_REQUEST", scope: "SINGLE" } });
        await expect(db.aiServiceDeletionAudit.update({ where: { id: fresh.id }, data: { scope: "BULK" } })).rejects.toThrow();
        await expect(db.aiServiceDeletionAudit.delete({ where: { id: fresh.id } })).rejects.toThrow();
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: fresh.id } })).not.toBeNull();
        const old = await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "DELETE_SINGLE", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "USER_REQUEST", scope: "SINGLE", createdAt: new Date(now.getTime() - 366 * 86400000) } });
        await db.aiServiceDeletionAudit.delete({ where: { id: old.id } });
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: old.id } })).toBeNull();
    });

    it("CHECK constraint rejects an invalid audit kind", async () => {
        await expect(db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "BOGUS", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "USER_REQUEST", scope: "SINGLE" } })).rejects.toThrow();
    });

    it("purgeOldAudits deletes only rows older than 365 days", async () => {
        const before = await auditCount();
        const old1 = await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "DELETE_BULK", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "ADMIN_REVIEW", scope: "BULK", createdAt: new Date(now.getTime() - 366 * 86400000) } });
        const old2 = await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "DELETE_BULK", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "ADMIN_REVIEW", scope: "BULK", createdAt: new Date(now.getTime() - 400 * 86400000) } });
        const fresh = await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "READ_CONSULTATION", requestId: randomUUID(), actorId: "synthetic-admin", reasonCode: "ADMIN_READ", scope: "READ", createdAt: new Date(now.getTime() - 10 * 86400000) } });
        expect(await purgeOldAudits(db, "PREVIEW", now)).toEqual({ auditDeleted: 2 });
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: old1.id } })).toBeNull();
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: old2.id } })).toBeNull();
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: fresh.id } })).not.toBeNull();
        expect(await auditCount()).toBe(before + 1);
    });

    it("cron deletes expired rows when enabled and refuses when the flag is off", async () => {
        const expiredAt = new Date("2026-07-07T00:00:00Z");
        const ids = ["oq12-p0-exp-1", "oq12-p0-exp-2", "oq12-p0-exp-3"];
        for (const id of ids) await seedExpiredRow(id, expiredAt);
        const live = await db.aiServiceRequest.create({ data: { id: "oq12-p0-live-1", environment: "PREVIEW", month: "2026-10", requestKey: `oq12-p0-${suffix}-live`,
            requestHashes: [`v1:${"d".repeat(64)}`], payloadHash: `v1:${"e".repeat(64)}`, subjectHashes: [`v1:${"f".repeat(64)}`],
            status: "SETTLED", reservedKrw: 2, usedKrw: 0, provider: "DETERMINISTIC", model: "deterministic-v1",
            priceSnapshot: {}, createdAt: now, expiresAt: new Date(now.getTime() + 90 * 86400000), attemptDeadline: new Date(now.getTime() + 3500) } });
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { schedulerEnabled: true } });
        const result = await runRetentionCron(db, `Bearer ${cronSecret}`, "preview", cronSecret, now);
        expect(result).toEqual({ status: 200, body: { deleted: 3, auditDeleted: 0, waiting: false, expiredRemaining: 0 } });
        for (const id of ids) expect(await db.aiServiceRequest.findUnique({ where: { id } })).toBeNull();
        expect(await db.aiServiceRequest.findUnique({ where: { id: live.id } })).not.toBeNull();
        expect(await db.aiServiceRetentionJob.findUnique({ where: { environment: "PREVIEW" } })).toMatchObject({ status: "IDLE", attempts: 0 });
        await seedExpiredRow("oq12-p0-exp-4", expiredAt);
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { schedulerEnabled: false } });
        expect(await runRetentionCron(db, `Bearer ${cronSecret}`, "preview", cronSecret, now)).toEqual({ status: 503, body: { error: "AI_RETENTION_NOT_ACTIVE" } });
        expect(await db.aiServiceRequest.findUnique({ where: { id: "oq12-p0-exp-4" } })).not.toBeNull();
        await db.aiServiceRequest.delete({ where: { id: "oq12-p0-exp-4" } });
        await db.aiServiceRequest.delete({ where: { id: live.id } });
    });

    it("single delete releases PROCESSING budget and writes an audit row; a wrong subject is denied", async () => {
        // The seeded PROCESSING row claims reservedKrw 2, so the budget row
        // must hold that reserve first — otherwise the release decrement
        // would drive reservedKrw below 0 and trip the
        // ai_service_budget_nonnegative CHECK (the real claim path always
        // increments the budget before creating the row). Month 2026-07 is
        // this file's own budget month (beforeAll upsert), so no other
        // integration file's 2026-10 assertions are affected.
        await db.aiServiceBudgetMonth.update({ where: { environment_month: { environment: "PREVIEW", month: "2026-07" } }, data: { reservedKrw: 2 } });
        const budgetBefore = await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-07" } } });
        const row = await db.aiServiceRequest.create({ data: { id: randomUUID(), environment: "PREVIEW", month: "2026-07", requestKey: `oq12-p0-${suffix}-proc`,
            requestHashes: [`v1:${"1".repeat(64)}`], payloadHash: `v1:${"2".repeat(64)}`, subjectHashes,
            status: "PROCESSING", reservedKrw: 2, usedKrw: 0, provider: "DETERMINISTIC", model: "deterministic-v1",
            priceSnapshot: {}, createdAt: now, expiresAt: new Date(now.getTime() + 90 * 86400000), attemptDeadline: new Date(now.getTime() + 3500) } });
        const auditsBefore = await auditCount();
        const result = await deleteConsultation(db, "PREVIEW", admin, keys, { subjectUserId: subject, scope: "SINGLE", requestId: row.id, reasonCode: "USER_REQUEST" });
        expect(result).toEqual({ deletedCount: 1, remainingCount: 0 });
        expect(await db.aiServiceRequest.findUnique({ where: { id: row.id } })).toBeNull();
        const budgetAfter = await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-07" } } });
        expect(budgetAfter!.reservedKrw).toBe((budgetBefore?.reservedKrw ?? 0) - 2);
        expect(budgetAfter!.version).toBe((budgetBefore?.version ?? 0) + 1);
        expect(await auditCount()).toBe(auditsBefore + 1);
        const audit = await db.aiServiceDeletionAudit.findFirst({ where: { environment: "PREVIEW", requestId: row.id }, orderBy: { createdAt: "desc" } });
        expect(audit).toMatchObject({ kind: "DELETE_SINGLE", actorId: "synthetic-admin", reasonCode: "USER_REQUEST", scope: "SINGLE" });
        const kept = await db.aiServiceRequest.create({ data: { id: randomUUID(), environment: "PREVIEW", month: "2026-07", requestKey: `oq12-p0-${suffix}-kept`,
            requestHashes: [`v1:${"3".repeat(64)}`], payloadHash: `v1:${"4".repeat(64)}`, subjectHashes,
            status: "SETTLED", reservedKrw: 2, usedKrw: 0, provider: "DETERMINISTIC", model: "deterministic-v1",
            priceSnapshot: {}, createdAt: now, expiresAt: new Date(now.getTime() + 90 * 86400000), attemptDeadline: new Date(now.getTime() + 3500) } });
        await expect(deleteConsultation(db, "PREVIEW", admin, keys, { subjectUserId: `synthetic-other-${suffix}`, scope: "SINGLE", requestId: kept.id, reasonCode: "USER_REQUEST" })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(await db.aiServiceRequest.findUnique({ where: { id: kept.id } })).not.toBeNull();
        expect(await auditCount()).toBe(auditsBefore + 1);
        await db.aiServiceRequest.delete({ where: { id: kept.id } });
    });

    it("a real original-text read writes a READ audit row", async () => {
        const environment: Environment = "PREVIEW";
        const tools = createTools(db, environment, () => now);
        const deps = { db, environment, secret: "synthetic-integration-prod-secret-0123456789abcdef", testSecret: "synthetic-integration-test-secret-0123456789abcdef", botId: "synthetic-bot", clock: () => now, keys, tools };
        const reply = await handleKakaoSkill(new Headers({ "x-yaho-skill-key": deps.secret }), JSON.stringify({
            bot: { id: deps.botId }, userRequest: { utterance: "야호 준비물을 알려 주세요.", user: { id: subject } },
            action: { id: "synthetic-eval-action", name: "synthetic" },
        }), `oq12-p0-read-${suffix}`, deps);
        expect(reply).toEqual(skillReply(guidance));
        const row = await db.aiServiceRequest.findFirst({ where: { environment: "PREVIEW" }, orderBy: { createdAt: "desc" } });
        expect(row).not.toBeNull();
        const auditsBefore = await auditCount();
        const value = await readConsultation(db, "PREVIEW", admin, keys, row!.id, () => new Date(now.getTime() + 1000));
        expect(value).toEqual({ utterance: "야호 준비물을 알려 주세요.", reply: guidance });
        expect(await auditCount()).toBe(auditsBefore + 1);
        const audit = await db.aiServiceDeletionAudit.findFirst({ where: { environment: "PREVIEW", requestId: row!.id }, orderBy: { createdAt: "desc" } });
        expect(audit).toMatchObject({ kind: "READ_CONSULTATION", actorId: "synthetic-admin", reasonCode: "ADMIN_READ", scope: "READ" });
        await db.aiServiceRequest.delete({ where: { id: row!.id } });
    });
});
