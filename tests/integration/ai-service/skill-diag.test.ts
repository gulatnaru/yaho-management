import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { POST } from "@/app/api/ai-service/v1/skill/route";
import { emitSkillDiag, SkillDiagCode as C } from "@/server/ai-service/skill-diag";
import { skillReply } from "@/server/ai-service/contracts";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const ids: string[] = [];
const realCreate = prisma.aiServiceSkillDiag.create.bind(prisma.aiServiceSkillDiag);
const prod = "p".repeat(32), test = "t".repeat(32);
const payload = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { user: { id: "synthetic-test-run-123" }, block: { id: "synthetic-block" }, utterance: "야호 준비물을 알려 주세요" } });
function setup() {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
    vi.stubEnv("AI_SERVICE_SKILL_SECRET", prod); vi.stubEnv("AI_SERVICE_SKILL_TEST_SECRET", test);
    vi.stubEnv("AI_SERVICE_SYNTHETIC_RUN_ID", "test-run-123"); vi.stubEnv("AI_SERVICE_SYNTHETIC_EXPIRES_AT", "2999-01-01T00:00:00Z");
    vi.stubEnv("AI_SERVICE_BOT_ID", "synthetic-bot"); vi.stubEnv("AI_SERVICE_ENCRYPTION_KEYS", "invalid");
}
const req = (key = test, body = payload) => new Request("http://localhost/api/ai-service/v1/skill", { method: "POST", headers: { "x-yaho-skill-key": key }, body });
async function counts() { return Promise.all([prisma.aiServiceRequest.count(), prisma.aiServiceBudgetMonth.count(), prisma.aiServiceQuotaBucket.count()]); }
afterEach(() => {
    vi.unstubAllEnvs();
    const create = prisma.aiServiceSkillDiag.create;
    if (vi.isMockFunction(create)) create.mockReset().mockImplementation(realCreate);
    const log = console.error;
    if (vi.isMockFunction(log)) log.mockRestore();
    vi.useRealTimers();
});
afterAll(async () => { await prisma.aiServiceSkillDiag.deleteMany({ where: { correlationId: { in: ids } } }); await prisma.$disconnect(); });
describe.sequential("skill diagnostics against isolated PostgreSQL", () => {
    it.each([
        ["stage 1", C.S1_GATE_OFF], ["stage 3", C.S3_MISMATCH], ["stage 4", C.S4_PROD_KIND],
        ["stage 5", C.S5_BODY_TOO_LARGE], ["stage 6", C.S6_BODY_JSON_INVALID], ["stage 8", C.S8_BOT_ID_MISSING], ["stage 8b", C.S8B_KEYS_ENC_PARSE],
    ])("T-INT-1 and T-INT-3: %s persists one row without business writes", async (stage, code) => {
        setup(); const before = await counts(); const start = new Date();
        if (stage === "stage 1") vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "false");
        if (stage === "stage 8") vi.stubEnv("AI_SERVICE_BOT_ID", "");
        const response = await POST(stage === "stage 3" ? req("wrong") : stage === "stage 4" ? req(prod) : stage === "stage 5" ? req(test, "x".repeat(16385)) : stage === "stage 6" ? req(test, "{") : req());
        const rows = await prisma.aiServiceSkillDiag.findMany({ where: { emittedAt: { gte: start }, stageCode: code }, orderBy: { emittedAt: "desc" } });
        expect(response.status).toBe(503); expect(await response.text()).toBe(JSON.stringify(skillReply())); expect(rows).toHaveLength(1);
        ids.push(rows[0].correlationId); expect(rows[0]).toMatchObject({ stageCode: code, environment: "PREVIEW", diagVersion: 1 });
        expect(rows[0].correlationId).toMatch(/^[0-9a-f-]{36}$/); expect(rows[0].emittedAt.getTime()).toBeGreaterThanOrEqual(start.getTime()); expect(await counts()).toEqual(before);
    });
    it("T-INT-2 unique correlation id prevents duplicate rows", async () => {
        setup(); const correlationId = randomUUID(); ids.push(correlationId);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        await emitSkillDiag({ code: C.S1_GATE_OFF, correlationId }); await emitSkillDiag({ code: C.S1_GATE_OFF, correlationId });
        expect(await prisma.aiServiceSkillDiag.count({ where: { correlationId } })).toBe(1); expect(log).toHaveBeenCalledOnce();
    });
    it("T-INT-4 insert failure preserves 503 and falls back", async () => {
        setup(); vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "false");
        vi.spyOn(prisma.aiServiceSkillDiag, "create").mockRejectedValue(new Error("synthetic database failure"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await POST(req()); expect(res.status).toBe(503); expect(await res.text()).toBe(JSON.stringify(skillReply())); expect(log).toHaveBeenCalledOnce();
    });
    it("T-INT-5 slow insert returns after bounded timeout", async () => {
        setup(); vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "false"); vi.useFakeTimers();
        vi.spyOn(prisma.aiServiceSkillDiag, "create").mockImplementation(() => new Promise(() => {}) as never);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const pending = POST(req()); await vi.advanceTimersByTimeAsync(3000); const res = await pending;
        expect(res.status).toBe(503); expect(log).toHaveBeenCalledOnce();
    });
    it("T-INT-6 and T-PROD-2 have no production diagnostics", async () => {
        setup(); const before = await prisma.aiServiceSkillDiag.count(); vi.stubEnv("VERCEL_ENV", "production");
        const log = vi.spyOn(console, "error"); const res = await POST(req());
        expect(res.status).toBe(503); expect(await res.text()).toBe(JSON.stringify(skillReply()));
        expect(await prisma.aiServiceSkillDiag.count()).toBe(before); expect(log).not.toHaveBeenCalled();
        expect(res.headers.has("x-yaho-diag-stage")).toBe(false); expect(res.headers.has("x-yaho-diag-id")).toBe(false);
    });
});
