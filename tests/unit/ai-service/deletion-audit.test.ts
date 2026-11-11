import { describe, expect, it, vi, beforeEach } from "vitest";
import { readConsultation, findConsultationsBySubject, deleteConsultation } from "@/server/ai-service/admin";
import { RETENTION_MS } from "@/server/ai-service/contracts";
import { encrypt, hashes } from "@/server/ai-service/crypto";
import { fakeDb, now } from "./fake-db";

const context = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/ai-service/admin-context", () => ({ adminContext: async () => context.value }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { lookupConsultationsBySubjectAction, deleteConsultationAction } from "@/app/(admin)/ai-service/actions";

const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const keys = { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" };
const expiresAt = new Date(+now + RETENTION_MS);
const subject = "synthetic-subject-1";
const otherSubject = "synthetic-subject-2";
const subjectHashes = hashes(keys, "subject", "PREVIEW", subject);
const otherHashes = hashes(keys, "subject", "PREVIEW", otherSubject);
const binding = { id: "00112233-4455-4677-8899-aabbccddeeff", environment: "PREVIEW" as const, createdAt: now, expiresAt };
function seedRequest(f: ReturnType<typeof fakeDb>, overrides: Record<string, unknown> = {}) {
    f.seed("aiServiceRequest", { ...binding, status: "SETTLED", month: "2026-10", reservedKrw: 0, usedKrw: 0, subjectHashes, category: "GUIDANCE", ...overrides });
}
function form(values: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(values))
        f.set(k, v);
    f.set("$ACTION_ID_synthetic", "");
    return f;
}

