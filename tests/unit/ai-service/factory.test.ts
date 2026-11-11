import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveDependencies } from "@/server/ai-service/factory";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { HANDOFF } from "@/server/ai-service/contracts";
import { syntheticContext } from "@/tests/eval/ai-service/synthetic";
import { fakeDb, seedConfig } from "./fake-db";

const secret = "synthetic-factory-secret-0123456789abcdef";
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
    // OQ-12 P0-A: the live factory no longer reads AI_SERVICE_OPENAI_API_KEY.
    return { ...process.env, ...serviceKeysEnv(), AI_SERVICE_SKILL_SECRET: secret, ...extra };
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("live factory (stubbed fetch only, no live OpenAI call)", () => {
    it("F-1 builds deps without an API key and grounds a reply deterministically through handleSkill", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        // The factory uses the real clock; the synthetic config date would
        // otherwise read as a stale FX rate and the claim would fail closed.
        Object.assign(context.fake.state.aiServiceConfig[0], { fxCheckedAt: new Date() });
        const deps = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        expect("provider" in deps).toBe(false);
        const result = await handleSkill(headers(), raw, "factory-test-request-0001", deps);
        expect(result.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true, usedKrw: 0 });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("F-2 deps carry no provider field, so the handler can never call a model", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        Object.assign(context.fake.state.aiServiceConfig[0], { fxCheckedAt: new Date() });
        const deps = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        expect("provider" in deps).toBe(false);
        const result = await handleSkill(headers(), raw, "factory-test-request-0002", deps);
        expect(result.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(context.fake.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("F-3 ignores a missing or malformed API key: the live path never uses one", () => {
        const f = fakeDb();
        const base = liveEnv();
        expect(() => createLiveDependencies({ env: base, db: f.db, environment: "PREVIEW", botId })).not.toThrow();
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "short" }), db: f.db, environment: "PREVIEW", botId })).not.toThrow();
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "k".repeat(20) + "\n" }), db: f.db, environment: "PREVIEW", botId })).not.toThrow();
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_OPENAI_API_KEY: "k".repeat(257) }), db: f.db, environment: "PREVIEW", botId })).not.toThrow();
    });

    it("F-4 rejects a missing or short Skill secret", () => {
        const f = fakeDb();
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_SECRET: undefined }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_SECRET: "x".repeat(31) }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
    });

    it("F-4b rejects a weak or prod-equal test secret, and treats an absent test secret as unset", () => {
        const f = fakeDb();
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_TEST_SECRET: "x".repeat(31) }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_TEST_SECRET: "x".repeat(257) }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
        expect(() => createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_TEST_SECRET: secret }), db: f.db, environment: "PREVIEW", botId })).toThrow("AI_SERVICE_DENIED");
    });

    it("F-6 carries the test secret in deps when set, and undefined when absent or empty", () => {
        const f = fakeDb();
        expect(createLiveDependencies({ env: liveEnv(), db: f.db, environment: "PREVIEW", botId }).testSecret).toBeUndefined();
        expect(createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_TEST_SECRET: "" }), db: f.db, environment: "PREVIEW", botId }).testSecret).toBeUndefined();
        expect(createLiveDependencies({ env: liveEnv({ AI_SERVICE_SKILL_TEST_SECRET: "synthetic-test-secret-0123456789abcdef" }), db: f.db, environment: "PREVIEW", botId }).testSecret).toBe("synthetic-test-secret-0123456789abcdef");
    });

    it("F-5 rejects a wrong Skill header before body or DB processing", async () => {
        const context = syntheticContext();
        seedConfig(context.fake);
        const deps: Dependencies = createLiveDependencies({ env: liveEnv(), db: context.fake.db, environment: "PREVIEW", botId });
        const wrong = new Headers({ "x-yaho-skill-key": "synthetic-wrong-secret-0123456789abcdef" });
        const result = await handleSkill(wrong, raw, "factory-test-request-0005", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
        expect(fetch).not.toHaveBeenCalled();
    });
});
