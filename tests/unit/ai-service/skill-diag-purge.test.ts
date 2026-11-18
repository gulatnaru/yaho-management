import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETENTION_MS, type Actor } from "@/server/ai-service/contracts";
import { fakeDb, now } from "./fake-db";
const context = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/ai-service/admin-context", () => ({ adminContext: async () => {
    if (!context.value) throw new Error("AI_SERVICE_DENIED");
    return context.value;
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from "next/cache";
import { previewSkillDiagPurgeAction, executeSkillDiagPurgeAction } from "@/app/(admin)/ai-service/actions";
const actor: Actor = { userId: "synthetic-purge-action-admin", role: "ADMIN", active: true };
const failure = (remainingEligible: number) => ({ formError: "AI_SERVICE_DENIED", partialDiagDeleted: 0, remainingEligible, auditWritten: false });
function form(expectedEligible?: string) { const f = new FormData(); if (expectedEligible !== undefined) f.set("expectedEligible", expectedEligible); return f; }

describe("two-step diagnostic purge actions", () => {
    let f: ReturnType<typeof fakeDb>;
    function seed(count: number) {
        for (let i = 0; i < count; i++) f.seed("aiServiceSkillDiag", { id: `action-${i}`, environment: "PREVIEW", emittedAt: new Date(+now - RETENTION_MS) });
    }
    beforeEach(() => {
        vi.useFakeTimers(); vi.setSystemTime(now);
        f = fakeDb(); context.value = { db: f.db, environment: "PREVIEW", actor };
    });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); context.value = null; });

    it.each([0, 3])("preview returns %i eligible with ISO time and performs no writes", async count => {
        seed(count);
        expect(await previewSkillDiagPurgeAction(null, form())).toEqual({ expectedEligible: count, asOf: now.toISOString() });
        expect(f.state.aiServiceSkillDiag).toHaveLength(count);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it("confirms the preview count, generates the audit UUID on the server and revalidates", async () => {
        seed(3);
        const preview = await previewSkillDiagPurgeAction(null, form());
        expect(preview).toHaveProperty("expectedEligible", 3);
        if (!preview || !("expectedEligible" in preview)) throw new Error("preview failed");
        const input = form(String(preview.expectedEligible));
        input.set("requestId", "client-id-must-be-ignored");
        const result = await executeSkillDiagPurgeAction(null, input);
        expect(result).toEqual({ diagDeleted: 3, beforeEligible: 3, afterEligible: 0, auditWritten: true, auditId: expect.any(String) });
        expect(f.state.aiServiceSkillDiag).toHaveLength(0);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
        expect(f.state.aiServiceDeletionAudit[0].requestId).toMatch(/^diag-purge:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(revalidatePath).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledWith("/ai-service");
    });
    it("refuses a stale preview count without deleting or revalidating", async () => {
        seed(2); const preview = await previewSkillDiagPurgeAction(null, form());
        if (!preview || !("expectedEligible" in preview)) throw new Error("preview failed");
        f.seed("aiServiceSkillDiag", { id: "arrived", environment: "PREVIEW", emittedAt: new Date(+now - RETENTION_MS) });
        expect(await executeSkillDiagPurgeAction(null, form(String(preview.expectedEligible)))).toEqual(failure(3));
        expect(f.state.aiServiceSkillDiag).toHaveLength(3);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it.each([undefined, "abc", "-1", "1.5"])("returns state for invalid expectedEligible %s", async value => {
        seed(2);
        await expect(executeSkillDiagPurgeAction(null, form(value))).resolves.toEqual(failure(0));
        expect(f.state.aiServiceSkillDiag).toHaveLength(2);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it("delegates cap refusal to the wrapper", async () => {
        seed(1001);
        expect(await executeSkillDiagPurgeAction(null, form("1001"))).toEqual(failure(1001));
        expect(f.state.aiServiceSkillDiag).toHaveLength(1001);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(readFileSync("app/(admin)/ai-service/actions.ts", "utf8")).not.toContain("1000");
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it("returns both locked states without throwing (OQ-4 bare preview fallback)", async () => {
        context.value = null;
        await expect(previewSkillDiagPurgeAction(null, form())).resolves.toEqual({ formError: "AI_SERVICE_DENIED" });
        await expect(executeSkillDiagPurgeAction(null, form("2"))).resolves.toEqual(failure(0));
        expect(f.operations).toEqual([]);
    });
    it("returns the recounted preview failure after a transient count error (OQ-4)", async () => {
        seed(3); f.failNext("aiServiceSkillDiag.count");
        expect(await previewSkillDiagPurgeAction(null, form())).toEqual(failure(3));
        expect(f.state.aiServiceSkillDiag).toHaveLength(3);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
    });
    it("falls back to parsed expectedEligible when execute count fails", async () => {
        seed(3); f.failNext("aiServiceSkillDiag.count");
        expect(await executeSkillDiagPurgeAction(null, form("3"))).toEqual(failure(3));
        expect(f.state.aiServiceSkillDiag).toHaveLength(3);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it("refuses SUPER_ADMIN via the wrapper and preserves rows", async () => {
        seed(2); context.value = { db: f.db, environment: "PREVIEW", actor: { ...actor, role: "SUPER_ADMIN" } };
        await expect(executeSkillDiagPurgeAction(null, form("2"))).resolves.toEqual(failure(2));
        expect(f.state.aiServiceSkillDiag).toHaveLength(2);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
    it("returns an empty successful confirmation without an audit row", async () => {
        expect(await executeSkillDiagPurgeAction(null, form("0"))).toEqual({ diagDeleted: 0, beforeEligible: 0, afterEligible: 0, auditWritten: false, auditId: null });
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledWith("/ai-service");
    });
    it("preserves the wrapper partial failure state and never revalidates it", async () => {
        seed(3); f.failNext("aiServiceDeletionAudit.create");
        expect(await executeSkillDiagPurgeAction(null, form("3"))).toEqual({ formError: "AI_SERVICE_DENIED", partialDiagDeleted: 3, remainingEligible: 0, auditWritten: false });
        expect(f.state.aiServiceSkillDiag).toHaveLength(0);
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
    });
});
