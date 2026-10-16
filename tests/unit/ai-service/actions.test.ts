import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, seedConfig, now } from "./fake-db";
const context = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/ai-service/admin-context", () => ({ adminContext: async () => context.value }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveConfigAction, savePublicationAction, saveGuidanceAction, reconcileAction } from "@/app/(admin)/ai-service/actions";
function form(values: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(values))
        f.set(k, v);
    f.set("$ACTION_ID_synthetic", "");
    return f;
}
describe("ADMIN synthetic server-action form mapping", () => {
    let f: ReturnType<typeof fakeDb>;
    beforeEach(() => { f = fakeDb(); context.value = { db: f.db, environment: "PREVIEW", actor: { userId: "synthetic-admin", role: "ADMIN", active: true }, keys: null }; });
    it("publication accepts native action metadata without unrelated settingfields", async () => {
        f.seed("program", { id: "p1", name: "합성 야호", description: null, status: "ACTIVE", updatedAt: now });
        await savePublicationAction(form({ kind: "PROGRAM", id: "p1", expectedVersion: "0", enabled: "true" }));
        expect(f.state.aiServiceProgramPublication[0].enabled).toBe(true);
    });
    it("guidance correctly parses explicit approval", async () => {
        await saveGuidanceAction(form({ topic: "RAIN", content: "합성 우천 안내", expectedVersion: "0", approved: "true" }));
        expect(f.state.aiServiceKnowledgeEntry[0].approved).toBe(true);
    });
    it("config ignores framework metadata but preserves explicitpause", async () => {
        await saveConfigAction(form({ expectedVersion: "0", paused: "true", provider: "TEST_DOUBLE", model: "gpt-6-luna", priceVersion: "p1",
            inputNanoUsdPerToken: "100", outputNanoUsdPerToken: "500", fxMilliKrwPerUsd: "1400000", fxCheckedAt: new Date().toISOString(), fxSource: "synthetic-bank" }));
        expect(f.state.aiServiceConfig[0].paused).toBe(true);
    });
    it("tampered pause is rejected before mutation", async () => {
        seedConfig(f);
        await expect(saveConfigAction(form({ expectedVersion: "1", paused: "malformed" }))).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceConfig[0].version).toBe(1);
    });
    it("reconciliation ignores framework metadata and retains safeguards", async () => {
        f.seed("aiServiceBudgetMonth", { id: "b", environment: "PREVIEW", month: "2026-10", capKrw: 1000, reservedKrw: 0, usedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0, version: 1 });
        await reconcileAction(form({ month: "2026-10", expectedVersion: "1", billedKrw: "1000", heldActualKrw: "0", resolveAllHeld: "false", coveredThroughGeneration: "0", coverageConfirmed: "true", reference: "invoice-synthetic123" }));
        expect(f.state.aiServiceBudgetMonth[0].correctionKrw).toBe(1000);
    });
    it("MANAGER direct action refused by domain even with forgedform", async () => {
        void now;
        context.value = { db: f.db, environment: "PREVIEW", actor: { userId: "synthetic-manager", role: "MANAGER", active: true } };
        await expect(saveGuidanceAction(form({ topic: "RAIN", content: "합성", approved: "true", expectedVersion: "0" }))).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.operations).toHaveLength(0);
    });
});
