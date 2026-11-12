import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { saveApprovedGuidance, readApprovedGuidanceState } from "@/server/ai-service/guidance-admin";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { createTools } from "@/server/ai-service/tools";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

const db = new PrismaClient();
const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const prep = readFileSync(new URL("../../fixtures/approved-guidance-v1/preparation-v1.txt", import.meta.url), "utf8");
const rain = readFileSync(new URL("../../fixtures/approved-guidance-v1/rain-v1.txt", import.meta.url), "utf8");
const syntheticGuidance = "합성 준비물은 모자입니다.";
const signal = () => new AbortController().signal;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function guidanceAuditCount() {
    return db.aiServiceGuidanceAudit.count({ where: { environment: "PREVIEW" } });
}

beforeAll(async () => {
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["PREPARATION", "RAIN"] } } });
});

afterAll(async () => {
    // Restore the standing state of this throwaway cluster (oq12-p0 seeds the
    // synthetic PREPARATION row; no RAIN row existed before this file ran).
    // Guidance audit rows are append-only by the guard trigger and stay as
    // documented residue, like the AiServiceDeletionAudit rows before them.
    await db.aiServiceKnowledgeEntry.upsert({
        where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
        update: { content: syntheticGuidance, approved: true },
        create: { environment: "PREVIEW", topic: "PREPARATION", content: syntheticGuidance, approved: true, updatedById: "synthetic-admin" },
    });
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: "RAIN" } });
    await db.$disconnect();
});

describe.sequential("OQ-16 registration on real PostgreSQL (isolated DB 55435)", () => {
    it("registers PREPARATION v1 with one audit row", async () => {
        const before = await guidanceAuditCount();
        const saved = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry);
        expect(saved.content).toBe(prep);
        expect(saved.approved).toBe(true);
        expect(saved.version).toBe(1);
        expect(await guidanceAuditCount()).toBe(before + 1);
        const audit = await db.aiServiceGuidanceAudit.findFirst({ where: { environment: "PREVIEW", topic: "PREPARATION" }, orderBy: { createdAt: "desc" } });
        expect(audit).toMatchObject({ topic: "PREPARATION", version: 1, contentSha256: approvedRegistry.entries.PREPARATION.sha256, actorId: "synthetic-admin" });
        const row = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(row).not.toBeNull();
        expect(sha256(row!.content)).toBe(approvedRegistry.entries.PREPARATION.sha256);
    });

    it("registers RAIN v1 with one audit row", async () => {
        const before = await guidanceAuditCount();
        const saved = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: 0 }, approvedRegistry);
        expect(saved.content).toBe(rain);
        expect(saved.approved).toBe(true);
        expect(await guidanceAuditCount()).toBe(before + 1);
    });

    it("rejects a hash mismatch without changing rows or audit", async () => {
        const before = await guidanceAuditCount();
        const tampered = rain.replace("2시간", "3시간");
        await expect(saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: tampered, expectedVersion: 1 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const row = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(row!.content).toBe(rain);
        expect(row!.version).toBe(1);
    });

    it("rejects a non-ADMIN actor without changing rows or audit", async () => {
        const before = await guidanceAuditCount();
        await expect(saveApprovedGuidance(db, "PREVIEW", { userId: "synthetic-staff", role: "STAFF", active: true },
            { topic: "PREPARATION", content: prep, expectedVersion: 1 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
    });

    it("returns the RAIN v1 text verbatim through get_approved_guidance", async () => {
        const tools = createTools(db, "PREVIEW");
        const result = await tools.execute({ name: "get_approved_guidance", args: { topic: "RAIN" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content: rain });
    });

    it("reads the registration state with matching content hashes", async () => {
        const state = await readApprovedGuidanceState(db, "PREVIEW", admin);
        expect(state).toHaveLength(2);
        expect(state.find((row) => row.topic === "PREPARATION")).toMatchObject({ version: 1, approved: true, contentSha256: approvedRegistry.entries.PREPARATION.sha256 });
        expect(state.find((row) => row.topic === "RAIN")).toMatchObject({ version: 1, approved: true, contentSha256: approvedRegistry.entries.RAIN.sha256 });
    });

    it("guard trigger blocks UPDATE and in-window DELETE of guidance audit rows", async () => {
        const fresh = await db.aiServiceGuidanceAudit.findFirst({ where: { environment: "PREVIEW", topic: "PREPARATION" }, orderBy: { createdAt: "desc" } });
        expect(fresh).not.toBeNull();
        await expect(db.aiServiceGuidanceAudit.update({ where: { id: fresh!.id }, data: { topic: "RAIN" } })).rejects.toThrow();
        await expect(db.aiServiceGuidanceAudit.delete({ where: { id: fresh!.id } })).rejects.toThrow();
        expect(await db.aiServiceGuidanceAudit.findUnique({ where: { id: fresh!.id } })).not.toBeNull();
    });

    it("CHECK constraint rejects an invalid guidance audit topic", async () => {
        await expect(db.aiServiceGuidanceAudit.create({ data: { environment: "PREVIEW", topic: "POLICY", version: 1,
            contentSha256: "0".repeat(64), actorId: "synthetic-admin" } })).rejects.toThrow();
    });

    it("rejects a version conflict without an audit row", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowBefore).not.toBeNull();
        await expect(saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: 99 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rain });
    });

    it("rejects a duplicate submission with a stale expectedVersion", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowBefore).not.toBeNull();
        expect(rowBefore!.version).toBeGreaterThan(0);
        await expect(saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: rowBefore!.version - 1 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rain });
    });

    it("admits exactly one of two concurrent submissions", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowBefore).not.toBeNull();
        const current = rowBefore!.version;
        const attempt = () => saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: current }, approvedRegistry);
        const results = await Promise.allSettled([attempt(), attempt()]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
        expect(((rejected[0] as PromiseRejectedResult).reason as Error).message).toContain("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before + 1);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowAfter).toMatchObject({ version: current + 1, content: rain });
    });

    it("rolls back the guidance row when the audit write fails", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowBefore).not.toBeNull();
        // Sabotage the audit INSERT on this throwaway cluster only: a
        // trigger that rejects every audit row, so the wrapper's audit
        // create fails inside the same transaction as the guidance upsert.
        await db.$executeRaw`DROP TRIGGER IF EXISTS _oq16_fail_audit ON "AiServiceGuidanceAudit"`;
        await db.$executeRaw`CREATE OR REPLACE FUNCTION public._oq16_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_AUDIT_FAILURE'; END $$`;
        await db.$executeRaw`CREATE TRIGGER _oq16_fail_audit BEFORE INSERT ON "AiServiceGuidanceAudit" FOR EACH ROW EXECUTE FUNCTION public._oq16_fail_audit()`;
        try {
            await expect(saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: rowBefore!.version }, approvedRegistry))
                .rejects.toThrow("AI_SERVICE_DENIED");
            expect(await guidanceAuditCount()).toBe(before);
            const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
            expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rain });
        } finally {
            await db.$executeRaw`DROP TRIGGER IF EXISTS _oq16_fail_audit ON "AiServiceGuidanceAudit"`;
            await db.$executeRaw`DROP FUNCTION IF EXISTS public._oq16_fail_audit()`;
        }
    });
});
