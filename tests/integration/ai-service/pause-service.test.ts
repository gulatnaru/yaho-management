import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { pauseService, readState, saveConfig } from "@/server/ai-service/admin";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const actor = { userId: "p1-integration-admin", role: "ADMIN", active: true };
const now = new Date();
const data = { paused: false, provider: "OPENAI", model: "gpt-6-luna", priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", schedulerEnabled: false };
const config = () => db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } });
const audits = () => db.aiServiceDeletionAudit.findMany({ where: { environment: "PREVIEW", actorId: actor.userId } });
let baselineAudits: Awaited<ReturnType<typeof audits>>;
let baselineEmergency: { createdAt: Date }[];
beforeEach(async () => {
    baselineAudits = await audits();
    baselineEmergency = await db.aiServiceDeletionAudit.findMany({ where: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE" }, select: { createdAt: true } });
    await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW" } });
    await db.aiServiceConfig.create({ data: { environment: "PREVIEW", ...data, updatedById: actor.userId, updatedAt: new Date(+now - 10000) } });
});
afterEach(async () => {
    await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW", updatedById: { in: [actor.userId, "p1-concurrent-second-admin"] } } });
});
afterAll(async () => { await db.$disconnect(); });
describe.sequential("emergency pause on isolated PostgreSQL", () => {
    it("I1 updates only pause metadata and writes the audit", async () => {
        const before = await config();
        const result = await pauseService(db, "PREVIEW", actor, { expectedVersion: 1 });
        const after = await config();
        expect(after).toEqual({ ...before, paused: true, version: 2, updatedById: actor.userId, updatedAt: after.updatedAt });
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
        expect(result).toEqual({ paused: true, version: 2, alreadyPaused: false, pausedAt: after.updatedAt });
        expect(await audits()).toHaveLength(baselineAudits.length + 1);
        expect((await audits()).find(row => !baselineAudits.some(old => old.id === row.id))).toMatchObject({ environment: "PREVIEW", kind: "EMERGENCY_PAUSE", requestId: "config:PREVIEW", actorId: actor.userId, reasonCode: "EMERGENCY_PAUSE", scope: "CONFIG" });
    });
    it("I2 pauses with stale FX while saveConfig rejects it", async () => {
        const stale = new Date(+now - 73 * 3600000);
        await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { fxCheckedAt: stale } });
        await expect(saveConfig(db, "PREVIEW", actor, { ...data, fxCheckedAt: stale, expectedVersion: 1 }, now)).rejects.toThrow("AI_SERVICE_DENIED");
        await pauseService(db, "PREVIEW", actor, { expectedVersion: 1 });
        expect(await config()).toMatchObject({ paused: true, fxCheckedAt: stale, version: 2 });
    });
    it("I3 admits exactly one of saveConfig and pause", async () => {
        const before = await config();
        const results = await Promise.allSettled([saveConfig(db, "PREVIEW", actor, { ...data, model: "other-model", expectedVersion: 1 }, now), pauseService(db, "PREVIEW", actor, { expectedVersion: 1 })]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
        expect(rejected.reason.message).toBe("AI_SERVICE_DENIED");
        const after = await config();
        const pauseWon = results[1].status === "fulfilled";
        expect(after).toEqual({ ...before, paused: pauseWon, model: pauseWon ? before.model : "other-model", version: 2, updatedById: actor.userId, updatedAt: after.updatedAt });
        expect(await audits()).toHaveLength(baselineAudits.length + (pauseWon ? 1 : 0));
    });
    it("I4 accepts both concurrent pauses with one version increment", async () => {
        const results = await Promise.all([pauseService(db, "PREVIEW", actor, { expectedVersion: 1 }), pauseService(db, "PREVIEW", actor, { expectedVersion: 1 })]);
        expect(results.map(r => r.alreadyPaused).sort()).toEqual([false, true]);
        expect(await config()).toMatchObject({ paused: true, version: 2 });
        expect(await audits()).toHaveLength(baselineAudits.length + 2);
    });
    it("reports the latest actor after a different ADMIN confirms the pause", async () => {
        const secondActor = { ...actor, userId: "p1-integration-second-admin" };
        const secondBaseline = await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE", actorId: secondActor.userId } });
        const first = await pauseService(db, "PREVIEW", actor, { expectedVersion: 1 });
        expect(first.alreadyPaused).toBe(false);
        expect((await readState(db, "PREVIEW", actor, now)).monitoring).toMatchObject({ emergencyPauseCount: baselineEmergency.length + 1, lastEmergencyPauseById: actor.userId });
        const second = await pauseService(db, "PREVIEW", secondActor, { expectedVersion: 1 });
        expect(second.alreadyPaused).toBe(true);
        expect((await readState(db, "PREVIEW", actor, now)).monitoring).toMatchObject({ emergencyPauseCount: baselineEmergency.length + 2, lastEmergencyPauseById: secondActor.userId });
        expect(await config()).toMatchObject({ updatedById: actor.userId, version: first.version });
        const rows = await db.aiServiceDeletionAudit.findMany({ where: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE" } });
        expect(rows).toHaveLength(baselineEmergency.length + 2);
        expect(await audits()).toHaveLength(baselineAudits.length + 1);
        expect(rows.filter(row => row.actorId === secondActor.userId)).toHaveLength(secondBaseline + 1);
    });
    it("reports the max-seq audit after concurrent pauses by different ADMINs", async () => {
        const secondActor = { ...actor, userId: "p1-concurrent-second-admin" };
        const before = await db.aiServiceDeletionAudit.findMany({ where: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE" }, select: { id: true } });
        const results = await Promise.all([
            pauseService(db, "PREVIEW", actor, { expectedVersion: 1 }),
            pauseService(db, "PREVIEW", secondActor, { expectedVersion: 1 }),
        ]);
        expect(results.map(result => result.alreadyPaused).sort()).toEqual([false, true]);
        const rows = await db.aiServiceDeletionAudit.findMany({ where: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE" }, orderBy: { seq: "asc" } });
        expect(rows).toHaveLength(baselineEmergency.length + 2);
        const newRows = rows.filter(row => !before.some(old => old.id === row.id));
        expect(newRows).toHaveLength(2);
        expect(newRows[0].seq < newRows[1].seq).toBe(true);
        expect(newRows.map(row => row.actorId).sort()).toEqual([actor.userId, secondActor.userId].sort());
        expect((await readState(db, "PREVIEW", actor, now)).monitoring).toMatchObject({
            emergencyPauseCount: baselineEmergency.length + 2,
            lastEmergencyPauseById: newRows[1].actorId,
            lastEmergencyPauseAt: newRows[1].createdAt,
        });
    });
    it("I5 reports the latest emergency audit", async () => {
        const latest = Math.max(+now, ...baselineEmergency.map(row => +row.createdAt));
        const timestamps = [new Date(latest + 1), new Date(latest + 2)];
        for (const createdAt of timestamps) await db.aiServiceDeletionAudit.create({ data: { environment: "PREVIEW", kind: "EMERGENCY_PAUSE", requestId: "config:PREVIEW", actorId: actor.userId, reasonCode: "EMERGENCY_PAUSE", scope: "CONFIG", createdAt } });
        expect((await readState(db, "PREVIEW", actor, now)).monitoring).toMatchObject({ emergencyPauseCount: baselineEmergency.length + 2, lastEmergencyPauseAt: timestamps[1] });
    });
});
