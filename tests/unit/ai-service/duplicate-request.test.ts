import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { handleSkill } from "@/server/ai-service/handler";
import { deriveStableRequestId } from "@/server/ai-service/request-id";
import type { ToolResult } from "@/server/ai-service/tools";
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
    const deps = syntheticHandlerDependencies(context);
    deps.keys = keys();
    deps.secret = secret;
    deps.botId = "synthetic-bot";
    return { context, deps };
}
const stableId = (userId = "synthetic-guardian", text = utterance) =>
    deriveStableRequestId({ botId: "synthetic-bot", userId, blockId: "", utterance: text, now });

describe("duplicate, concurrency, and quota (flow 10)", () => {
    it("replays the same stable request id as a handoff without dispatching again", async () => {
        const { context, deps } = setup();
        const id = stableId();
        const first = await handleSkill(headers(), raw, id, deps);
        expect(first.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
        const second = await handleSkill(headers(), raw, id, deps);
        expect(second.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(1);
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true, usedKrw: 0 });
    });

    it("rejects the same stable request id with a different utterance and never dispatches again", async () => {
        const { context, deps } = setup();
        const id = stableId();
        await handleSkill(headers(), raw, id, deps);
        const otherRaw = JSON.stringify({ bot: { id: "synthetic-bot" },
            userRequest: { utterance: "12월 숲체험 일정 알려주세요.", user: { id: "synthetic-guardian" } },
            action: { id: "synthetic-action", name: "synthetic" } });
        const second = await handleSkill(headers(), otherRaw, id, deps);
        expect(second.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(1);
    });

    it("blocks the call when the global minute quota is already full", async () => {
        const { context, deps } = setup();
        context.fake.seed("aiServiceQuotaBucket", { environment: "PREVIEW", kind: "GLOBAL_MINUTE",
            window: now.toISOString().slice(0, 16), aliases: ["GLOBAL"], accepted: 60, expiresAt: new Date(now.getTime() + 120000) });
        const result = await handleSkill(headers(), raw, stableId(), deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest).toHaveLength(0);
    });

    it("admits four concurrent requests and rejects the fifth while the first four are processing", async () => {
        const context = syntheticContext();
        // Hold the first four at the catalog preload (after claim): the 200ms
        // stage bound leaves a wide enough window for all five claims to land.
        let resolvePreload!: (v: ToolResult) => void;
        const preload = new Promise<ToolResult>(r => { resolvePreload = r; });
        const realExecute = context.tools.execute.bind(context.tools);
        context.tools.execute = vi.fn(async (call, signal) => call.name === "list_public_programs" ? preload : realExecute(call, signal));
        const deps = syntheticHandlerDependencies(context);
        deps.keys = keys();
        deps.secret = secret;
        deps.botId = "synthetic-bot";
        const calls = [0, 1, 2, 3, 4].map(i =>
            handleSkill(headers(), raw, stableId("synthetic-guardian-" + i), deps));
        for (let i = 0; i < 100 && context.fake.state.aiServiceRequest.length < 4; i++)
            await new Promise(r => setTimeout(r, 5));
        expect(context.fake.state.aiServiceRequest).toHaveLength(4);
        resolvePreload({ kind: "PROGRAMS", items: [] });
        const replies = await Promise.all(calls);
        const texts = replies.map(r => r.template.outputs[0].simpleText.text);
        expect(texts.filter(t => t === "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.")).toHaveLength(4);
        expect(texts.filter(t => t === HANDOFF)).toHaveLength(1);
        expect(context.fake.state.aiServiceRequest.filter(r => r.status === "SETTLED")).toHaveLength(4);
        expect(context.fake.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });
});
