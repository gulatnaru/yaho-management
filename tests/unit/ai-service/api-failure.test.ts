import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { openAiProvider, type ProviderResult } from "@/server/ai-service/provider";
import { openAiResponsesTransport } from "@/server/ai-service/openai-transport";
import { ServiceDenied } from "@/server/ai-service/contracts";
import { syntheticContext, syntheticHandlerDependencies } from "@/tests/eval/ai-service/synthetic";

const secret = "synthetic-api-failure-secret-0123456789abcdef";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
const raw = JSON.stringify({ bot: { id: "synthetic-bot" },
    userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-guardian" } },
    action: { id: "synthetic-action", name: "synthetic" } });
const keys = () => ({ encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" });

function setupWithTransport(fetcher: typeof fetch) {
    const context = syntheticContext();
    const transport = openAiResponsesTransport("test-key-" + "k".repeat(40), fetcher);
    const provider: Dependencies["provider"] = (id, model) => {
        if (id !== "OPENAI" || model !== "gpt-6-luna") throw new ServiceDenied();
        return openAiProvider("gpt-6-luna", transport);
    };
    const deps = syntheticHandlerDependencies(context, provider);
    Object.assign(context.fake.state.aiServiceConfig[0], { provider: "OPENAI" });
    deps.keys = keys();
    deps.secret = secret;
    deps.botId = "synthetic-bot";
    return { context, deps };
}

afterEach(() => { vi.useRealTimers(); });

describe("API error and timeout (flow 8, stubbed transport only)", () => {
    it.each([500, 503, 429])("HTTP %s from the Responses API hands off, keeps the unknown hold, and never retries", async status => {
        const fetchStub = vi.fn(async () => new Response(JSON.stringify({ error: { message: "synthetic failure" } }),
            { status, headers: { "content-type": "application/json" } }));
        const { context, deps } = setupWithTransport(fetchStub as unknown as typeof fetch);
        const result = await handleSkill(headers(), raw, "api-failure-request-0001", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it("a network disconnect hands off, keeps the unknown hold, and never retries", async () => {
        const fetchStub = vi.fn(async () => { throw new Error("NETWORK_DOWN"); });
        const { context, deps } = setupWithTransport(fetchStub as unknown as typeof fetch);
        const result = await handleSkill(headers(), raw, "api-failure-request-0002", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it("a classify that resolves after the 1500ms stage deadline hands off with the unknown hold", async () => {
        vi.useFakeTimers();
        try {
            const context = syntheticContext();
            let resolveClassify!: (v: ProviderResult) => void;
            const provider: Dependencies["provider"] = () => ({ id: "TEST_DOUBLE",
                classify: async () => new Promise<ProviderResult>(r => { resolveClassify = r; }) });
            const deps = syntheticHandlerDependencies(context, provider);
            deps.keys = keys();
            deps.secret = secret;
            deps.botId = "synthetic-bot";
            setTimeout(() => resolveClassify({ call: { name: "get_approved_guidance", args: { topic: "PREPARATION" } },
                usage: { inputTokens: 100, outputTokens: 10 } }), 2000);
            const result = handleSkill(headers(), raw, "api-failure-request-0003", deps);
            await vi.advanceTimersByTimeAsync(1600);
            const reply = await result;
            expect(reply.template.outputs[0].simpleText.text).toBe(HANDOFF);
            expect(context.fake.state.aiServiceRequest[0].status).toBe("UNKNOWN");
            await vi.advanceTimersByTimeAsync(1000);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a classify that resolves inside the stage deadline still grounds the reply", async () => {
        vi.useFakeTimers();
        try {
            const context = syntheticContext();
            let resolveClassify!: (v: ProviderResult) => void;
            const provider: Dependencies["provider"] = () => ({ id: "TEST_DOUBLE",
                classify: async () => new Promise<ProviderResult>(r => { resolveClassify = r; }) });
            const deps = syntheticHandlerDependencies(context, provider);
            deps.keys = keys();
            deps.secret = secret;
            deps.botId = "synthetic-bot";
            setTimeout(() => resolveClassify({ call: { name: "get_approved_guidance", args: { topic: "PREPARATION" } },
                usage: { inputTokens: 100, outputTokens: 10 } }), 1000);
            const result = handleSkill(headers(), raw, "api-failure-request-0004", deps);
            await vi.advanceTimersByTimeAsync(1100);
            const reply = await result;
            expect(reply.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
            expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
        } finally {
            vi.useRealTimers();
        }
    });
});
