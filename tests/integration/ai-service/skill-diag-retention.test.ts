import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type AiServiceConfig, type AiServiceRetentionJob } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readState } from "@/server/ai-service/admin";
import { RETENTION_MS, skillReply, type Environment } from "@/server/ai-service/contracts";
import { countEligibleSkillDiag, purgeOldAudits, purgeSkillDiagManual, runRetentionCron } from "@/server/ai-service/retention";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
const safeUrls = assertSafeE2eDatabaseUrls(
    { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL },
    { additionalPorts: ["55435"] },
);
if (Object.values(safeUrls).some(metadata => metadata.port !== "55435")) throw new Error("SKILL_DIAG_RETENTION_REQUIRES_55435");

// This suite is authored for the isolated 55435 cluster only. Historical dates
// keep its eligible fixtures separate from the existing suites' 2026 records.
// Fail closed below if that separation is not true; never clear foreign rows.
const db = new PrismaClient();
const runUuid = randomUUID();
const actor = { userId: `skill-diag-retention-${runUuid}`, role: "ADMIN", active: true };
const now = new Date("2001-04-01T00:00:00.123Z");
const cutoff = new Date(now.getTime() - RETENTION_MS); // 2001-01-01T00:00:00.123Z
const cronSecret = "synthetic-diag-retention-cron-secret";
const correlationIds: string[] = [];
const requestId = randomUUID();
const budgetId = `skill-diag-retention-${runUuid}`;
const knowledgeId = `skill-diag-retention-${runUuid}`;
const oldAuditIds: string[] = [];
let configBaseline: AiServiceConfig | null | undefined;
let retentionBaseline: AiServiceRetentionJob | null | undefined;
let createdConfig = false;
let createdKnowledge = false;
let configTouched = false;
let retentionTouched = false;
let firstAuditId: string | null = null;

async function seedDiag(count: number, emittedAt = cutoff, environment: Environment = "PREVIEW") {
    const rows = Array.from({ length: count }, () => ({ correlationId: randomUUID(), environment, stageCode: "S1_GATE_OFF", emittedAt }));
    correlationIds.push(...rows.map(row => row.correlationId));
    await db.aiServiceSkillDiag.createMany({ data: rows });
    return rows.map(row => row.correlationId);
}
const ownDiagRows = () => db.aiServiceSkillDiag.findMany({ where: { correlationId: { in: correlationIds } }, orderBy: { correlationId: "asc" } });
const ownAudits = () => db.aiServiceDeletionAudit.findMany({ where: { actorId: actor.userId }, orderBy: { seq: "asc" } });

// Full row arrays pin counts, identities, and every value (including dynamic
// budget versions). Only this file's deliberately appended audits are excluded.
async function neighbours() {
    return {
        requests: await db.aiServiceRequest.findMany({ orderBy: { id: "asc" } }),
        budgets: await db.aiServiceBudgetMonth.findMany({ orderBy: { id: "asc" } }),
        knowledge: await db.aiServiceKnowledgeEntry.findMany({ orderBy: { id: "asc" } }),
        configs: await db.aiServiceConfig.findMany({ orderBy: { environment: "asc" } }),
        audits: await db.aiServiceDeletionAudit.findMany({ where: { actorId: { not: actor.userId } }, orderBy: { seq: "asc" } }),
        guidanceAudits: await db.aiServiceGuidanceAudit.findMany({ orderBy: { id: "asc" } }),
        quotas: await db.aiServiceQuotaBucket.findMany({ orderBy: { id: "asc" } }),
        metrics: await db.aiServiceDailyMetric.findMany({ orderBy: { id: "asc" } }),
        retention: await db.aiServiceRetentionJob.findMany({ orderBy: { environment: "asc" } }),
        keys: await db.aiServiceKeyPin.findMany({ orderBy: { id: "asc" } }),
        reconciliations: await db.aiServiceReconciliation.findMany({ orderBy: { id: "asc" } }),
        programs: await db.aiServiceProgramPublication.findMany({ orderBy: { id: "asc" } }),
        classes: await db.aiServiceClassPublication.findMany({ orderBy: { id: "asc" } }),
    };
}

