import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { HANDOFF, type ToolCall } from "@/server/ai-service/contracts";
import { openAiProvider, type ProviderResult } from "@/server/ai-service/provider";
import type { ToolResult } from "@/server/ai-service/tools";
import { fakeDb, seedConfig, now } from "./fake-db";
const secret = "synthetic-selection-secret-0123456789";
const body = (utterance: string) => JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance, user: { id: "synthetic-subject" } }, action: { id: "synthetic-action", name: "synthetic" } });
const prep: ToolCall = { name: "get_approved_guidance", args: { topic: "PREPARATION" } };
function setup(result: ProviderResult = { call: prep, usage: { inputTokens: 100, outputTokens: 10 } }) {
    const f = fakeDb(); seedConfig(f);
    const classify = vi.fn(async () => result);
    const execute = vi.fn(async (call: ToolCall): Promise<ToolResult> => call.name === "list_public_programs" ? { kind: "PROGRAMS" as const, items: [] } : call.name === "list_public_classes" ? { kind: "CLASSES" as const, items: [] } : { kind: "GUIDANCE" as const, content: "합성 준비물은 모자입니다." });
    const deps: Dependencies = { db: f.db, environment: "PREVIEW", secret, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" },
        provider: () => ({ id: "TEST_DOUBLE", classify }), tools: { execute } };
    const run = async (question = "야호 준비물을 알려 주세요") => (await handleSkill(new Headers({ "x-yaho-skill-key": secret }), body(question), "synthetic-selection-request-001", deps)).template.outputs[0].simpleText.text;
    return { f, deps, classify, execute, run };
}
describe("handler selection boundaries and billing", () => {
    it.each<ProviderResult>([
        { call: null, classification: "HUMAN_HANDOFF", usage: { inputTokens: 100, outputTokens: 10 } },
        { call: { name: "get_approved_guidance", args: { topic: "RAIN" } }, usage: { inputTokens: 100, outputTokens: 10 } },
        { call: { name: "list_public_programs", args: {} }, usage: { inputTokens: 100, outputTokens: 10 } },
        { call: { name: "get_class_availability", args: { classHandle: "unknown" } }, usage: { inputTokens: 100, outputTokens: 10 } },
    ])("executes only trusted preloads on denied model choices %#", async result => {
        const { run, execute, f, classify } = setup(result);
        expect(await run()).toBe(HANDOFF);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0 });
    });
    it.each(["야호 준비물과 우천 안내", "야호 운영정책에 결제 안내", "야호 준비물 그리고 추천 식당"])("rejects mixed content even with a valid read choice: %s", async q => {
        const { run, execute } = setup(); expect(await run(q)).toBe(HANDOFF); expect(execute).toHaveBeenCalledTimes(2);
    });
    it("validates again before freshness execution instead of trusting a previously accepted mutable selection", async () => {
        const result: ProviderResult = { call: structuredClone(prep), usage: { inputTokens: 100, outputTokens: 10 } };
        const { run, execute } = setup(result);
        const topics: string[] = [];
        execute.mockImplementation(async call => {
            if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
            if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] };
            // A tool cannot change the accepted call used by the second policy check.
            if (call.name === "get_approved_guidance") { topics.push(call.args.topic); call.args.topic = "RAIN"; }
            result.call = { name: "get_approved_guidance", args: { topic: "RAIN" } };
            return { kind: "GUIDANCE", content: "합성 준비물은 모자입니다." };
        });
        expect(await run()).toBe("합성 준비물은 모자입니다.");
        expect(execute).toHaveBeenCalledTimes(4);
        expect(topics).toEqual(["PREPARATION", "PREPARATION"]);
        expect(execute.mock.calls[3][0]).toMatchObject({ name: "get_approved_guidance" });
    });
    it("hides publication changes during post-settlement re-read and charges known usage once", async () => {
        const { run, execute, f } = setup(); let selectedReads = 0;
        execute.mockImplementation(async call => call.name === "list_public_programs" ? { kind: "PROGRAMS", items: [] } : call.name === "list_public_classes" ? { kind: "CLASSES", items: [] } : { kind: "GUIDANCE", content: ++selectedReads === 1 ? "합성 준비물은 모자입니다." : null });
        expect(await run()).toBe(HANDOFF); expect(selectedReads).toBe(2);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0 });
    });
    it("settles malformed output with known usage without selecting any read", async () => {
        const { run, deps, f, execute } = setup(); f.state.aiServiceConfig[0].provider = "OPENAI";
        deps.provider = () => openAiProvider("gpt-6-luna", async () => ({ status: "completed", output: "secret malformed output", usage: { input_tokens: 100, output_tokens: 10 } }));
        expect(await run()).toBe(HANDOFF); expect(execute).toHaveBeenCalledTimes(2);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
    });
    it("returns fixed handoff for selected execution failure and never raw error", async () => {
        const { run, execute, f } = setup();
        execute.mockImplementation(async call => { if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] }; if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] }; throw new Error("secret failure"); });
        expect(await run()).toBe(HANDOFF); expect(execute).toHaveBeenCalledTimes(3); expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
    });
    it("bounds a stuck selected tool at 200ms while preserving known billing", async () => {
        vi.useFakeTimers();
        try {
            const { run, execute, f } = setup();
            execute.mockImplementation(async call => {
                if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
                if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] };
                return new Promise<ToolResult>(() => {});
            });
            const response = run(); await vi.advanceTimersByTimeAsync(201);
            expect(await response).toBe(HANDOFF);
            expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
            expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0 });
        } finally { vi.useRealTimers(); }
    });
    it("bounds a noncooperative classifier at 1500ms, holds unknown charge and never retries", async () => {
        vi.useFakeTimers();
        try {
            const { run, classify, f, execute } = setup(); classify.mockImplementation(() => new Promise(() => {}));
            const response = run(); await vi.advanceTimersByTimeAsync(1501);
            expect(await response).toBe(HANDOFF); expect(classify).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(2);
            expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN"); expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ reservedKrw: 2, unknownCount: 1 });
        } finally { vi.useRealTimers(); }
    });
});
