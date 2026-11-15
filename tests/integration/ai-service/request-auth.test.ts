import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authenticateSkillContext } from "@/server/ai-service/transport";
import { hashes, hmacPins } from "@/server/ai-service/crypto";
import { claim, markDispatched, reconcileMonth, settle } from "@/server/ai-service/ledger";
import type { Database } from "@/server/ai-service/repository";
import { pauseService, readState } from "@/server/ai-service/admin";
import { purgeExpired } from "@/server/ai-service/retention";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const now = new Date("2026-10-15T00:00:00Z");
const keys = { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" };
const secrets = { prod: "synthetic-integration-prod-secret-0123456789abcdef", test: "synthetic-integration-test-secret-0123456789abcdef" };
const run = randomUUID();
const context = (kind: "prod" | "test", supplied = secrets[kind]) => authenticateSkillContext(new Headers({ "x-yaho-skill-key": supplied }), secrets, "PREVIEW");
const input = (id: string, kind: "prod" | "test", payload = "synthetic utterance") => ({
    environment: "PREVIEW" as const, now, authContext: context(kind), hmacPins: hmacPins(keys, "PREVIEW"),
    requestHashes: hashes(keys, "request", "PREVIEW", `${run}-${id}`),
    payloadHashes: hashes(keys, "payload", "PREVIEW", payload),
    subjectHashes: hashes(keys, "subject", "PREVIEW", `synthetic-subject-${run}-${id}`),
});
const finish = async (result: Awaited<ReturnType<typeof claim>>) => {
    if (result.kind === "CLAIMED") await settle(db, "PREVIEW", result.row.id, result.row.attempt, { kind: "UNDISPATCHED" }, now);
};
const config = { paused: false, schedulerEnabled: false, provider: "TEST_DOUBLE", model: "gpt-6-luna", priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", updatedById: "synthetic-auth-test" };
const ownedIds: string[] = [];
beforeAll(async () => {
    await db.aiServiceConfig.upsert({ where: { environment: "PREVIEW" }, update: config, create: { environment: "PREVIEW", ...config } });
});
afterAll(async () => {
    for (const id of ownedIds) {
        const row = await db.aiServiceRequest.findUnique({ where: { id } });
        if (row?.status === "PROCESSING") await settle(db, "PREVIEW", id, row.attempt, { kind: "UNDISPATCHED" }, now);
    }
    await db.aiServiceRequest.deleteMany({ where: { id: { in: ownedIds } } });
    await db.aiServiceConfig.updateMany({ where: { environment: "PREVIEW" }, data: { paused: true, schedulerEnabled: false } });
    await db.$disconnect();
});

async function claimOwned(i: ReturnType<typeof input>) {
    const result = await claim(db, i);
    if (result.kind === "CLAIMED") ownedIds.push(result.row.id);
    return result;
}

describe.sequential("Q-C2 authenticated claim (owned isolated PostgreSQL)", () => {
    it.each(["test", "prod"] as const)("atomically records %s only on the request and leaves no auth audit", async kind => {
        const auditsBefore = await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW" } });
        const result = await claimOwned(input(`new-${kind}`, kind));
        expect(result.kind).toBe("CLAIMED");
        if (result.kind !== "CLAIMED") throw new Error("claim missing");
        const stored = await db.aiServiceRequest.findUniqueOrThrow({ where: { id: result.row.id } });
        expect(stored.authKind).toBe(kind);
        expect(await db.aiServiceDeletionAudit.count({ where: { environment: "PREVIEW" } })).toBe(auditsBefore);
        expect(await db.aiServiceDeletionAudit.count({ where: { kind: { in: ["REQUEST_AUTH", "SKILL_AUTH"] } } })).toBe(0);
        const serialized = JSON.stringify(stored);
        const forbidden = [secrets.prod, secrets.test, ...Object.values(secrets).map(v => createHash("sha256").update(v).digest("hex"))];
        expect(forbidden.some(value => serialized.includes(value))).toBe(false);
        await finish(result);
    });
    it("rolls back reservation and request creation when the request insert fails", async () => {
        const i = input("rollback", "test");
        const beforeBudget = await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-10" } } });
        const beforeQuota = await db.aiServiceQuotaBucket.findMany({ where: { environment: "PREVIEW" }, orderBy: { id: "asc" } });
        const failingDb = db.$extends({ query: { aiServiceRequest: { async create() { throw new Error("synthetic insertion failure"); } } } });
        await expect(claim(failingDb as unknown as Database, i)).rejects.toThrow();
        expect(await db.aiServiceRequest.count({ where: { environment: "PREVIEW", requestHashes: { hasSome: i.requestHashes } } })).toBe(0);
        expect(await db.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment: "PREVIEW", month: "2026-10" } } })).toEqual(beforeBudget);
        expect(await db.aiServiceQuotaBucket.findMany({ where: { environment: "PREVIEW" }, orderBy: { id: "asc" } })).toEqual(beforeQuota);
    });
    it("returns duplicate for the same authenticated kind without creating or changing a row", async () => {
        const i = input("same", "test");
        const first = await claimOwned(i);
        expect(first.kind).toBe("CLAIMED");
        await finish(first);
        const retry = await claim(db, i);
        expect(retry.kind).toBe("DUPLICATE");
        expect(await db.aiServiceRequest.count({ where: { environment: "PREVIEW", requestHashes: { hasSome: i.requestHashes } } })).toBe(1);
    });
    it.each([["test", "prod"], ["prod", "test"]] as const)("rejects %s to %s retries without overwriting the original", async (firstKind, secondKind) => {
        const id = `cross-${firstKind}`;
        const first = await claimOwned(input(id, firstKind));
        expect(first.kind).toBe("CLAIMED");
        await finish(first);
        await expect(claim(db, input(id, secondKind))).rejects.toThrow();
        if (first.kind !== "CLAIMED") throw new Error("claim missing");
        expect((await db.aiServiceRequest.findUniqueOrThrow({ where: { id: first.row.id } })).authKind).toBe(firstKind);
    });
    it("rejects a historical null authentication kind and does not fill it", async () => {
        const i = input("null", "test");
        const first = await claimOwned(i);
        expect(first.kind).toBe("CLAIMED");
        await finish(first);
        if (first.kind !== "CLAIMED") throw new Error("claim missing");
        await db.aiServiceRequest.update({ where: { id: first.row.id }, data: { authKind: null } });
        await expect(claim(db, i)).rejects.toThrow();
        expect((await db.aiServiceRequest.findUniqueOrThrow({ where: { id: first.row.id } })).authKind).toBeNull();
    });
    it("retains deduplication across test-secret rotation with the same HMAC versions", async () => {
        const i = input("rotation", "test");
        const first = await claimOwned(i);
        expect(first.kind).toBe("CLAIMED");
        await finish(first);
        const rotatedSecret = "synthetic-rotated-test-secret-0123456789abcdef";
        const rotated = authenticateSkillContext(new Headers({ "x-yaho-skill-key": rotatedSecret }), { prod: secrets.prod, test: rotatedSecret }, "PREVIEW");
        expect((await claim(db, { ...i, authContext: rotated })).kind).toBe("DUPLICATE");
    });
    it("rejects a changed payload under the same identity", async () => {
        const first = await claimOwned(input("conflict", "test"));
        await finish(first);
        await expect(claim(db, input("conflict", "test", "different synthetic utterance"))).rejects.toThrow();
    });
    it("allows at most one concurrent claim for the same key", async () => {
        const i = input("concurrent", "test");
        const attempts = await Promise.allSettled([claim(db, i), claim(db, i)]);
        const claimed = attempts.flatMap(r => r.status === "fulfilled" && r.value.kind === "CLAIMED" ? [r.value] : []);
        expect(claimed).toHaveLength(1);
        ownedIds.push(claimed[0].row.id);
        expect(await db.aiServiceRequest.count({ where: { environment: "PREVIEW", requestHashes: { hasSome: i.requestHashes } } })).toBe(1);
        await finish(claimed[0]);
    });
    it("D10: UNKNOWN blocks, pause persists, purge keeps the hold, and reconciliation clears it", async () => {
        const actor = { userId: "synthetic-recovery-admin", role: "ADMIN", active: true };
        const first = await claimOwned(input("unknown", "test"));
        expect(first.kind).toBe("CLAIMED");
        if (first.kind !== "CLAIMED") throw new Error("claim missing");
        const month = first.row.month;
        let unknown = false;
        try {
            await markDispatched(db, "PREVIEW", first.row.id, first.row.attempt, now);
            await settle(db, "PREVIEW", first.row.id, first.row.attempt, { kind: "UNKNOWN" }, now);
            unknown = true;
            await expect(claim(db, input("blocked-unknown", "test"))).rejects.toThrow();
            const configBefore = await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } });
            await pauseService(db, "PREVIEW", actor, { expectedVersion: configBefore.version });
            const budgetBefore = await db.aiServiceBudgetMonth.findUniqueOrThrow({ where: { environment_month: { environment: "PREVIEW", month } } });
            expect(budgetBefore.unknownCount).toBeGreaterThan(0);
            expect(budgetBefore.reservedKrw).toBeGreaterThan(0);
            const future = new Date(first.row.expiresAt.getTime() + 1);
            const state = await readState(db, "PREVIEW", actor, future);
            expect(state.consultations.some(row => row.id === first.row.id)).toBe(false);
            await purgeExpired(db, "PREVIEW", future);
            expect(await db.aiServiceRequest.findUnique({ where: { id: first.row.id } })).toBeNull();
            const held = await db.aiServiceBudgetMonth.findUniqueOrThrow({ where: { environment_month: { environment: "PREVIEW", month } } });
            expect(held.unknownCount).toBe(budgetBefore.unknownCount);
            expect(held.reservedKrw).toBe(budgetBefore.reservedKrw);
            const result = await reconcileMonth(db, "PREVIEW", actor, { month, expectedVersion: held.version, billedKrw: held.billedKrw,
                heldActualKrw: 0, resolveAllHeld: true, reference: `invoice-${run}`, coveredThroughGeneration: held.dispatchGeneration, coverageConfirmed: true }, future);
            expect(result.kind).toBe("APPLIED");
            unknown = false;
            expect(await db.aiServiceBudgetMonth.findUniqueOrThrow({ where: { environment_month: { environment: "PREVIEW", month } } })).toMatchObject({ unknownCount: 0, reservedKrw: 0 });
            expect(await db.aiServiceConfig.findUniqueOrThrow({ where: { environment: "PREVIEW" } })).toMatchObject({ paused: true, schedulerEnabled: false });
        } finally {
            if (unknown) {
                const held = await db.aiServiceBudgetMonth.findUniqueOrThrow({ where: { environment_month: { environment: "PREVIEW", month } } });
                await reconcileMonth(db, "PREVIEW", actor, { month, expectedVersion: held.version, billedKrw: held.billedKrw, heldActualKrw: 0,
                    resolveAllHeld: true, reference: `invoice-cleanup-${run}`, coveredThroughGeneration: held.dispatchGeneration, coverageConfirmed: true }, now);
            }
            await db.aiServiceConfig.update({ where: { environment: "PREVIEW" }, data: { paused: false } });
        }
    });
    it("preserves the five-minute identity boundary and bounds each claim", async () => {
        const base = { botId: "synthetic-bot", userId: `synthetic-${run}`, blockId: "synthetic-block", utterance: "야호 준비물" };
        const left = deriveStableRequestId({ ...base, now: new Date("2026-10-15T00:04:59.999Z") });
        const right = deriveStableRequestId({ ...base, now: new Date("2026-10-15T00:05:00.000Z") });
        expect(left).not.toBe(right);
        const a = await claimOwned(input(left, "test")); await finish(a);
        const b = await claimOwned(input(right, "test")); await finish(b);
        expect(a.kind).toBe("CLAIMED"); expect(b.kind).toBe("CLAIMED");
    });
});
