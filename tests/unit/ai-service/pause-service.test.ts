import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fakeDb, seedConfig, now } from "./fake-db";
import { pauseService, readState, saveConfig } from "@/server/ai-service/admin";
import { assertDeploymentApproved } from "@/server/ai-service/runtime";
import type { Actor } from "@/server/ai-service/contracts";
const context = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/ai-service/admin-context", () => ({ adminContext: async () => context.value }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { pauseServiceAction } from "@/app/(admin)/ai-service/actions";
const actor: Actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
function fixture() { const f = fakeDb(); seedConfig(f); Object.assign(f.state.aiServiceConfig[0], { updatedAt: now, hmacVersions: ["v1"], fxCheckedAt: new Date(+now - 73 * 3600000) }); return f; }
describe("emergency pause", () => {
    it("T1/T2/T8 pauses with stale FX and preserves other fields", async () => {
        const f = fixture(); const old = structuredClone(f.state.aiServiceConfig[0]);
        const result = await pauseService(f.db, "PREVIEW", actor, { expectedVersion: 1 });
        expect(result).toEqual({ paused: true, version: 2, alreadyPaused: false, pausedAt: now });
        expect(f.state.aiServiceConfig[0]).toEqual({ ...old, paused: true, version: 2, updatedById: actor.userId });
        expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
        expect(f.state.aiServiceDeletionAudit[0]).toMatchObject({ environment: "PREVIEW", kind: "EMERGENCY_PAUSE", requestId: "config:PREVIEW", actorId: actor.userId, reasonCode: "EMERGENCY_PAUSE", scope: "CONFIG" });
        const { environment: _environment, version: _version, updatedAt: _updatedAt, updatedById: _updatedById, hmacVersions: _hmac, ...input } = old;
        void [_environment, _version, _updatedAt, _updatedById, _hmac];
        await expect(saveConfig(f.db, "PREVIEW", actor, { ...input, expectedVersion: 1 }, now)).rejects.toThrow("AI_SERVICE_DENIED");
    });
    it("T3 rejects unauthorized actors before reading", async () => {
        for (const bad of [{ ...actor, role: "STAFF" }, { ...actor, active: false }, { ...actor, userId: "" }] as Actor[]) {
            const f = fixture(); const before = structuredClone(f.state.aiServiceConfig);
            await expect(pauseService(f.db, "PREVIEW", bad, { expectedVersion: 1 })).rejects.toThrow("AI_SERVICE_DENIED");
            expect(f.operations).toEqual([]); expect(f.state.aiServiceConfig).toEqual(before); expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        }
    });
    it("T4 rejects missing config and T5 accepts duplicate regardless of version", async () => {
        const empty = fakeDb(); await expect(pauseService(empty.db, "PREVIEW", actor, { expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED"); expect(empty.state.aiServiceConfig).toHaveLength(0);
        const f = fixture(); Object.assign(f.state.aiServiceConfig[0], { paused: true, version: 5 });
        for (const expectedVersion of [5, 4]) expect(await pauseService(f.db, "PREVIEW", actor, { expectedVersion })).toEqual({ paused: true, version: 5, alreadyPaused: true, pausedAt: now });
        expect(f.state.aiServiceDeletionAudit).toHaveLength(2);
    });
    it("rejects stale version while running and refuses extra fields", async () => {
        const f = fixture(); await expect(pauseService(f.db, "PREVIEW", actor, { expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        await expect(pauseService(f.db, "PREVIEW", actor, { expectedVersion: 1, paused: false } as { expectedVersion: number })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceDeletionAudit).toHaveLength(0);
        const source = readFileSync("server/ai-service/admin.ts", "utf8").split("export async function pauseService(")[1].split("export async function")[0];
        expect(source).not.toMatch(/paused\s*:\s*false/);
    });
    it("action ignores paused and checks authority", async () => {
        const f = fixture(); context.value = { db: f.db, environment: "PREVIEW", actor };
        const form = new FormData(); form.set("expectedVersion", "1"); form.set("paused", "false");
        expect(await pauseServiceAction(null, form)).toEqual({ paused: true, version: 2, alreadyPaused: false, pausedAt: now.toISOString() });
        expect(f.state.aiServiceConfig[0].paused).toBe(true); expect(f.state.aiServiceDeletionAudit).toHaveLength(1);
        expect(await pauseServiceAction(null, form)).toEqual({ paused: true, version: 2, alreadyPaused: true, pausedAt: now.toISOString() });
        context.value = { db: f.db, environment: "PREVIEW", actor: { ...actor, active: false } };
        expect(await pauseServiceAction(null, form)).toEqual({ formError: "AI_SERVICE_DENIED" });
        context.value = { db: fakeDb().db, environment: "PREVIEW", actor };
        expect(await pauseServiceAction(null, form)).toEqual({ formError: "AI_SERVICE_DENIED" });
        context.value = { db: fixture().db, environment: "PREVIEW", actor };
        form.set("expectedVersion", "0");
        expect(await pauseServiceAction(null, form)).toEqual({ formError: "AI_SERVICE_DENIED" });
    });
    it("reports latest emergency audit irrespective of insertion order", async () => {
        const f = fixture(); expect((await readState(f.db, "PREVIEW", actor, now)).monitoring).toMatchObject({ emergencyPauseCount: 0, lastEmergencyPauseAt: null, lastEmergencyPauseById: null });
        for (const [kind, offset, actorId] of [["EMERGENCY_PAUSE", 1, "first-admin"], ["EMERGENCY_PAUSE", 3, "latest-admin"], ["DELETE_SINGLE", 10, "other-admin"], ["EMERGENCY_PAUSE", 2, "first-admin"]] as const) f.seed("aiServiceDeletionAudit", { environment: "PREVIEW", kind, actorId, createdAt: new Date(+now + offset) });
        expect((await readState(f.db, "PREVIEW", actor, now)).monitoring).toMatchObject({ emergencyPauseCount: 3, lastEmergencyPauseAt: new Date(+now + 3), lastEmergencyPauseById: "latest-admin" });
    });
    it("retains the deployment lock", () => { expect(() => assertDeploymentApproved()).toThrow("AI_SERVICE_DENIED"); });
});