beforeAll(async () => {
    configBaseline = await db.aiServiceConfig.findUnique({ where: { environment: "PREVIEW" } });
    retentionBaseline = await db.aiServiceRetentionJob.findUnique({ where: { environment: "PREVIEW" } });
    if (!configBaseline) {
        await db.aiServiceConfig.create({ data: {
            environment: "PREVIEW", paused: true, schedulerEnabled: false, provider: "TEST_DOUBLE", model: "gpt-6-luna",
            priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500,
            fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", updatedById: actor.userId,
        } });
        createdConfig = true;
    }
    // POLICY is a CHECK-approved topic. Reuse it untouched if another suite
    // owns it; otherwise seed one uniquely identified neighbour for this file.
    if (!await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } } })) {
        await db.aiServiceKnowledgeEntry.create({ data: {
            id: knowledgeId, environment: "PREVIEW", topic: "POLICY", content: "합성 진단 보존 이웃 행입니다.", approved: false, updatedById: actor.userId,
        } });
        createdKnowledge = true;
    }
    const occupied = new Set((await db.aiServiceBudgetMonth.findMany({ where: { environment: "PREVIEW" }, select: { month: true } })).map(row => row.month));
    const month = Array.from({ length: 1200 }, (_, index) => `${1900 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`).find(value => !occupied.has(value));
    if (!month) throw new Error("SKILL_DIAG_RETENTION_NO_OWN_BUDGET_MONTH");
    await db.aiServiceBudgetMonth.create({ data: { id: budgetId, environment: "PREVIEW", month, capKrw: 1000 } });
    await db.aiServiceRequest.create({ data: {
        id: requestId, environment: "PREVIEW", month, requestKey: `skill-diag-retention-${runUuid}`,
        requestHashes: [`v1:${"a".repeat(64)}`], payloadHash: `v1:${"b".repeat(64)}`, subjectHashes: [`v1:${"c".repeat(64)}`],
        status: "SETTLED", reservedKrw: 2, usedKrw: 0, provider: "DETERMINISTIC", model: "deterministic-v1", priceSnapshot: {},
        createdAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS), attemptDeadline: new Date(now.getTime() + 3500),
    } });
});
beforeEach(async () => {
    // The predicate is environment-wide, so refuse rather than deleting a
    // foreign eligible diagnostic row, even on an unexpectedly reused cluster.
    expect(await db.aiServiceSkillDiag.count({ where: { environment: "PREVIEW", emittedAt: { lte: cutoff } } })).toBe(0);
});
afterEach(async () => {
    await db.aiServiceSkillDiag.deleteMany({ where: { correlationId: { in: correlationIds } } });
});
afterAll(async () => {
    try {
        await db.aiServiceSkillDiag.deleteMany({ where: { correlationId: { in: correlationIds } } });
        await db.aiServiceRequest.deleteMany({ where: { id: requestId, requestKey: `skill-diag-retention-${runUuid}` } });
        if (createdKnowledge) await db.aiServiceKnowledgeEntry.deleteMany({ where: { id: knowledgeId, updatedById: actor.userId } });
        await db.aiServiceDeletionAudit.deleteMany({ where: { id: { in: oldAuditIds }, actorId: actor.userId } });
        // Singleton restoration is the only baseline write: never delete a
        // pre-existing Config or RetentionJob. Restore every field, updatedAt
        // included, after the local cron fixture temporarily changes them.
        if (configTouched && configBaseline) {
            const { environment, ...data } = configBaseline;
            await db.aiServiceConfig.update({ where: { environment }, data });
        } else if (createdConfig) {
            await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW", updatedById: actor.userId } });
        }
        if (retentionTouched && retentionBaseline) {
            const { environment, ...data } = retentionBaseline;
            await db.aiServiceRetentionJob.update({ where: { environment }, data });
        } else if (retentionTouched && retentionBaseline === null) {
            await db.aiServiceRetentionJob.deleteMany({ where: { environment: "PREVIEW" } });
        }
        if (configBaseline !== undefined) expect(await db.aiServiceConfig.findUnique({ where: { environment: "PREVIEW" } })).toEqual(configBaseline);
        if (retentionBaseline !== undefined) expect(await db.aiServiceRetentionJob.findUnique({ where: { environment: "PREVIEW" } })).toEqual(retentionBaseline);
        // Fresh audits and the zero-valued owned budget are append-only and
        // intentionally remain with this unique synthetic actor/id, as in
        // the existing isolated suites. Never disable their guard triggers.
    } finally {
        await db.$disconnect();
    }
});

