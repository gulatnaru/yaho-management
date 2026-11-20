import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { saveApprovedGuidance } from "@/server/ai-service/guidance-admin";
import { saveGuidanceInTransaction } from "@/server/ai-service/admin";
import { transaction } from "@/server/ai-service/repository";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL }, { additionalPorts: ["55435"] });

const db = new PrismaClient();
const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const policyV1 = readFileSync(new URL("../../fixtures/approved-guidance-v1/policy-v1.txt", import.meta.url), "utf8");
const prep = readFileSync(new URL("../../fixtures/approved-guidance-v1/preparation-v1.txt", import.meta.url), "utf8");
const rain = readFileSync(new URL("../../fixtures/approved-guidance-v1/rain-v1.txt", import.meta.url), "utf8");
const mimic = "수업 전날 오후 6시까지 신청할 수 있습니다.";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function policyRow() {
    return db.aiServiceKnowledgeEntry.findUnique({ where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } } });
}

async function guidanceAuditCount() {
    return db.aiServiceGuidanceAudit.count({ where: { environment: "PREVIEW" } });
}

beforeAll(async () => {
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["PREPARATION", "RAIN", "POLICY"] } } });
});

afterAll(async () => {
    await db.aiServiceKnowledgeEntry.upsert({
        where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
        update: { content: "합성 준비물은 모자입니다.", approved: true },
        create: { environment: "PREVIEW", topic: "PREPARATION", content: "합성 준비물은 모자입니다.", approved: true, updatedById: "synthetic-admin" },
    });
    await db.aiServiceKnowledgeEntry.deleteMany({ where: { environment: "PREVIEW", topic: { in: ["RAIN", "POLICY"] } } });
    await db.$disconnect();
});

