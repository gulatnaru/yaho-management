import { afterEach, describe, expect, it, vi } from "vitest";
import * as transport from "@/server/ai-service/transport";
import { environmentSchema } from "@/server/ai-service/contracts";
import { skillReply } from "@/server/ai-service/contracts";
import { SkillDiagCode as C } from "@/server/ai-service/skill-diag";
import { POST } from "@/app/api/ai-service/v1/skill/route";

const mocks = vi.hoisted(() => ({ create: vi.fn(), handler: vi.fn(), factory: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { aiServiceSkillDiag: { create: mocks.create } } }));
vi.mock("@/server/ai-service/skill", () => ({ handleKakaoSkill: mocks.handler }));
vi.mock("@/server/ai-service/factory", () => ({ createLiveDependencies: mocks.factory }));
const prod = "p".repeat(32), test = "t".repeat(32);
const payload = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { user: { id: "synthetic-test-run-123" }, block: { id: "synthetic-block" }, utterance: "야호 준비물을 알려 주세요" } });
function setup() {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("AI_SERVICE_SYNTHETIC_ENABLED", "true");
    vi.stubEnv("AI_SERVICE_SKILL_SECRET", prod); vi.stubEnv("AI_SERVICE_SKILL_TEST_SECRET", test);
    vi.stubEnv("AI_SERVICE_SYNTHETIC_RUN_ID", "test-run-123"); vi.stubEnv("AI_SERVICE_SYNTHETIC_EXPIRES_AT", "2999-01-01T00:00:00Z");
    vi.stubEnv("AI_SERVICE_BOT_ID", "synthetic-bot");
    mocks.create.mockResolvedValue({}); mocks.factory.mockReturnValue({}); mocks.handler.mockResolvedValue(skillReply());
}
const request = (key = test, body = payload) => new Request("http://localhost/api/ai-service/v1/skill", { method: "POST", headers: { "x-yaho-skill-key": key }, body });
async function rejected(req: Request, code: C) {
    const res = await POST(req); expect(res.status).toBe(503); expect(await res.text()).toBe(JSON.stringify(skillReply()));
    expect(Object.fromEntries(res.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/json", "x-content-type-options": "nosniff" });
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.create.mock.calls[0][0].data.stageCode).toBe(code);
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("skill route diagnostics", () => {
    it("T-U-3 identifies operational secret", async () => { setup(); await rejected(request(prod), C.S4_PROD_KIND); });
    it("classifies malformed body and preserves the 503", async () => { setup(); await rejected(request(test, "{"), C.S6_BODY_JSON_INVALID); });
    it("classifies missing bot config", async () => { setup(); vi.stubEnv("AI_SERVICE_BOT_ID", ""); await rejected(request(), C.S8_BOT_ID_MISSING); });
    it("classifies body read failure", async () => { setup(); const r = request(); vi.spyOn(r, "text").mockRejectedValue(new Error("private")); await rejected(r, C.S5_BODY_READ_FAILED); });
    it("classifies large body", async () => { setup(); await rejected(request(test, "x".repeat(16385)), C.S5_BODY_TOO_LARGE); });
    it("T-U-5 stage 2 drift detector", async () => { setup(); vi.spyOn(environmentSchema, "parse").mockImplementationOnce(() => { throw new Error("synthetic"); }); await rejected(request(), C.S2_ENV_INVALID); });
    it("T-U-5 context drift detector", async () => { setup(); vi.spyOn(transport, "verifiedSkillKind").mockImplementationOnce(() => { throw new Error("synthetic"); }); await rejected(request(), C.S4_CONTEXT_INVALID); });
    it("T-U-5 stage 7 drift detector", async () => { setup(); const original = JSON.parse; let calls = 0; vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => { if (text === payload && ++calls === 2) throw new Error("synthetic"); return original(text, reviver); }); await rejected(request(), C.S7_JSON_INVALID); });
    it("T-U-6 maps unexpected failures to S0_UNKNOWN", async () => { setup(); mocks.factory.mockImplementation(() => { throw new Error("private"); }); await rejected(request(), C.S0_UNKNOWN); });
    it("T-U-8 successful response has no diagnostics", async () => { setup(); const res = await POST(request()); expect(res.status).toBe(200); expect(mocks.create).not.toHaveBeenCalled(); });
    it("T-PROD-1 route is inert in production", async () => { setup(); vi.stubEnv("VERCEL_ENV", "production"); const log = vi.spyOn(console, "error"); const res = await POST(request()); expect(res.status).toBe(503); expect(await res.text()).toBe(JSON.stringify(skillReply())); expect(mocks.create).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); });
    it("diagnostic failure retains golden response", async () => { setup(); mocks.create.mockRejectedValue(new Error("private")); const log = vi.spyOn(console, "error").mockImplementation(() => { throw new Error("private"); }); const res = await POST(request(prod)); expect(res.status).toBe(503); expect(await res.text()).toBe(JSON.stringify(skillReply())); expect(log).toHaveBeenCalledOnce(); });
});
