import { describe, expect, it, vi } from "vitest";
import { readConsultation, readState } from "@/server/ai-service/admin";
import { RETENTION_MS } from "@/server/ai-service/contracts";
import { encrypt } from "@/server/ai-service/crypto";
import { purgeExpired, retryRetention, RETENTION_CADENCE } from "@/server/ai-service/retention";
import { fakeDb, now } from "./fake-db";

const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };
const keys = { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" };
const expiresAt = new Date(+now + RETENTION_MS);
const binding = { id: "00112233-4455-4677-8899-aabbccddeeff", environment: "PREVIEW" as const, createdAt: now, expiresAt };

describe("inactive daily retention worker using serialized doubles only", () => {
    it("allows created+90d-1ms, blocks exactly 90d and deletes all privacy-bearing fields", async () => {
        const f = fakeDb();
        const raw = encrypt(keys, binding, { utterance: "합성 질문", reply: "합성 응답" });
        f.seed("aiServiceRequest", { ...binding, ...raw, status: "SETTLED", requestHashes: ["synthetic-request-hash"], subjectHashes: ["synthetic-subject-hash"] });
        expect(await readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => new Date(+expiresAt - 1))).toEqual({ utterance: "합성 질문", reply: "합성 응답" });
        expect(await purgeExpired(f.db, "PREVIEW", new Date(+expiresAt - 1))).toEqual({ deleted: 0, waiting: false });
        await expect(readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => expiresAt)).rejects.toThrow("AI_SERVICE_DENIED");
        expect(await purgeExpired(f.db, "PREVIEW", expiresAt)).toEqual({ deleted: 1, waiting: false });
        expect(f.state.aiServiceRequest).toEqual([]);
        await expect(readConsultation(f.db, "PREVIEW", admin, keys, binding.id, () => new Date(+expiresAt + 1))).rejects.toThrow("AI_SERVICE_DENIED");
        expect(RETENTION_CADENCE).toBe("DAILY");
    });

    it("bounds each request batch to 100, scopes expiry/environment, and repeated runs drain backlog once", async () => {
        const f = fakeDb();
        for (let i = 0; i < 205; i++) f.seed("aiServiceRequest", { ...binding, id: `synthetic-expired-${i}`, status: "SETTLED" });
        f.seed("aiServiceRequest", { ...binding, id: "synthetic-live", status: "SETTLED", expiresAt: new Date(+expiresAt + 1) });
        f.seed("aiServiceRequest", { ...binding, id: "synthetic-other-environment", status: "SETTLED", environment: "PRODUCTION" });
        for (const [id, environment, expiry] of [["expired", "PREVIEW", expiresAt], ["live", "PREVIEW", new Date(+expiresAt + 1)], ["other", "PRODUCTION", expiresAt]] as const)
            f.seed("aiServiceQuotaBucket", { id, environment, expiresAt: expiry, subjectHash: "synthetic-hash" });
        const results = await Promise.all([purgeExpired(f.db, "PREVIEW", expiresAt), purgeExpired(f.db, "PREVIEW", expiresAt)]);
        expect(results.map(r => r.deleted)).toEqual([100, 100]);
        expect((await purgeExpired(f.db, "PREVIEW", expiresAt)).deleted).toBe(5);
        expect((await purgeExpired(f.db, "PREVIEW", expiresAt)).deleted).toBe(0);
        expect(f.state.aiServiceRequest.map(r => r.id)).toEqual(["synthetic-live", "synthetic-other-environment"]);
        expect(f.state.aiServiceQuotaBucket.map(r => r.id)).toEqual(["live", "other"]);
        expect(f.state.aiServiceRetentionJob[0]).toMatchObject({ status: "IDLE", attempts: 0, deletedCount: 205, lastSuccessAt: expiresAt });
    });

    it("rolls back failed deletes, waits between attempts, stops after three failures and permits ADMIN recovery", async () => {
        const f = fakeDb();
        f.seed("aiServiceRequest", { ...binding, status: "SETTLED" });
        let clock = expiresAt;
        for (let attempt = 1; attempt <= 3; attempt++) {
            f.failNext("aiServiceRequest.deleteMany");
            await expect(purgeExpired(f.db, "PREVIEW", clock)).rejects.toThrow("AI_SERVICE_DENIED");
            expect(f.state.aiServiceRequest).toHaveLength(1);
            expect(f.state.aiServiceRequest[0].expiresAt).toEqual(expiresAt);
            const next = attempt < 3 ? new Date(+clock + attempt * 3600000) : null;
            expect(f.state.aiServiceRetentionJob[0]).toMatchObject({ status: "FAILED", attempts: attempt, nextRetryAt: next, errorCode: "RETENTION_FAILED" });
            if (next) {
                const deletes = f.operations.filter(op => op === "aiServiceRequest.deleteMany").length;
                expect(await purgeExpired(f.db, "PREVIEW", new Date(+next - 1))).toEqual({ deleted: 0, waiting: true });
                expect(f.operations.filter(op => op === "aiServiceRequest.deleteMany")).toHaveLength(deletes);
                clock = next;
            }
        }
        const deletes = f.operations.filter(op => op === "aiServiceRequest.deleteMany").length;
        await expect(purgeExpired(f.db, "PREVIEW", new Date(+clock + 86400000))).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.operations.filter(op => op === "aiServiceRequest.deleteMany")).toHaveLength(deletes);
        expect(f.state.aiServiceRetentionJob[0].attempts).toBe(3);
        for (const actor of [{ ...admin, role: "MANAGER" }, { ...admin, role: "TEACHER" }, { ...admin, active: false }]) {
            const transact = vi.spyOn(f.db, "$transaction");
            await expect(retryRetention(f.db, "PREVIEW", actor, clock)).rejects.toThrow("AI_SERVICE_DENIED");
            expect(transact).not.toHaveBeenCalled(); transact.mockRestore();
        }
        expect(await retryRetention(f.db, "PREVIEW", admin, clock)).toEqual({ deleted: 1, waiting: false });
        expect(f.state.aiServiceRetentionJob[0]).toMatchObject({ status: "IDLE", attempts: 0, nextRetryAt: null, errorCode: null });
    });

    it("preserves anonymous metrics, held financial obligations and billing evidence after privacy deletion", async () => {
        const f = fakeDb();
        f.seed("aiServiceRequest", { ...binding, status: "UNKNOWN", dispatched: true, reservedKrw: 2 });
        f.seed("aiServiceDailyMetric", { environment: "PREVIEW", day: "2026-10-15", category: "HUMAN_HANDOFF", count: 1 });
        f.seed("aiServiceBudgetMonth", { environment: "PREVIEW", month: "2026-10", usedKrw: 5, reservedKrw: 2, correctionKrw: 1, unknownCount: 1, billedKrw: 5 });
        f.seed("aiServiceReconciliation", { environment: "PREVIEW", month: "2026-10", reference: "synthetic-invoice", billedKrw: 5 });
        const preserved = ["aiServiceDailyMetric", "aiServiceBudgetMonth", "aiServiceReconciliation"].map(name => structuredClone(f.state[name]));
        await purgeExpired(f.db, "PREVIEW", expiresAt);
        expect(f.state.aiServiceRequest).toEqual([]);
        expect(["aiServiceDailyMetric", "aiServiceBudgetMonth", "aiServiceReconciliation"].map(name => f.state[name])).toEqual(preserved);
    });

    it("reports bounded job metadata and backlog without exposing private records or raw errors", async () => {
        const f = fakeDb();
        f.seed("aiServiceRequest", { ...binding, status: "UNKNOWN", subjectHashes: ["SYNTHETIC_PRIVATE_SUBJECT"], rawCiphertext: "SYNTHETIC_PRIVATE_RAW" });
        f.seed("aiServiceRetentionJob", { environment: "PREVIEW", status: "FAILED", attempts: 2, lastSuccessAt: now, nextRetryAt: expiresAt, errorCode: "SYNTHETIC_PRIVATE_ERROR" });
        const state = await readState(f.db, "PREVIEW", admin, expiresAt);
        expect(state.expiredCount).toBe(1);
        expect(state.monitoring).toEqual({ retentionCadence: "DAILY", schedulerActive: false, retentionAttempts: 2, lastRetentionSuccessAt: now, nextRetentionRetryAt: expiresAt, retentionErrorCode: null });
        expect(JSON.stringify(state.monitoring)).not.toContain("SYNTHETIC_PRIVATE");
    });
});