describe.sequential("manual diagnostic retention on isolated PostgreSQL 55435", () => {
    it("previews then purges five eligible rows, preserving neighbours and exposing all three readState fields", async () => {
        await seedDiag(5);
        const [fresh] = await seedDiag(1, new Date(now.getTime() - 1));
        const [other] = await seedDiag(1, cutoff, "PRODUCTION");
        const before = await neighbours();
        const preview = await countEligibleSkillDiag(db, "PREVIEW", now);
        expect(preview).toBe(5);
        const purgeUuid = randomUUID();
        const result = await purgeSkillDiagManual(db, "PREVIEW", actor, now, purgeUuid);
        expect(result).toEqual({ diagDeleted: 5, beforeEligible: 5, afterEligible: 0, auditWritten: true, auditId: expect.any(String) });
        if (!("auditId" in result) || !result.auditId) throw new Error("EXPECTED_PURGE_AUDIT");
        firstAuditId = result.auditId;
        expect(await ownDiagRows()).toEqual(expect.arrayContaining([
            expect.objectContaining({ correlationId: fresh, environment: "PREVIEW" }),
            expect.objectContaining({ correlationId: other, environment: "PRODUCTION" }),
        ]));
        expect(await ownDiagRows()).toHaveLength(2);
        const audits = await ownAudits();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            id: result.auditId, environment: "PREVIEW", kind: "DIAG_PURGE", requestId: `diag-purge:${purgeUuid}`,
            actorId: actor.userId, reasonCode: "ADMIN_REVIEW", scope: "BULK",
        });
        expect(audits[0].requestId).toMatch(/^diag-purge:[0-9a-f-]{36}$/);
        const state = await readState(db, "PREVIEW", actor, now);
        const rows = await db.aiServiceSkillDiag.findMany({ where: { environment: "PREVIEW" }, orderBy: { emittedAt: "asc" } });
        expect(state.monitoring).toMatchObject({ diagTotalCount: rows.length, diagEligibleCount: 0, diagOldestEmittedAt: rows[0]?.emittedAt ?? null });
        expect(await neighbours()).toEqual(before);
    });

    it("purges the full 205-row batch loop and writes one audit without touching neighbours", async () => {
        await seedDiag(205);
        const before = await neighbours();
        const auditsBefore = await ownAudits();
        expect(await purgeSkillDiagManual(db, "PREVIEW", actor, now, randomUUID())).toEqual({
            diagDeleted: 205, beforeEligible: 205, afterEligible: 0, auditWritten: true, auditId: expect.any(String),
        });
        expect(await countEligibleSkillDiag(db, "PREVIEW", now)).toBe(0);
        expect(await ownDiagRows()).toHaveLength(0);
        expect(await ownAudits()).toHaveLength(auditsBefore.length + 1);
        expect(await neighbours()).toEqual(before);
    });

    it("deletes the TIMESTAMP(3) cutoff millisecond inclusively and preserves cutoff plus one millisecond", async () => {
        expect(cutoff.toISOString()).toBe("2001-01-01T00:00:00.123Z");
        const justInside = new Date(cutoff.getTime() + 1);
        expect(justInside.toISOString()).toBe("2001-01-01T00:00:00.124Z");
        const [boundary] = await seedDiag(1, cutoff);
        const [kept] = await seedDiag(1, justInside);
        expect(await countEligibleSkillDiag(db, "PREVIEW", now)).toBe(1);
        expect(await purgeSkillDiagManual(db, "PREVIEW", actor, now, randomUUID())).toMatchObject({ diagDeleted: 1, afterEligible: 0 });
        expect(await db.aiServiceSkillDiag.findUnique({ where: { correlationId: boundary } })).toBeNull();
        expect(await db.aiServiceSkillDiag.findUnique({ where: { correlationId: kept } })).toMatchObject({ emittedAt: justInside });
    });

    it("retains the fresh DIAG_PURGE audit under UPDATE/DELETE guards and permits its 366-day-old counterpart to expire", async () => {
        expect(firstAuditId).not.toBeNull();
        const fresh = await db.aiServiceDeletionAudit.findUniqueOrThrow({ where: { id: firstAuditId! } });
        await expect(db.aiServiceDeletionAudit.update({ where: { id: fresh.id }, data: { scope: "SINGLE" } })).rejects.toThrow("AI_SERVICE_DELETION_AUDIT_APPEND_ONLY");
        await expect(db.aiServiceDeletionAudit.delete({ where: { id: fresh.id } })).rejects.toThrow("AI_SERVICE_DELETION_AUDIT_RETAINED");
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: fresh.id } })).toEqual(fresh);
        const auditCutoff = new Date(now.getTime() - 365 * 86400000);
        expect(await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW", createdAt: { lte: auditCutoff } } })).toBe(0);
        const old = await db.aiServiceDeletionAudit.create({ data: {
            environment: "PREVIEW", kind: "DIAG_PURGE", requestId: `diag-purge:${randomUUID()}`, actorId: actor.userId,
            reasonCode: "ADMIN_REVIEW", scope: "BULK", createdAt: new Date(now.getTime() - 366 * 86400000),
        } });
        oldAuditIds.push(old.id);
        expect(await purgeOldAudits(db, "PREVIEW", now)).toEqual({ auditDeleted: 1 });
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: old.id } })).toBeNull();
        expect(await db.aiServiceDeletionAudit.findUnique({ where: { id: fresh.id } })).toEqual(fresh);
    });

    it("CHECK accepts DIAG_PURGE and still rejects an unknown kind without writing a row", async () => {
        const accepted = await db.aiServiceDeletionAudit.create({ data: {
            environment: "PREVIEW", kind: "DIAG_PURGE", requestId: `diag-purge:${randomUUID()}`, actorId: actor.userId, reasonCode: "ADMIN_REVIEW", scope: "BULK",
        } });
        expect(accepted.kind).toBe("DIAG_PURGE");
        const before = await db.aiServiceDeletionAudit.findMany({ orderBy: { seq: "asc" } });
        await expect(db.aiServiceDeletionAudit.create({ data: {
            environment: "PREVIEW", kind: "NOPE", requestId: `diag-purge:${randomUUID()}`, actorId: actor.userId, reasonCode: "ADMIN_REVIEW", scope: "BULK",
        } })).rejects.toThrow("ai_service_deletion_audit_values");
        expect(await db.aiServiceDeletionAudit.findMany({ orderBy: { seq: "asc" } })).toEqual(before);
    });

    it("local cron fixture purges diagnostics only when enabled and keeps its exact four-key body", async () => {
        // Refuse to run an environment-wide cron if it could purge/recover any
        // pre-existing business fixture at this historical clock.
        expect(await db.aiServiceRequest.count({ where: { environment: "PREVIEW", OR: [{ expiresAt: { lte: now } }, { status: "PROCESSING", attemptDeadline: { lte: now } }] } })).toBe(0);
        expect(await db.aiServiceQuotaBucket.count({ where: { environment: "PREVIEW", expiresAt: { lte: now } } })).toBe(0);
        expect(await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW", createdAt: { lte: new Date(now.getTime() - 365 * 86400000) } } })).toBe(0);
        await seedDiag(3);
        configTouched = true;
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { schedulerEnabled: true } });
        // Use an owned temporary job state, restoring an existing singleton in
        // afterAll. A previous suite's retry schedule must not gate this case.
        retentionTouched = true;
        await db.aiServiceRetentionJob.upsert({ where: { environment: "PREVIEW" },
            create: { environment: "PREVIEW" }, update: { status: "IDLE", attempts: 0, nextRetryAt: null, errorCode: null } });
        const auditsBefore = await ownAudits();
        const beforeActive = await neighbours();
        expect(await runRetentionCron(db, `Bearer ${cronSecret}`, "preview", cronSecret, now)).toEqual({
            status: 200, body: { deleted: 0, auditDeleted: 0, waiting: false, expiredRemaining: 0 },
        });
        expect(await ownDiagRows()).toHaveLength(0);
        expect(await ownAudits()).toEqual(auditsBefore); // Cron emits no DIAG_PURGE audit.
        const afterActive = await neighbours();
        // Cron updates its RetentionJob metadata; every business neighbour,
        // including Config and budget versions, must otherwise be identical.
        expect(afterActive).toEqual({ ...beforeActive, retention: afterActive.retention });
        await seedDiag(2);
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { schedulerEnabled: false } });
        const before = await neighbours();
        const diagBefore = await ownDiagRows();
        expect(await runRetentionCron(db, `Bearer ${cronSecret}`, "preview", cronSecret, now)).toEqual({ status: 503, body: { error: "AI_RETENTION_NOT_ACTIVE" } });
        expect(await ownDiagRows()).toEqual(diagBefore);
        expect(await neighbours()).toEqual(before);
    });

    it("refuses a non-PREVIEW environment and a SUPER_ADMIN role with no deletions", async () => {
        await seedDiag(2);
        await seedDiag(1, cutoff, "PRODUCTION");
        const before = await neighbours();
        const diagBefore = await ownDiagRows();
        const auditsBefore = await ownAudits();
        expect(await purgeSkillDiagManual(db, "PRODUCTION", actor, now, randomUUID())).toEqual({ formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible: 0, auditWritten: false });
        expect(await purgeSkillDiagManual(db, "PREVIEW", { ...actor, role: "SUPER_ADMIN" }, now, randomUUID())).toEqual({ formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible: 2, auditWritten: false });
        expect(await ownDiagRows()).toEqual(diagBefore);
        expect(await ownAudits()).toEqual(auditsBefore);
        expect(await neighbours()).toEqual(before);
    });

    it("concurrent real-PG purges delete 150 combined and audit each returned non-empty run (R-2)", async () => {
        await seedDiag(150);
        const auditsBefore = await ownAudits();
        const before = await neighbours();
        const uuids = [randomUUID(), randomUUID()];
        const results = await Promise.all(uuids.map(uuid => purgeSkillDiagManual(db, "PREVIEW", actor, now, uuid)));
        for (const result of results) expect(result).not.toHaveProperty("formError");
        const successes = results.map(result => {
            if (!("diagDeleted" in result)) throw new Error("EXPECTED_CONCURRENT_PURGE_SUCCESS");
            return result;
        });
        expect(successes.reduce((total, result) => total + result.diagDeleted, 0)).toBe(150);
        const nonEmpty = successes.filter(result => result.diagDeleted > 0);
        expect(await ownAudits()).toHaveLength(auditsBefore.length + nonEmpty.length);
        for (const [index, result] of successes.entries()) {
            expect(result.auditWritten).toBe(result.diagDeleted > 0);
            if (result.diagDeleted > 0) {
                expect((await ownAudits()).find(row => row.id === result.auditId)).toMatchObject({ requestId: `diag-purge:${uuids[index]}`, kind: "DIAG_PURGE" });
            } else expect(result.auditId).toBeNull();
        }
        expect(await countEligibleSkillDiag(db, "PREVIEW", now)).toBe(0);
        expect(await ownDiagRows()).toHaveLength(0);
        expect(await neighbours()).toEqual(before);
    });

    it("refuses 1001 eligible rows at the real-PG wrapper boundary without deleting or auditing", async () => {
        await seedDiag(1001);
        const before = await neighbours();
        const diagBefore = await ownDiagRows();
        const auditsBefore = await ownAudits();
        expect(await purgeSkillDiagManual(db, "PREVIEW", actor, now, randomUUID())).toEqual({ formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible: 1001, auditWritten: false });
        expect(await ownDiagRows()).toEqual(diagBefore);
        expect(await ownAudits()).toEqual(auditsBefore);
        expect(await neighbours()).toEqual(before);
    });

    it.each([
        ["missing secret", `Bearer ${cronSecret}`, undefined],
        ["wrong secret", "Bearer synthetic-wrong-secret", cronSecret],
        ["missing authorization", null, cronSecret],
    ])("cron refuses %s with 401 and leaves diagnostic and neighbour rows untouched", async (_label, authorization, secret) => {
        void _label;
        await seedDiag(2);
        const before = await neighbours();
        const diagBefore = await ownDiagRows();
        const auditsBefore = await ownAudits();
        expect(await runRetentionCron(db, authorization, "preview", secret, now)).toEqual({ status: 401, body: { error: "AI_RETENTION_UNAUTHORIZED" } });
        expect(await ownDiagRows()).toEqual(diagBefore);
        expect(await ownAudits()).toEqual(auditsBefore);
        expect(await neighbours()).toEqual(before);
    });

    it("keeps the golden fixture bytes equal to skillReply without duplicating the live route test", () => {
        expect(readFileSync("tests/fixtures/ai-service/skill-503-golden-body.json", "utf8")).toBe(JSON.stringify(skillReply()));
    });
    // Staleness belongs to executeSkillDiagPurgeAction's unit suite; this
    // wrapper-level suite deliberately does not re-implement that action.
});
