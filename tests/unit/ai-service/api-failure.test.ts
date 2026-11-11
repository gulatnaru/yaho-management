import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { handleSkill } from "@/server/ai-service/handler";
import type { ToolResult } from "@/server/ai-service/tools";
import { syntheticContext, syntheticHandlerDependencies } from "@/tests/eval/ai-service/synthetic";

const secret = "synthetic-api-failure-secret-0123456789abcdef";
const headers = () => new Headers({ "x-yaho-skill-key": secret });
const raw = JSON.stringify({ bot: { id: "synthetic-bot" },
    userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-guardian" } },
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

afterEach(() => { vi.useRealTimers(); });

describe("tool error and timeout (flow 8, deterministic path)", () => {
    it("a catalog tool that throws hands off and fails closed without a hold", async () => {
        const { context, deps } = setup();
        const realExecute = context.tools.execute.bind(context.tools);
        context.tools.execute = vi.fn(async (call, signal) => {
            if (call.name === "list_public_programs") throw new Error("synthetic catalog failure");
            return realExecute(call, signal);
        });
        const result = await handleSkill(headers(), raw, "api-failure-request-0001", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest[0].status).toBe("FAILED");
        expect(context.fake.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0, unknownCount: 0 });
    });

    it("a selected tool that throws hands off and settles known at 0 KRW", async () => {
        const { context, deps } = setup();
        const realExecute = context.tools.execute.bind(context.tools);
        context.tools.execute = vi.fn(async (call, signal) => {
            if (call.name === "get_approved_guidance") throw new Error("synthetic guidance failure");
            return realExecute(call, signal);
        });
        const result = await handleSkill(headers(), raw, "api-failure-request-0002", deps);
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 0 });
    });

    it("a selected tool that resolves after the 200ms stage deadline hands off with the unknown hold", async () => {
        vi.useFakeTimers();
        try {
            const { context, deps } = setup();
            let resolveGuidance!: (v: ToolResult) => void;
            const guidance = new Promise<ToolResult>(r => { resolveGuidance = r; });
            const realExecute = context.tools.execute.bind(context.tools);
            context.tools.execute = vi.fn(async (call, signal) => call.name === "get_approved_guidance" ? guidance : realExecute(call, signal));
            setTimeout(() => resolveGuidance({ kind: "GUIDANCE", content: "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요." }), 1000);
            const result = handleSkill(headers(), raw, "api-failure-request-0003", deps);
            await vi.advanceTimersByTimeAsync(201);
            const reply = await result;
            expect(reply.template.outputs[0].simpleText.text).toBe(HANDOFF);
            expect(context.fake.state.aiServiceRequest[0].status).toBe("UNKNOWN");
            await vi.advanceTimersByTimeAsync(1000);
            expect(context.fake.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        } finally {
            vi.useRealTimers();
        }
    });

    it("a selected tool that resolves inside the stage deadline still grounds the reply", async () => {
        vi.useFakeTimers();
        try {
            const { context, deps } = setup();
            let resolveGuidance!: (v: ToolResult) => void;
            const guidance = new Promise<ToolResult>(r => { resolveGuidance = r; });
            const realExecute = context.tools.execute.bind(context.tools);
            context.tools.execute = vi.fn(async (call, signal) => call.name === "get_approved_guidance" ? guidance : realExecute(call, signal));
            setTimeout(() => resolveGuidance({ kind: "GUIDANCE", content: "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요." }), 100);
            const result = handleSkill(headers(), raw, "api-failure-request-0004", deps);
            await vi.advanceTimersByTimeAsync(110);
            const reply = await result;
            expect(reply.template.outputs[0].simpleText.text).toBe("합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요.");
            expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true, usedKrw: 0 });
        } finally {
            vi.useRealTimers();
        }
    });
});
