import { describe, it, expect } from "vitest";
import { safePublicText, groundedReply, createTools } from "@/server/ai-service/tools";
import { savePublication, saveGuidance } from "@/server/ai-service/admin";
import { hashes, hmacPins, type Keys } from "@/server/ai-service/crypto";
import { claim, markDispatched, settle, reconcileMonth, type ReconciliationInput } from "@/server/ai-service/ledger";
import { purgeExpired } from "@/server/ai-service/retention";
import { fakeDb, seedConfig, now } from "./fake-db";
const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
function keys(): Keys { return { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" }; }
function input(k: Keys, id = "synthetic-request-A", date = now) {
    return { environment: "PREVIEW" as const, now: date, hmacPins: hmacPins(k, "PREVIEW"), requestHashes: hashes(k, "request", "PREVIEW", id),
        payloadHashes: hashes(k, "payload", "PREVIEW", "synthetic-payload"), subjectHashes: hashes(k, "subject", "PREVIEW", "synthetic-guardian") };
}
async function unknown(f: ReturnType<typeof fakeDb>, k: Keys, id: string) {
    const c = await claim(f.db, input(k, id));
    if (c.kind !== "CLAIMED")
        throw Error("EXPECTED_CLAIM");
    await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
    await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNKNOWN" }, now);
    return c;
}
function evidence(f: ReturnType<typeof fakeDb>, reference: string, billedKrw: number, heldActualKrw: number): ReconciliationInput {
    const b = f.state.aiServiceBudgetMonth[0];
    return { month: "2026-10", expectedVersion: Number(b.version), billedKrw, heldActualKrw, resolveAllHeld: true, reference,
        coveredThroughGeneration: Number(b.dispatchGeneration), coverageConfirmed: true };
}
describe("QA-MAJOR1 public seat/count boundary", () => {
    it.each([
        "합성 프로그램 모집인원 8인", "예 약 인 원 ８ 명", "참여자 수 3명", "남은 ８자리", "공석 8석", "전체 좌석 여덟 자리",
        "모\u200b집\u200b인\u200b원 8인", "모\u2060집인원８인", "모집\u202e인원 8인", "모☆집☆인☆원8인",
        "ca\u0338pa\u0338city 8", "8 participants", "remaining seats: ８", "maximum class size 8", "2 people booked", "８人", "8 reservations", "current bookings eight", "eight children registered",
    ])("rejects normalized count expression %s", text => {
        expect(() => safePublicText(text)).toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "GUIDANCE", content: text })).toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "PROGRAMS", items: [{ handle: "p", name: text, description: null }] })).toThrow("AI_SERVICE_DENIED");
    });
    it.each(["2026년 10월 15일 오전 10시 05분", "합성 숲 12번 출구", "B동 2층 104호", "２０２６년１０월１５일１０시"])("preserves allowed schedule/location digits %s", text => expect(safePublicText(text, 1000, /출구|층/.test(text) ? "LOCATION" : "FREE")).toBe(text.normalize("NFKC")));
    it("ADMIN cannot approve counts in Program/guidance/location", async () => {
        const f = fakeDb(), text = "합성 프로그램 모집인원 8인";
        f.seed("program", { id: "p", name: text, description: null, status: "ACTIVE", updatedAt: now });
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 })).rejects.toThrow();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "RAIN", content: text, approved: true, expectedVersion: 0 })).rejects.toThrow();
        f.seed("classSchedule", { id: "c", programId: "p", startsAt: now, endsAt: new Date(+now + 3600000), location: text, status: "SCHEDULED", updatedAt: now });
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "CLASS", id: "c", enabled: true, expectedVersion: 0 })).rejects.toThrow();
        expect(f.state.aiServiceProgramPublication).toHaveLength(0);
        expect(f.state.aiServiceClassPublication).toHaveLength(0);
    });
    it("persisted unsafe approved guidance still fails final projection", async () => {
        const f = fakeDb();
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "RAIN", approved: true, content: "합성 프로그램 모집인원 8인" });
        await expect(createTools(f.db, "PREVIEW", () => now).execute({ name: "get_approved_guidance", args: { topic: "RAIN" } }, new AbortController().signal)).rejects.toThrow();
    });
});
describe("QA-MAJOR3 immutable HMAC material identity", () => {
    it("same-version replacement rejects identical settled request with no identitywrite", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys(), c = await claim(f.db, input(k));
        if (c.kind !== "CLAIMED")
            throw Error();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "KNOWN", inputTokens: 1, outputTokens: 1, category: "GUIDANCE" }, now);
        const before = structuredClone(f.state);
        k.hmac.v1 = Buffer.alloc(32, 7);
        await expect(claim(f.db, input(k))).rejects.toThrow();
        expect(f.state).toEqual(before);
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceQuotaBucket).toHaveLength(2);
    });
    it("new version retaining old material deduplicates and shares subjectquota", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys(), a = await claim(f.db, input(k));
        if (a.kind !== "CLAIMED")
            throw Error();
        await settle(f.db, "PREVIEW", a.row.id, 1, { kind: "UNDISPATCHED" }, now);
        k.hmac.v2 = Buffer.alloc(32, 3);
        k.activeHmac = "v2";
        expect((await claim(f.db, input(k))).kind).toBe("DUPLICATE");
        const b = await claim(f.db, input(k, "synthetic-request-B"));
        expect(b.kind).toBe("CLAIMED");
        expect(f.state.aiServiceKeyPin).toHaveLength(2);
        expect(f.state.aiServiceQuotaBucket).toHaveLength(2);
        expect(f.state.aiServiceQuotaBucket.every(q => q.accepted === 2)).toBe(true);
    });
    it("removed pinned version rejects before writes", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await claim(f.db, input(k));
        k.hmac = { v2: Buffer.alloc(32, 3) };
        k.activeHmac = "v2";
        const before = structuredClone(f.state);
        await expect(claim(f.db, input(k, "synthetic-request-B"))).rejects.toThrow();
        expect(f.state).toEqual(before);
    });
    it("failed first claim rolls back new keypins", async () => {
        const f = fakeDb();
        seedConfig(f);
        const before = structuredClone(f.state);
        f.failNext("aiServiceRequest.create");
        await expect(claim(f.db, input(keys()))).rejects.toThrow();
        expect(f.state).toEqual(before);
        expect(f.state.aiServiceKeyPin).toHaveLength(0);
    });
    it("expiry worker cannot reset material pins", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys(), a = await claim(f.db, input(k));
        if (a.kind !== "CLAIMED")
            throw Error();
        await settle(f.db, "PREVIEW", a.row.id, 1, { kind: "UNDISPATCHED" }, now);
        const later = new Date(+now + 91 * 86400000);
        await purgeExpired(f.db, "PREVIEW", later);
        expect(f.state.aiServiceRequest).toHaveLength(0);
        expect(f.state.aiServiceKeyPin).toHaveLength(1);
        k.hmac.v1 = Buffer.alloc(32, 9);
        await expect(claim(f.db, input(k, "synthetic-request-B", later))).rejects.toThrow();
    });
});
describe("QA-MAJOR2 permanent invoice identity and generation coverage", () => {
    it("exact QA A->invoiceA->B->reused invoice cannot release B", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        const a = evidence(f, "invoice-synthetic123", 2, 2);
        await reconcileMonth(f.db, "PREVIEW", actor, a, now);
        await unknown(f, k, "synthetic-request-B");
        const before = structuredClone(f.state);
        const replay = await reconcileMonth(f.db, "PREVIEW", actor, { ...a, expectedVersion: Number(f.state.aiServiceBudgetMonth[0].version) }, now);
        expect(replay.kind).toBe("REPLAY");
        expect(f.state).toEqual(before);
        await expect(reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-synthetic123", 2, 0), now)).rejects.toThrow();
        expect(f.state.aiServiceRequest[1].status).toBe("UNKNOWN");
        await expect(claim(f.db, input(k, "synthetic-request-C"))).rejects.toThrow();
    });
    it("same-timestamp later dispatch is not covered by old generation", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        await reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-syntheticAAA", 2, 2), now);
        await unknown(f, k, "synthetic-request-B");
        expect(f.state.aiServiceRequest[0].dispatchedAt).toEqual(f.state.aiServiceRequest[1].dispatchedAt);
        await expect(reconcileMonth(f.db, "PREVIEW", actor, { ...evidence(f, "invoice-syntheticBBB", 4, 2), coveredThroughGeneration: 1 }, now)).rejects.toThrow();
        expect(f.state.aiServiceBudgetMonth[0].unknownCount).toBe(1);
    });
    it("A/B/A replay remains inert after another invoice and third liability", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        const a = evidence(f, "invoice-syntheticAAA", 2, 2);
        await reconcileMonth(f.db, "PREVIEW", actor, a, now);
        await unknown(f, k, "synthetic-request-B");
        await reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-syntheticBBB", 4, 2), now);
        await unknown(f, k, "synthetic-request-C");
        expect((await reconcileMonth(f.db, "PREVIEW", actor, a, now)).kind).toBe("REPLAY");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 4, reservedKrw: 2, unknownCount: 1, dispatchGeneration: 3 });
        expect(f.state.aiServiceReconciliation).toHaveLength(2);
    });
    it("concurrent identical evidence applies once with idempotent replay", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        const a = evidence(f, "invoice-syntheticAAA", 2, 2);
        const outcomes = await Promise.all([reconcileMonth(f.db, "PREVIEW", actor, a, now), reconcileMonth(f.db, "PREVIEW", actor, a, now)]);
        expect(outcomes.map(o => o.kind).sort()).toEqual(["APPLIED", "REPLAY"]);
        expect(f.state.aiServiceBudgetMonth[0].usedKrw).toBe(2);
    });
    it("evidence insertion failure rolls back both held state and budget", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        const before = structuredClone(f.state);
        f.failNext("aiServiceReconciliation.create");
        await expect(reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-syntheticAAA", 2, 2), now)).rejects.toThrow();
        expect(f.state).toEqual(before);
    });
    it("privacy purge preserves generation/obligation and immutable evidence", async () => {
        const f = fakeDb();
        seedConfig(f);
        const k = keys();
        await unknown(f, k, "synthetic-request-A");
        await reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-syntheticAAA", 2, 2), now);
        await unknown(f, k, "synthetic-request-B");
        const later = new Date(+now + 91 * 86400000);
        await purgeExpired(f.db, "PREVIEW", later);
        expect(f.state.aiServiceRequest).toHaveLength(0);
        expect(f.state.aiServiceReconciliation).toHaveLength(1);
        await expect(reconcileMonth(f.db, "PREVIEW", actor, { ...evidence(f, "invoice-syntheticBBB", 4, 2), coveredThroughGeneration: 1 }, later)).rejects.toThrow();
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ dispatchGeneration: 2, unknownCount: 1, reservedKrw: 2 });
        await reconcileMonth(f.db, "PREVIEW", actor, evidence(f, "invoice-syntheticBBB", 4, 2), later);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 4, unknownCount: 0, reservedKrw: 0 });
    });
});
