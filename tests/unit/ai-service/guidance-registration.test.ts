import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saveApprovedGuidance, readApprovedGuidanceState } from "@/server/ai-service/guidance-admin";
import approvedRegistry from "@/server/ai-service/approved-guidance-v1.json";
import { safePublicText } from "@/server/ai-service/public-text";
import { fakeDb } from "./fake-db";
const prepPath = new URL("../../fixtures/approved-guidance-v1/preparation-v1.txt", import.meta.url);
const rainPath = new URL("../../fixtures/approved-guidance-v1/rain-v1.txt", import.meta.url);
const prep = readFileSync(prepPath, "utf8");
const rain = readFileSync(rainPath, "utf8");
const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
describe("approved guidance registry (OQ-16 v1)", () => {
    it("matches the SPEC table and the approval manifest", () => {
        expect(approvedRegistry.registryVersion).toBe("v1");
        expect(approvedRegistry.entries.PREPARATION).toEqual({ topic: "PREPARATION", version: 1, filename: "yaho_oq16_preparation_v1.txt",
            sha256: "d6a5a3aa9d0bae04c518170c335401f9b934f4a4a99bd001812681201aafc41a", characters: 269, bytes: 593 });
        expect(approvedRegistry.entries.RAIN).toEqual({ topic: "RAIN", version: 1, filename: "yaho_oq16_rain_v1.txt",
            sha256: "87d5f1729d43bd563ef9bc826709a6fcc8944614a98cf2aa479823a5d9d870c3", characters: 385, bytes: 932 });
    });
    it("fixture copies are byte-identical to the approved registry hashes", () => {
        expect(sha256(prep)).toBe(approvedRegistry.entries.PREPARATION.sha256);
        expect(sha256(rain)).toBe(approvedRegistry.entries.RAIN.sha256);
        expect(prep.length).toBe(269);
        expect(rain.length).toBe(385);
    });
    it("safePublicText returns both approved texts byte-identical (D-11 no-op)", () => {
        expect(safePublicText(prep)).toBe(prep);
        expect(safePublicText(rain)).toBe(rain);
    });
});
describe("saveApprovedGuidance (OQ-16 registration)", () => {
    it("saves PREPARATION v1 with one audit row", async () => {
        const f = fakeDb();
        const saved = await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry);
        expect(saved.content).toBe(prep);
        expect(saved.approved).toBe(true);
        expect(saved.version).toBe(1);
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(1);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(1);
        expect(f.state.aiServiceGuidanceAudit[0]).toMatchObject({ environment: "PREVIEW", topic: "PREPARATION", version: 1,
            contentSha256: approvedRegistry.entries.PREPARATION.sha256, actorId: "synthetic-admin" });
    });
    it("saves RAIN v1 with one audit row", async () => {
        const f = fakeDb();
        const saved = await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: 0 });
        expect(saved.content).toBe(rain);
        expect(saved.approved).toBe(true);
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(1);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(1);
        expect(f.state.aiServiceGuidanceAudit[0]).toMatchObject({ environment: "PREVIEW", topic: "RAIN", version: 1,
            contentSha256: approvedRegistry.entries.RAIN.sha256, actorId: "synthetic-admin" });
    });
    it("rejects the POLICY topic, storing nothing and auditing nothing", async () => {
        const f = fakeDb();
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "POLICY", content: "합성 운영정책 안내입니다.", expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("rejects a one-character hash mismatch, storing nothing and auditing nothing", async () => {
        const f = fakeDb();
        const tampered = prep.replace("운동화", "운동화!");
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: tampered, expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("stores approved=true even when the submission says approved=false", async () => {
        const f = fakeDb();
        const saved = await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0, approved: false }, approvedRegistry);
        expect(saved.approved).toBe(true);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(1);
    });
    it.each([
        ["STAFF role", { userId: "synthetic-staff", role: "STAFF", active: true }],
        ["TEACHER role", { userId: "synthetic-teacher", role: "TEACHER", active: true }],
        ["inactive admin", { userId: "synthetic-admin", role: "ADMIN", active: false }],
        ["empty userId", { userId: "", role: "ADMIN", active: true }],
    ])("rejects a non-ADMIN actor (%s)", async (_label, actor) => {
        const f = fakeDb();
        await expect(saveApprovedGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("rejects the PRODUCTION environment", async () => {
        const f = fakeDb();
        await expect(saveApprovedGuidance(f.db, "PRODUCTION", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("rejects content over 1000 characters", async () => {
        const f = fakeDb();
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: "가".repeat(1001), expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("rejects an expectedVersion mismatch", async () => {
        const f = fakeDb();
        await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry);
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 5 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(1);
        expect(f.state.aiServiceKnowledgeEntry[0].version).toBe(1);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(1);
    });
    it("fails the registration too when the audit write fails (fail-closed)", async () => {
        const f = fakeDb();
        f.failNext("aiServiceGuidanceAudit.create");
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("rejects a submission with added surrounding whitespace (hash is pre-trim)", async () => {
        const f = fakeDb();
        await expect(saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: ` ${prep}\n`, expectedVersion: 0 }, approvedRegistry))
            .rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(0);
    });
    it("re-registers the same text with the next expectedVersion", async () => {
        const f = fakeDb();
        await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry);
        const saved = await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 1 }, approvedRegistry);
        expect(saved.version).toBe(2);
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(1);
        expect(f.state.aiServiceGuidanceAudit).toHaveLength(2);
    });
});
describe("fake TransactionClient (D-12)", () => {
    it("has no nested $transaction: calling it must fail in unit tests", async () => {
        const f = fakeDb();
        await f.db.$transaction(async (tx) => {
            expect((tx as Record<string, unknown>).$transaction).toBeUndefined();
        });
    });
});
describe("readApprovedGuidanceState", () => {
    it("returns nothing before registration and both rows after", async () => {
        const f = fakeDb();
        expect(await readApprovedGuidanceState(f.db, "PREVIEW", admin)).toEqual([]);
        await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "PREPARATION", content: prep, expectedVersion: 0 }, approvedRegistry);
        await saveApprovedGuidance(f.db, "PREVIEW", admin, { topic: "RAIN", content: rain, expectedVersion: 0 }, approvedRegistry);
        const state = await readApprovedGuidanceState(f.db, "PREVIEW", admin);
        expect(state).toHaveLength(2);
        expect(state[0]).toMatchObject({ topic: "PREPARATION", version: 1, approved: true, contentSha256: approvedRegistry.entries.PREPARATION.sha256 });
        expect(state[1]).toMatchObject({ topic: "RAIN", version: 1, approved: true, contentSha256: approvedRegistry.entries.RAIN.sha256 });
    });
    it("rejects a non-ADMIN reader", async () => {
        const f = fakeDb();
        await expect(readApprovedGuidanceState(f.db, "PREVIEW", { userId: "synthetic-staff", role: "STAFF", active: true }))
            .rejects.toThrow("AI_SERVICE_DENIED");
    });
});
