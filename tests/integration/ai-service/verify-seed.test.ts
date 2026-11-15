import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readState } from "@/server/ai-service/admin";
import { verifySeedProfile } from "@/server/ai-service/seed-profile";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const actor = { userId: "p1-seed-integration", role: "ADMIN", active: true };
const now = new Date();
const fixture = { environment: "PREVIEW" as const, paused: true, schedulerEnabled: false, provider: "OPENAI", model: "gpt-6-luna", priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-source", updatedById: actor.userId };
const state = async () => (await readState(db, "PREVIEW", actor, now)).config;
beforeEach(async () => { await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW" } }); });
afterEach(async () => { await db.aiServiceConfig.deleteMany({ where: { environment: "PREVIEW", updatedById: actor.userId } }); });
afterAll(async () => { await db.$disconnect(); });
describe.sequential("seed profiles on isolated PostgreSQL", () => {
    for (const paused of [true, false]) it(`checks both profiles with paused=${paused}`, async () => {
        expect(await state()).toBeNull();
        await db.aiServiceConfig.create({ data: { ...fixture, paused } });
        const row = (await state())!;
        const safe = verifySeedProfile(row, "safe-off", now).failures;
        const preview = verifySeedProfile(row, "preview-synthetic", now).failures;
        expect(paused ? safe : preview).toEqual([]);
        expect(paused ? preview : safe).toEqual([expect.stringContaining("config.paused")]);
    });
    it("rejects stale FX for both profiles", async () => {
        await db.aiServiceConfig.create({ data: { ...fixture, fxCheckedAt: new Date(+now - 73 * 3600000) } });
        const row = (await state())!;
        for (const profile of ["safe-off", "preview-synthetic"] as const) expect(verifySeedProfile(row, profile, now).failures).toContain("config.fxCheckedAt is outside the 72h freshness window");
    });
    it("reports a missing config", async () => { expect(await state()).toBeNull(); });
});