describe("individual delete + deletion audit (OQ-12 P0-B)", () => {
    it("lookup returns metadata only, for the matching subject alone", async () => {
        const f = fakeDb();
        const raw = encrypt(keys, binding, { utterance: "합성 질문", reply: "합성 응답" });
        seedRequest(f, { ...raw });
        seedRequest(f, { id: "00223344-5566-4788-99aa-bbccddeeff00", subjectHashes: otherHashes });
        const rows = await findConsultationsBySubject(f.db, "PREVIEW", admin, keys, subject);
        expect(rows).toEqual([{ id: binding.id, status: "SETTLED", createdAt: now, expiresAt, category: "GUIDANCE" }]);
        expect(JSON.stringify(rows)).not.toContain("합성 질문");
        expect(JSON.stringify(rows)).not.toContain(subjectHashes[0]);
        expect(await findConsultationsBySubject(f.db, "PREVIEW", admin, keys, otherSubject)).toHaveLength(1);
        expect(await findConsultationsBySubject(f.db, "PREVIEW", admin, keys, "synthetic-nobody")).toEqual([]);
    });

    it("lookup includes not-yet-purged expired rows as deletion targets and refuses non-ADMIN or empty subjects", async () => {
        const f = fakeDb();
        seedRequest(f, { expiresAt: new Date(+expiresAt - 1) });
        expect(await findConsultationsBySubject(f.db, "PREVIEW", admin, keys, subject)).toHaveLength(1);
        await expect(findConsultationsBySubject(f.db, "PREVIEW", { ...admin, role: "MANAGER" }, keys, subject)).rejects.toThrow("AI_SERVICE_DENIED");
        await expect(findConsultationsBySubject(f.db, "PREVIEW", admin, keys, "")).rejects.toThrow("AI_SERVICE_DENIED");
    });

    it("single delete removes the row and writes one audit row with codes only", async () => {
        const f = fakeDb();
        seedRequest(f);
        seedRequest(f, { id: "00223344-5566-4788-99aa-bbccddeeff00", subjectHashes: otherHashes });
        const result = await deleteConsultation(f.db, "PREVIEW", admin, keys, { subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" });
        expect(result).toEqual({ deletedCount: 1, remainingCount: 0 });
        expect(f.state.aiServiceRequest.map((r) => r.id)).toEqual(["00223344-5566-4788-99aa-bbccddeeff00"]);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
        const audit = f.state.aiServiceDeletionAudit[0];
        expect(audit).toMatchObject({ environment: "PREVIEW", kind: "DELETE_SINGLE", requestId: binding.id, actorId: "synthetic-admin", reasonCode: "USER_REQUEST", scope: "SINGLE" });
        expect(JSON.stringify(audit)).not.toContain("합성");
        expect(JSON.stringify(audit)).not.toContain(subjectHashes[0]);
    });

    it("single delete refuses a wrong subject, a missing row, and bad input with the identical fixed error", async () => {
        const f = fakeDb();
        seedRequest(f);
        for (const input of [
            { subjectUserId: otherSubject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" },
            { subjectUserId: subject, scope: "SINGLE", requestId: "00334455-6677-4899-aabb-ccddeeff0011", reasonCode: "USER_REQUEST" },
            { subjectUserId: subject, scope: "SINGLE", reasonCode: "USER_REQUEST" },
            { subjectUserId: subject, scope: "BULK", requestId: binding.id, reasonCode: "USER_REQUEST" },
            { subjectUserId: subject, scope: "SINGLE", requestId: "not-a-uuid", reasonCode: "USER_REQUEST" },
            { subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "ADMIN_READ" },
        ]) {
            await expect(deleteConsultation(f.db, "PREVIEW", admin, keys, input)).rejects.toThrow("AI_SERVICE_DENIED");
        }
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        await expect(deleteConsultation(f.db, "PREVIEW", { ...admin, role: "TEACHER" }, keys, { subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceRequest).toHaveLength(1);
    });

    it("single delete of a PROCESSING row releases its reserved budget", async () => {
        const f = fakeDb();
        f.seed("aiServiceBudgetMonth", { environment: "PREVIEW", month: "2026-10", capKrw: 1000, reservedKrw: 2, usedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0, version: 1 });
        seedRequest(f, { status: "PROCESSING", reservedKrw: 2 });
        const result = await deleteConsultation(f.db, "PREVIEW", admin, keys, { subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "ADMIN_REVIEW" });
        expect(result).toEqual({ deletedCount: 1, remainingCount: 0 });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ reservedKrw: 0, version: 2 });
        expect(f.state.aiServiceDeletionAudit[0]).toMatchObject({ kind: "DELETE_SINGLE", reasonCode: "ADMIN_REVIEW" });
    });

    it("bulk delete removes up to 100 rows of one subject and leaves other subjects alone", async () => {
        const f = fakeDb();
        for (let i = 0; i < 105; i++) seedRequest(f, { id: `synthetic-bulk-${i}`, status: i % 2 ? "SETTLED" : "UNKNOWN" });
        seedRequest(f, { id: "00223344-5566-4788-99aa-bbccddeeff00", subjectHashes: otherHashes });
        const result = await deleteConsultation(f.db, "PREVIEW", admin, keys, { subjectUserId: subject, scope: "BULK", reasonCode: "USER_REQUEST" });
        expect(result).toEqual({ deletedCount: 100, remainingCount: 5 });
        expect(f.state.aiServiceRequest).toHaveLength(6);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(100);
        expect(new Set(f.state.aiServiceDeletionAudit.map((r) => r.kind))).toEqual(new Set(["DELETE_BULK"]));
        expect(new Set(f.state.aiServiceDeletionAudit.map((r) => r.scope))).toEqual(new Set(["BULK"]));
        const second = await deleteConsultation(f.db, "PREVIEW", admin, keys, { subjectUserId: subject, scope: "BULK", reasonCode: "USER_REQUEST" });
        expect(second).toEqual({ deletedCount: 5, remainingCount: 0 });
        expect(f.state.aiServiceRequest.map((r) => r.id)).toEqual(["00223344-5566-4788-99aa-bbccddeeff00"]);
    });

    it("a successful original-text read writes one READ audit row; failed, expired, or missing reads write none", async () => {
        const f = fakeDb();
        const raw = encrypt(keys, binding, { utterance: "합성 질문", reply: "합성 응답" });
        seedRequest(f, { ...raw });
        expect(await readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => new Date(+expiresAt - 1))).toEqual({ utterance: "합성 질문", reply: "합성 응답" });
        expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
        expect(f.state.aiServiceDeletionAudit[0]).toMatchObject({ environment: "PREVIEW", kind: "READ_CONSULTATION", requestId: binding.id, actorId: "synthetic-admin", reasonCode: "ADMIN_READ", scope: "READ" });
        await expect(readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => expiresAt)).rejects.toThrow("AI_SERVICE_DENIED");
        await expect(readConsultation(f.db, "PREVIEW", admin, keys, "00334455-6677-4899-aabb-ccddeeff0011", () => now)).rejects.toThrow("AI_SERVICE_DENIED");
        const bad = fakeDb();
        seedRequest(bad, { rawCiphertext: "synthetic-corrupt-ciphertext", encryptionVersion: "v1" });
        await expect(readConsultation(bad.db, "PREVIEW", admin, keys, binding.id, () => now)).rejects.toThrow("AI_SERVICE_DENIED");
        expect(bad.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
    });

    it("a failed audit write refuses the original-text read (fail-closed)", async () => {
        const f = fakeDb();
        const raw = encrypt(keys, binding, { utterance: "합성 질문", reply: "합성 응답" });
        seedRequest(f, { ...raw });
        f.failNext("aiServiceDeletionAudit.create");
        await expect(readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => now)).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
    });
});

describe("individual-delete server actions", () => {
    let f: ReturnType<typeof fakeDb>;
    beforeEach(() => {
        f = fakeDb();
        context.value = { db: f.db, environment: "PREVIEW", actor: { userId: "synthetic-admin", role: "ADMIN", active: true }, keys };
    });

    it("lookup returns row metadata as ISO strings and delete removes the row", async () => {
        seedRequest(f);
        const lookup = await lookupConsultationsBySubjectAction({}, form({ subjectUserId: subject }));
        expect(lookup.rows).toEqual([{ id: binding.id, status: "SETTLED", createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), category: "GUIDANCE" }]);
        const deleted = await deleteConsultationAction({}, form({ subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" }));
        expect(deleted).toEqual({ deleted: { deletedCount: 1, remainingCount: 0 } });
        expect(f.state.aiServiceRequest).toHaveLength(0);
    });

    it("lookup of an unknown subject returns an empty list; a wrong-subject delete returns only the fixed error", async () => {
        seedRequest(f);
        expect(await lookupConsultationsBySubjectAction({}, form({ subjectUserId: "synthetic-nobody" }))).toEqual({ rows: [] });
        expect(await deleteConsultationAction({}, form({ subjectUserId: otherSubject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" }))).toEqual({ formError: "AI_SERVICE_DENIED" });
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
    });

    it("empty subject and non-ADMIN actor return only the fixed error", async () => {
        seedRequest(f);
        expect(await lookupConsultationsBySubjectAction({}, form({ subjectUserId: "" }))).toEqual({ formError: "AI_SERVICE_DENIED" });
        context.value = { db: f.db, environment: "PREVIEW", actor: { userId: "synthetic-manager", role: "MANAGER", active: true }, keys };
        expect(await deleteConsultationAction({}, form({ subjectUserId: subject, scope: "SINGLE", requestId: binding.id, reasonCode: "USER_REQUEST" }))).toEqual({ formError: "AI_SERVICE_DENIED" });
        expect(f.state.aiServiceRequest).toHaveLength(1);
    });
});
