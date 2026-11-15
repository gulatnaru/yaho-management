import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminContext } from "@/server/ai-service/admin-context";
import { assertAdminEnabled, assertSyntheticSkillEnabled } from "@/server/ai-service/runtime";

const { principal } = vi.hoisted(() => ({ principal: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: principal }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/ai-service/keys", () => ({ readServiceKeys: () => ({}) }));

beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AI_SERVICE_ADMIN_ENABLED", "true");
    vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "false");
    principal.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("admin and synthetic Skill entry boundaries", () => {
    it("allows an authenticated ADMIN when explicitly enabled without enabling Skill", async () => {
        principal.mockResolvedValue({ userId: "synthetic-admin", role: "ADMIN" });
        const context = await adminContext();
        expect(context.actor).toEqual({ userId: "synthetic-admin", role: "ADMIN", active: true });
        expect(context.environment).toBe("PREVIEW");
        expect(() => assertSyntheticSkillEnabled()).toThrow();
    });
    it.each(["anonymous", "inactive", "non-admin"])("propagates server authorization denial for %s", async () => {
        principal.mockRejectedValue(new Error("authorization denied"));
        await expect(adminContext()).rejects.toThrow("authorization denied");
        expect(principal).toHaveBeenCalledOnce();
    });
    it.each(["production", "development", "unknown", ""])("rejects environment %s before authorization even when both flags are on", async environment => {
        vi.stubEnv("VERCEL_ENV", environment);
        vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
        await expect(adminContext()).rejects.toThrow("AI_SERVICE_DENIED");
        expect(principal).not.toHaveBeenCalled();
        expect(() => assertSyntheticSkillEnabled()).toThrow("AI_SERVICE_DENIED");
    });
    it("rejects a missing environment before authorization", async () => {
        vi.stubEnv("VERCEL_ENV", undefined);
        await expect(adminContext()).rejects.toThrow("AI_SERVICE_DENIED");
        expect(principal).not.toHaveBeenCalled();
    });
    it("keeps admin and Skill switches independent", () => {
        expect(() => assertAdminEnabled({ VERCEL_ENV: "preview", AI_SERVICE_SYNTHETIC_ENABLED: "true" })).toThrow();
        expect(() => assertSyntheticSkillEnabled({ VERCEL_ENV: "preview", AI_SERVICE_ADMIN_ENABLED: "true" })).toThrow();
    });
});
