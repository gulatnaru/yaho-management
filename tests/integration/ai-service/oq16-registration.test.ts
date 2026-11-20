import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { saveApprovedGuidance, readApprovedGuidanceState } from "@/server/ai-service/guidance-admin";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { createTools, groundedReply } from "@/server/ai-service/tools";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL }, { additionalPorts: ["55435"] });

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
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["PREPARATION", "RAIN", "POLICY"] } } });
});

afterAll(async () => {
    await db.aiServiceKnowledgeEntry.upsert({
        where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
        update: { content: syntheticGuidance, approved: true },
        create: { environment: "PREVIEW", topic: "PREPARATION", content: syntheticGuidance, approved: true, updatedById: "synthetic-admin" },
    });
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["RAIN", "POLICY"] } } });
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

    it("rejects a TEACHER actor without changing rows or audit", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(rowBefore).not.toBeNull();
        await expect(saveApprovedGuidance(db, "PREVIEW", { userId: "synthetic-teacher", role: "TEACHER", active: true },
            { topic: "PREPARATION", content: prep, expectedVersion: 1 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rowBefore!.content });
    });

    it("rejects an inactive ADMIN actor without changing rows or audit", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(rowBefore).not.toBeNull();
        await expect(saveApprovedGuidance(db, "PREVIEW", { userId: "synthetic-admin", role: "ADMIN", active: false },
            { topic: "PREPARATION", content: prep, expectedVersion: 1 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rowBefore!.content });
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

    it("CHECK constraint accepts POLICY and rejects an invalid guidance audit topic", async () => {
        const audit = await db.aiServiceGuidanceAudit.create({ data: { environment: "PREVIEW", topic: "POLICY", version: 1,
            contentSha256: "0".repeat(64), actorId: "synthetic-admin" } });
        expect(audit.topic).toBe("POLICY");
        await expect(db.aiServiceGuidanceAudit.create({ data: { environment: "PREVIEW", topic: "INVALID", version: 1,
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

    it("(e) accepts CRLF and lone-CR submissions on real PostgreSQL (D-13)", async () => {
        const before = await guidanceAuditCount();
        const rainRow = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rainRow).not.toBeNull();
        const savedRain = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: rain.replace(/\n/g, "\r\n"), expectedVersion: rainRow!.version }, approvedRegistry);
        expect(savedRain.content).toBe(rain);
        expect(await guidanceAuditCount()).toBe(before + 1);
        const rainAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(sha256(rainAfter!.content)).toBe(approvedRegistry.entries.RAIN.sha256);
        const prepRow = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(prepRow).not.toBeNull();
        const savedPrep = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "PREPARATION", content: prep.replace(/\n/g, "\r"), expectedVersion: prepRow!.version }, approvedRegistry);
        expect(savedPrep.content).toBe(prep);
        expect(await guidanceAuditCount()).toBe(before + 2);
        const prepAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } } });
        expect(sha256(prepAfter!.content)).toBe(approvedRegistry.entries.PREPARATION.sha256);
    });

    it("(f) still rejects a non-newline byte change with CRLF newlines (D-13 negative control)", async () => {
        const before = await guidanceAuditCount();
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowBefore).not.toBeNull();
        const tampered = rain.replace(/\n/g, "\r\n").replace("2시간", "3시간");
        await expect(saveApprovedGuidance(db, "PREVIEW", admin, { topic: "RAIN", content: tampered, expectedVersion: rowBefore!.version }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(before);
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rain });
    });
});


describe.sequential("POLICY approved guidance", () => {
    it("registers, retrieves and formats the approved bytes", async () => {
        const content = readFileSync(new URL("../../fixtures/approved-guidance-v1/policy-v1.txt", import.meta.url), "utf8");
        const saved = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "POLICY", content, expectedVersion: 0 });
        expect(saved.content).toBe(content);
        const result = await createTools(db, "PREVIEW").execute({ name: "get_approved_guidance", args: { topic: "POLICY" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content });
        expect(groundedReply(result)).toBe(content);
    });
    it("denies a directly inserted mimic row", async () => {
        const rowBefore = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } } });
        expect(rowBefore).not.toBeNull();
        let caught: unknown;
        try {
            await db.aiServiceKnowledgeEntry.update({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } }, data: { content: "수업 전날 오후 6시까지 신청할 수 있습니다.", approved: true } });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
        expect((caught as Error).message).toContain("23514");
        expect((caught as Error).message).toContain("ai_service_knowledge_entry_policy_content");
        const rowAfter = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } } });
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: rowBefore!.content });
        const result = await createTools(db, "PREVIEW").execute({ name: "get_approved_guidance", args: { topic: "POLICY" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content: rowBefore!.content });
        expect(groundedReply(result)).toBe(rowBefore!.content);
    });
});

describe.sequential("H-4 approved guidance full path on real PostgreSQL (isolated DB 55435)", () => {
    it("returns the POLICY v1 bytes through get_approved_guidance and groundedReply", async () => {
        const content = readFileSync(new URL("../../fixtures/approved-guidance-v1/policy-v1.txt", import.meta.url), "utf8");
        const row = await db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } } });
        expect(row).not.toBeNull();
        expect(row!.content).toBe(content);
        expect(sha256(row!.content)).toBe(approvedRegistry.entries.POLICY.sha256);
        const result = await createTools(db, "PREVIEW").execute({ name: "get_approved_guidance", args: { topic: "POLICY" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content });
        expect(groundedReply(result)).toBe(content);
    });
    it("returns the PREPARATION and RAIN v1 bytes through get_approved_guidance", async () => {
        for (const [topic, content] of [["PREPARATION", prep], ["RAIN", rain]] as const) {
            const result = await createTools(db, "PREVIEW").execute({ name: "get_approved_guidance", args: { topic } }, signal());
            expect(result).toEqual({ kind: "GUIDANCE", content });
            expect(groundedReply(result)).toBe(content);
        }
    });
    it("reads the registration state with matching content hashes for all three topics", async () => {
        const state = await readApprovedGuidanceState(db, "PREVIEW", admin);
        expect(state).toHaveLength(3);
        for (const topic of ["PREPARATION", "RAIN", "POLICY"] as const) {
            expect(state.find((entry) => entry.topic === topic)).toMatchObject({ approved: true, contentSha256: approvedRegistry.entries[topic].sha256 });
        }
    });
});
