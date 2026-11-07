import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import type { ProviderResult } from "@/server/ai-service/provider";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import { syntheticContext, syntheticHandlerDependencies } from "@/tests/eval/ai-service/synthetic";
import { now } from "./fake-db";

const secret = "synthetic-duplicate-secret-0123456789abcdef";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
const utterance = "야호 준비물을 알려 주세요";
const raw = JSON.stringify({ bot: { id: "synthetic-bot" },
    userRequest: { utterance, user: { id: "synthetic-guardian" } },
    action: { id: "synthetic-action", name: "synthetic" } });
const keys = () => ({ encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" });

function setup() {
    const context = syntheticContext();
    const classify = vi.fn(async (): Promise<ProviderResult> => ({ call: { name: "get_approved_guidance", args: { topic: "PREPARATION" } },
        usage: { inputTokens: 100, outputTokens: 10 } }));
    const provider: Dependencies["provider"] = () => ({ id: "TEST_DOUBLE", classify });
    const deps = syntheticHandlerDependencies(context, provider);
    deps.keys = keys();
    deps.secret = secret;
    deps.botId = "synthetic-bot";
    return { context, deps, classify };
}
const stableId = (userId = "synthetic-guardian", text = utterance) =>
    deriveStableRequestId({ botId: "synthetic-bot", userId, blockId: "", utterance: text, now });

describe("duplicate, concurrency, and quota (flow 10)", () => {
    it("replays the same stable request id as a handoff without calling the provider again", async () => {
        const { context, deps, classify } = setup();
        const id = stableId();
        const first = await handleSkill(headers(), raw, id, deps);
        expect(first.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        expect(classify).toHaveBeenCalledTimes(1);
        const second = await handleSkill(headers(), raw, id, deps);
        expect(second.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(context.fake.state.aiServiceRequest).toHaveLength(1);
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
    });

    it("rejects the same stable request id with a different utterance and never calls the provider again", async () => {
        const { context, deps, classify } = setup();
        const id = stableId();
        await handleSkill(headers(), raw, id, deps);
        expect(classify).toHaveBeenCalledTimes(1);
        const otherRaw = JSON.stringify({ bot: { id: "synthetic-bot" },
            userRequest: { utterance: "12월 숲체험 일정 알려주세요.", user: { id: "synthetic-guardian" } },
            action: { id: "synthetic-action", name: "synthetic" } });
        const second = await handleSkill(headers(), otherRaw, id, deps);
        expect(second.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(context.fake.state.aiServiceRequest).toHaveLength(1);
    });

    it("blocks the call when the global minute quota is already full", async () => {
        const { context, deps, classify } = setup();
        context.fake.seed("aiServiceQuotaBucket", { environment: "PREVIEW", kind: "GLOBAL_MINUTE",
            window: now.toISOString().slice(0, 16), aliases: ["GLOBAL"], accepted: 60, expiresAt: new Date(now.getTime() + 120000) });
        const result = await handleSkill(headers(), raw, stableId(), deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(classify).not.toHaveBeenCalled();
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("admits four concurrent requests and rejects the fifth while the first four are processing", async () => {
        const context = syntheticContext();
        const resolvers: ((v: { call: { name: "get_approved_guidance"; args: { topic: "PREPARATION" } }; usage: { inputTokens: number; outputTokens: number } }) => void)[] = [];
        const classify = vi.fn(async () => new Promise<{ call: { name: "get_approved_guidance"; args: { topic: "PREPARATION" } }; usage: { inputTokens: number; outputTokens: number } }>(r => { resolvers.push(r); }));
        const provider: Dependencies["provider"] = () => ({ id: "TEST_DOUBLE", classify });
        const deps = syntheticHandlerDependencies(context, provider);
        deps.keys = keys();
        deps.secret = secret;
        deps.botId = "synthetic-bot";
        const calls = [0, 1, 2, 3, 4].map(i =>
            handleSkill(headers(), raw, stableId("synthetic-guardian-" + i), deps));
        for (let i = 0; i < 100 && context.fake.state.aiServiceRequest.length < 4; i++)
            await new Promise(r => setTimeout(r, 5));
        expect(context.fake.state.aiServiceRequest).toHaveLength(4);
        for (const resolve of resolvers) resolve({ call: { name: "get_approved_guidance", args: { topic: "PREPARATION" } }, usage: { inputTokens: 100, outputTokens: 10 } });
        const replies = await Promise.all(calls);
        const texts = replies.map(r => r.template.outputs[0].simpleText.text);
        expect(texts.filter(t => t === "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.")).toHaveLength(4);
        expect(texts.filter(t => t === HANDOFF)).toHaveLength(1);
        expect(classify).toHaveBeenCalledTimes(4);
        expect(context.fake.state.aiServiceRequest.filter(r => r.status === "SETTLED")).toHaveLength(4);
    });
});