describe.sequential("H-1 approved POLICY content CHECK on real PostgreSQL (isolated DB 55435)", () => {
    it("(a) accepts the byte-identical POLICY v1 approved row via saveApprovedGuidance and via direct upsert", async () => {
        expect(sha256(policyV1)).toBe(approvedRegistry.entries.POLICY.sha256);
        const saved = await saveApprovedGuidance(db, "PREVIEW", admin, { topic: "POLICY", content: policyV1, expectedVersion: 0 }, approvedRegistry);
        expect(saved.content).toBe(policyV1);
        expect(saved.approved).toBe(true);
        const row = await policyRow();
        expect(row).not.toBeNull();
        expect(row!.content).toBe(policyV1);
        const direct = await db.aiServiceKnowledgeEntry.upsert({
            where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } },
            update: { content: policyV1, approved: true, version: { increment: 1 } },
            create: { environment: "PREVIEW", topic: "POLICY", content: policyV1, approved: true, updatedById: "synthetic-admin" },
        });
        expect(direct.content).toBe(policyV1);
        expect(direct.approved).toBe(true);
    });

    it("(b) rejects a mimic approved upsert with the CHECK violation and rolls back the transaction", async () => {
        const rowBefore = await policyRow();
        expect(rowBefore).not.toBeNull();
        expect(rowBefore!.content).toBe(policyV1);
        const auditBefore = await guidanceAuditCount();
        let caught: unknown;
        try {
            await db.aiServiceKnowledgeEntry.upsert({
                where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } },
                update: { content: mimic, approved: true, version: { increment: 1 } },
                create: { environment: "PREVIEW", topic: "POLICY", content: mimic, approved: true, updatedById: "synthetic-admin" },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
        expect((caught as { code?: unknown }).code).toBeUndefined();
        expect((caught as Error).message).toContain("23514");
        expect((caught as Error).message).toContain("ai_service_knowledge_entry_policy_content");
        const rowAfterDirect = await policyRow();
        expect(rowAfterDirect).toMatchObject({ version: rowBefore!.version, content: policyV1, approved: true });
        await expect(transaction(db, "PREVIEW", async (tx) => {
            const saved = await saveGuidanceInTransaction(tx, "PREVIEW", admin, { topic: "POLICY", content: mimic, approved: true, expectedVersion: rowBefore!.version });
            await tx.aiServiceGuidanceAudit.create({ data: { environment: "PREVIEW", topic: "POLICY", version: saved.version, contentSha256: sha256(mimic), actorId: admin.userId } });
        })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(await guidanceAuditCount()).toBe(auditBefore);
        const rowAfterTransaction = await policyRow();
        expect(rowAfterTransaction).toMatchObject({ version: rowBefore!.version, content: policyV1, approved: true });
    });

    it("(c) accepts an unapproved POLICY mimic row", async () => {
        const rowBefore = await policyRow();
        expect(rowBefore).not.toBeNull();
        const saved = await db.aiServiceKnowledgeEntry.upsert({
            where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } },
            update: { content: mimic, approved: false, version: { increment: 1 } },
            create: { environment: "PREVIEW", topic: "POLICY", content: mimic, approved: false, updatedById: "synthetic-admin" },
        });
        expect(saved.content).toBe(mimic);
        expect(saved.approved).toBe(false);
        expect(rowBefore!.version).not.toBe(saved.version);
    });

    it("rejects the approved false-to-true transition of a mimic row", async () => {
        const rowBefore = await policyRow();
        expect(rowBefore).not.toBeNull();
        expect(rowBefore!.content).toBe(mimic);
        expect(rowBefore!.approved).toBe(false);
        let caught: unknown;
        try {
            await db.aiServiceKnowledgeEntry.update({
                where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } },
                data: { approved: true },
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
        expect((caught as { code?: unknown }).code).toBeUndefined();
        expect((caught as Error).message).toContain("23514");
        expect((caught as Error).message).toContain("ai_service_knowledge_entry_policy_content");
        const rowAfter = await policyRow();
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: mimic, approved: false });
        const restored = await db.aiServiceKnowledgeEntry.upsert({
            where: { environment_topic: { environment: "PREVIEW", topic: "POLICY" } },
            update: { content: policyV1, approved: true, version: { increment: 1 } },
            create: { environment: "PREVIEW", topic: "POLICY", content: policyV1, approved: true, updatedById: "synthetic-admin" },
        });
        expect(restored.content).toBe(policyV1);
        expect(restored.approved).toBe(true);
    });

    it("(d) accepts approved PREPARATION and RAIN rows", async () => {
        const savedPrep = await db.aiServiceKnowledgeEntry.upsert({
            where: { environment_topic: { environment: "PREVIEW", topic: "PREPARATION" } },
            update: { content: prep, approved: true, version: { increment: 1 } },
            create: { environment: "PREVIEW", topic: "PREPARATION", content: prep, approved: true, updatedById: "synthetic-admin" },
        });
        expect(savedPrep.content).toBe(prep);
        expect(savedPrep.approved).toBe(true);
        const savedRain = await db.aiServiceKnowledgeEntry.upsert({
            where: { environment_topic: { environment: "PREVIEW", topic: "RAIN" } },
            update: { content: rain, approved: true, version: { increment: 1 } },
            create: { environment: "PREVIEW", topic: "RAIN", content: rain, approved: true, updatedById: "synthetic-admin" },
        });
        expect(savedRain.content).toBe(rain);
        expect(savedRain.approved).toBe(true);
    });

    it("(e) rejects a raw UPDATE of an approved POLICY row to a mimic with Postgres 23514", async () => {
        const rowBefore = await policyRow();
        expect(rowBefore).not.toBeNull();
        expect(rowBefore!.content).toBe(policyV1);
        expect(rowBefore!.approved).toBe(true);
        let caught: unknown;
        try {
            await db.$executeRaw`UPDATE "AiServiceKnowledgeEntry" SET "content" = ${mimic} WHERE "environment" = 'PREVIEW' AND "topic" = 'POLICY'`;
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe("P2010");
        expect((caught as Prisma.PrismaClientKnownRequestError).meta?.code).toBe("23514");
        expect((caught as Error).message).toContain("23514");
        const rowAfter = await policyRow();
        expect(rowAfter).toMatchObject({ version: rowBefore!.version, content: policyV1, approved: true });
    });
});
