import { describe, it, expect } from "vitest";
import { claim, markDispatched, settle, reconcileMonth } from "@/server/ai-service/ledger";
import { purgeExpired } from "@/server/ai-service/retention";
import { fakeDb, seedConfig, now } from "./fake-db";
const hash = (c: string) => "v1:" + c.repeat(64);
function input(id = "a", date = now) { return { environment: "PREVIEW" as const, hmacPins: [{ version: "v1", fingerprint: "1".repeat(64) }], now: date, requestHashes: [hash(id)], payloadHashes: [hash("b")], subjectHashes: [hash("c")] }; }
const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
async function setup() {
    const f = fakeDb();
    seedConfig(f);
    const c = await claim(f.db, input());
    if (c.kind !== "CLAIMED")
        throw Error();
    return { f, c };
}
describe("Prisma repository contracts (serialized doubles, NOT PostgreSQL proof)", () => {
    it("same concurrent request atomicallyclaims once", async () => {
        const f = fakeDb();
        seedConfig(f);
        const rows = await Promise.all([claim(f.db, input()), claim(f.db, input())]);
        expect(rows.map(r => r.kind).sort()).toEqual(["CLAIMED", "DUPLICATE"]);
        expect(f.state.aiServiceRequest).toHaveLength(1);
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(2);
        expect(f.operations).toContain("lock");
    });
    it("same IDdifferentbody rejected", async () => { const { f } = await setup(); await expect(claim(f.db, { ...input(), payloadHashes: [hash("d")] })).rejects.toThrow(); });
    it("last environmentcapacity claimed once under concurrent admission", async () => {
        const f = fakeDb();
        seedConfig(f);
        f.seed("aiServiceBudgetMonth", { id: "b", environment: "PREVIEW", month: "2026-10", capKrw: 1000, usedKrw: 998, reservedKrw: 0, correctionKrw: 0, unknownCount: 0, version: 1 });
        const rows = await Promise.allSettled([claim(f.db, input("a")), claim(f.db, input("d"))]);
        expect(rows.filter(r => r.status === "fulfilled")).toHaveLength(1);
    });
    it("productionuses7000 independently of Preview1000", async () => {
        const f = fakeDb();
        seedConfig(f, "PRODUCTION");
        const c = await claim(f.db, { ...input(), environment: "PRODUCTION" });
        expect(c.kind).toBe("CLAIMED");
        expect(f.state.aiServiceBudgetMonth[0].capKrw).toBe(7000);
    });
    it("rolls back reservations andquota onrequestcreatefailure", async () => {
        const f = fakeDb();
        seedConfig(f);
        f.failNext("aiServiceRequest.create");
        await expect(claim(f.db, input())).rejects.toThrow();
        expect(f.state.aiServiceBudgetMonth).toHaveLength(0);
        expect(f.state.aiServiceQuotaBucket).toHaveLength(0);
    });
    it("settlement duplicate increments spend andmetriconce", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        const result = { kind: "KNOWN" as const, inputTokens: 100, outputTokens: 20, category: "GUIDANCE" };
        const rows = await Promise.all([settle(f.db, "PREVIEW", c.row.id, 1, result, now), settle(f.db, "PREVIEW", c.row.id, 1, result, now)]);
        expect(rows.sort()).toEqual([false, true]);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0 });
        expect(f.state.aiServiceDailyMetric[0].count).toBe(1);
    });
    it("truthfullyhighercostsettlesabove cap andblocks nextclaim", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "KNOWN", inputTokens: 10000000, outputTokens: 10000000, category: "HUMAN_HANDOFF" }, now);
        expect(Number(f.state.aiServiceBudgetMonth[0].usedKrw)).toBeGreaterThan(1000);
        await expect(claim(f.db, input("d"))).rejects.toThrow();
    });
    it("knownundispatchedfailure releasescost but keepsquota", async () => {
        const { f, c } = await setup();
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNDISPATCHED" }, now);
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(0);
        expect(f.state.aiServiceQuotaBucket[0].accepted).toBe(1);
    });
    it("dispatchedfailure cannot masquerade asunused", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await expect(settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNDISPATCHED" }, now)).rejects.toThrow();
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(2);
    });
    it("unknown keepshold andblocks everyprovider/month", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNKNOWN" }, now);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ reservedKrw: 2, unknownCount: 1 });
        f.state.aiServiceConfig[0].provider = "OPENAI";
        f.state.aiServiceConfig[0].fxCheckedAt = new Date("2026-11-01T00:00:00Z");
        await expect(claim(f.db, input("d", new Date("2026-11-01T00:00:00Z")))).rejects.toThrow();
    });
    it("90daypurge never clears olderfinancialhold", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNKNOWN" }, now);
        const later = new Date(+now + 91 * 86400000);
        await purgeExpired(f.db, "PREVIEW", later);
        expect(f.state.aiServiceRequest).toHaveLength(0);
        expect(f.state.aiServiceBudgetMonth[0].unknownCount).toBe(1);
        f.state.aiServiceConfig[0].fxCheckedAt = later;
        await expect(claim(f.db, input("d", later))).rejects.toThrow();
    });
    it("staleundispatched recovers before newclaim", async () => {
        const { f } = await setup();
        const later = new Date(+now + 4000);
        await claim(f.db, input("d", later));
        expect(f.state.aiServiceRequest[0].status).toBe("FAILED");
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(2);
    });
    it("latecompletion fenced afterstale recovery", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await expect(claim(f.db, input("d", new Date(+now + 4000)))).rejects.toThrow();
        // Recovery is committed before admission rejection; late completion cannot undo the hold.
        expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        expect(await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "KNOWN", inputTokens: 1, outputTokens: 1, category: "GUIDANCE" }, now)).toBe(false);
    });
    it("invoicepositivecorrection and version preventreopening spentbudget", async () => {
        const { f, c } = await setup();
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNDISPATCHED" }, now);
        await reconcileMonth(f.db, "PREVIEW", actor, { month: "2026-10", expectedVersion: Number(f.state.aiServiceBudgetMonth[0].version), billedKrw: 1000, heldActualKrw: 0, resolveAllHeld: false, coveredThroughGeneration: Number(f.state.aiServiceBudgetMonth[0]?.dispatchGeneration ?? 0), coverageConfirmed: true, reference: "invoice-synthetic123" }, now);
        await expect(claim(f.db, input("d"))).rejects.toThrow();
        await expect(reconcileMonth(f.db, "PREVIEW", actor, { month: "2026-10", expectedVersion: 1, billedKrw: 0, heldActualKrw: 0, resolveAllHeld: true, coveredThroughGeneration: Number(f.state.aiServiceBudgetMonth[0]?.dispatchGeneration ?? 0), coverageConfirmed: true, reference: "invoice-synthetic123" }, now)).rejects.toThrow();
    });
    it("confirmedinvoice can resolve expiredunknownaggregate withoutrequestraw", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNKNOWN" }, now);
        await reconcileMonth(f.db, "PREVIEW", actor, { month: "2026-10", expectedVersion: Number(f.state.aiServiceBudgetMonth[0].version),
            billedKrw: 2, heldActualKrw: 2, resolveAllHeld: true, coveredThroughGeneration: Number(f.state.aiServiceBudgetMonth[0]?.dispatchGeneration ?? 0), coverageConfirmed: true, reference: "invoice-synthetic123" }, now);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 2, reservedKrw: 0, unknownCount: 0, billedKrw: 2 });
    });
    it.each(["MANAGER", "TEACHER", "ANONYMOUS"])("refuses%s reconciliationbeforeDB", async (role) => {
        const f = fakeDb();
        await expect(reconcileMonth(f.db, "PREVIEW", { ...actor, role }, { month: "2026-10", expectedVersion: 1, billedKrw: 0, heldActualKrw: 0, resolveAllHeld: true, coveredThroughGeneration: Number(f.state.aiServiceBudgetMonth[0]?.dispatchGeneration ?? 0), coverageConfirmed: true, reference: "invoice-synthetic123" }, now)).rejects.toThrow();
        expect(f.operations).toHaveLength(0);
    });
    it("HMAC rotationaliases dedup againstoldkey", async () => {
        const { f } = await setup();
        const c = await claim(f.db, { ...input(), requestHashes: [hash("d"), hash("a")], payloadHashes: [hash("e"), hash("b")], subjectHashes: [hash("f"), hash("c")] });
        expect(c.kind).toBe("DUPLICATE");
    });
    it("subjectquota cannot refund viafailure", async () => {
        const f = fakeDb();
        seedConfig(f);
        for (let i = 0; i < 10; i++) {
            const c = await claim(f.db, input(i.toString(16)));
            if (c.kind === "CLAIMED")
                await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNDISPATCHED" }, now);
        }
        await expect(claim(f.db, input("e"))).rejects.toThrow();
    });
});
describe("key continuity and invoice evidence", () => {
    it("dropping a pinned HMAC version cannot reopen request/quota identity", async () => {
        const f = fakeDb();
        seedConfig(f);
        const first = await claim(f.db, input());
        if (first.kind !== "CLAIMED")
            throw Error();
        await settle(f.db, "PREVIEW", first.row.id, 1, { kind: "UNDISPATCHED" }, now);
        await expect(claim(f.db, { ...input("d"), requestHashes: ["v2:" + "d".repeat(64)], payloadHashes: ["v2:" + "b".repeat(64)], subjectHashes: ["v2:" + "c".repeat(64)] })).rejects.toThrow();
    });
    it("contradictory invoice amount cannot clear unknown obligations", async () => {
        const { f, c } = await setup();
        await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
        await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "UNKNOWN" }, now);
        await expect(reconcileMonth(f.db, "PREVIEW", actor, { month: "2026-10", expectedVersion: Number(f.state.aiServiceBudgetMonth[0].version),
            billedKrw: 0, heldActualKrw: 2, resolveAllHeld: true, coveredThroughGeneration: Number(f.state.aiServiceBudgetMonth[0]?.dispatchGeneration ?? 0), coverageConfirmed: true, reference: "invoice-synthetic123" }, now)).rejects.toThrow();
        expect(f.state.aiServiceBudgetMonth[0].unknownCount).toBe(1);
    });
});
