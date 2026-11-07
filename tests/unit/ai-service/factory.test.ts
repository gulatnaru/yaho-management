import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveDependencies } from "@/server/ai-service/factory";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { HANDOFF } from "@/server/ai-service/contracts";
import { syntheticContext } from "@/tests/eval/ai-service/synthetic";
import { fakeDb, seedConfig } from "./fake-db";

const secret = "synthetic-factory-secret-0123456789abcdef";
const apiKey = "test-key-" + "k".repeat(40);
const botId = "synthetic-bot";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
const raw = JSON.stringify({ bot: { id: botId },
    userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-guardian" } },
    action: { id: "synthetic-action", name: "synthetic" } });

function serviceKeysEnv() {
    const enc = randomBytes(32).toString("base64");
    const hmac = randomBytes(32).toString("base64");
    return {
        AI_SERVICE_ENCRYPTION_KEYS: JSON.stringify({ v1: enc }),
        AI_SERVICE_HMAC_KEYS: JSON.stringify({ v1: hmac }),
        AI_SERVICE_ENCRYPTION_ACTIVE: "v1",
        AI_SERVICE_HMAC_ACTIVE: "v1",
    };
}
function liveEnv(extra: Record<string, string | undefined> = {}) {
    return { ...process.env, ...serviceKeysEnv(), AI_SERVICE_OPENAI_API_KEY: apiKey, AI_SERVICE_SKILL_SECRET: secret, ...extra } as NodeJS.ProcessEnv;
}
function envelope(call: { name: string; args: Record<string, unknown> }) {
    return { status: "completed",
        output: [{ type: "function_call", call_id: "call_factory_test", name: call.name, arguments: JSON.stringify(call.args) }],
        usage: { input_tokens: 100, output_tokens: 10 } };
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope({ name: "get_approved_guidance", args: { topic: "PREPARATION" } })), { status: 200, headers: { "content-type": "application/json" } }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("live factory (stubbed fetch only, no live OpenAI call)", () => {
    it("F-1 builds an OPENAI gpt-6-luna provider from env and grounds a reply through handleSkill", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        Object.assign(context.fake.state.aiServiceConfig[0], { provider: "OPENAI", fxCheckedAt: new Date() });
        const deps = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        const result = await handleSkill(headers(), raw, "factory-test-request-0001", deps);
        expect(result.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.openai.com/v1/responses");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer " + apiKey);
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).toMatchObject({ model: "gpt-6-luna", store: false, background: false, parallel_tool_calls: false,
            max_output_tokens: 256, reasoning: { effort: "none" }, tool_choice: "required" });
        const tools = body.tools as { name: string; strict: boolean }[];
        expect(tools).toHaveLength(5);
        expect(tools.every(t => t.strict)).toBe(true);
        expect(tools.map(t => t.name)).toContain("HUMAN_HANDOFF");
        const input = body.input as { role: string; content: string }[];
        expect(input[1]).toEqual({ role: "user", content: "야호 준비물을 알려 주세요" });
    });

    it("F-2 rejects the TEST_DOUBLE provider even with valid keys and never calls fetch", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        Object.assign(context.fake.state.aiServiceConfig[0], { fxCheckedAt: new Date() });
        const deps = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        const result = await handleSkill(headers(), raw, "factory-test-request-0002", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        // The factory throws before markDispatched, so the hold settles UNDISPATCHED.
        expect(context.fake.state.aiServiceRequest[0].status).toBe("FAILED");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("F-3 rejects a missing, short, or newline-containing API key before any provider is built", () => {
        const f = fakeDb();
        const base = liveEnv();
        delete base.AI_SERVICE_OPENAI_API_KEY;
        expect(() => createLiveDependencies({ env: base, db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "short" }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "k".repeat(20) + "\n" }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "k".repeat(257) }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
    });

    it("F-4 rejects a missing or short Skill secret before any provider is built", () => {
        const f = fakeDb();
        const base = liveEnv();
        delete base.AI_SERVICE_SKILL_SECRET;
        expect(() => createLiveDependencies({ env: base, db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_SECRET: "x".repeat(31) }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
    });

    it("F-5 rejects a wrong Skill header before body, DB, or provider processing", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        Object.assign(context.fake.state.aiServiceConfig[0], { provider: "OPENAI", fxCheckedAt: new Date() });
        const deps: Dependencies = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        const wrong = new Headers({ "x-yaho-skill-key": "synthetic-wrong-secret-0123456789abcdef" });
        const result = await handleSkill(wrong, raw, "factory-test-request-0005", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
        expect(fetch).not.toHaveBeenCalled();
    });
});
