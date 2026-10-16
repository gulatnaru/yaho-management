import { billingContract } from "@/server/ai-service/billing";
import { describe, it, expect, vi } from "vitest";
import { monthKst, reserveKrw, conservativeKrw, MAX_INPUT_TOKENS } from "@/server/ai-service/cost";
import { openAiProvider, RESPONSE_TOOLS } from "@/server/ai-service/provider";
import { now } from "./fake-db";
const price = { ...billingContract("TEST_DOUBLE", "gpt-6-luna"), inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, priceVersion: "p1" };
const response = { status: "completed", output: [{ type: "function_call", name: "get_approved_guidance", arguments: '{"topic":"RAIN"}' }], usage: { input_tokens: 100, output_tokens: 30 } };
describe("AI service cost and provider", () => {
    it("KST month changes at15UTC without deleting oldmonth", () => { expect(monthKst(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10"); expect(monthKst(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11"); });
    it("reserves approved cushions and rounds upwards in integerKRW", () => { expect(conservativeKrw(price, 1500, 300)).toBe(1); expect(reserveKrw(price, now)).toBe(2); });
    it.each([-1, 1.5, NaN, Infinity])("denies invalid token amount %s", v => expect(() => conservativeKrw(price, v, 1)).toThrow("AI_SERVICE_DENIED"));
    it("denies stale/future FX", () => { expect(() => reserveKrw({ ...price, fxCheckedAt: new Date(+now - 72 * 3600000 - 1) }, now)).toThrow(); expect(() => reserveKrw({ ...price, fxCheckedAt: new Date(+now + 1) }, now)).toThrow(); });
    it("accepts72hours but no implicit FX refresh", () => expect(reserveKrw({ ...price, fxCheckedAt: new Date(+now - 72 * 3600000) }, now)).toBe(2));
    it("sends only allowed customtools, stateless config and one call", async () => {
        const transport = vi.fn(async (_body: unknown, _signal: AbortSignal) => { void _body; void _signal; return response; });
        const provider = openAiProvider("gpt-6-luna", transport);
        const result = await provider.classify({ utterance: "야호 비가 오면?", signal: new AbortController().signal });
        expect(result.call?.name).toBe("get_approved_guidance");
        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport.mock.calls[0][0]).toMatchObject({ store: false, background: false, parallel_tool_calls: false, max_output_tokens: 256 });
        expect(RESPONSE_TOOLS).toHaveLength(4);
        expect(RESPONSE_TOOLS.every(t => t.strict && t.type === "function")).toBe(true);
    });
    it.each([
        [{ type: "function_call", name: "sql", arguments: "{}" }],
        [{ type: "message", content: "private answer" }],
        [{ type: "function_call", name: "get_approved_guidance", arguments: '{"topic":"RAIN","sql":"select"}' }],
        [{ type: "function_call", name: "get_approved_guidance", arguments: "notJSON" }],
        [response.output[0], response.output[0]],
    ].map(output => ({ output })))("retains charge for invalid output without exposing prose", async ({ output }) => {
        const p = openAiProvider("gpt-6-luna", async () => ({ ...response, output }));
        expect(await p.classify({ utterance: "야호 일정", signal: new AbortController().signal })).toEqual({ call: null, usage: { inputTokens: 100, outputTokens: 30 } });
    });
    it("preserves higher-than-estimate usage truthfully but deniessemanticoutput", async () => {
        const p = openAiProvider("gpt-6-luna", async () => ({ ...response, usage: { input_tokens: MAX_INPUT_TOKENS + 1, output_tokens: 300 } }));
        const result = await p.classify({ utterance: "야호", signal: new AbortController().signal });
        expect(result.call).toBeNull();
        expect(result.usage.outputTokens).toBe(300);
    });
    it("missing usage is uncertain and no automaticretry", async () => {
        const transport = vi.fn(async () => ({ status: "failed", output: [] }));
        const p = openAiProvider("gpt-6-luna", transport);
        await expect(p.classify({ utterance: "야호", signal: new AbortController().signal })).rejects.toThrow();
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it("abort beforedispatch does not invoke transport", async () => {
        const transport = vi.fn(), c = new AbortController();
        c.abort();
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호", signal: c.signal })).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
    });
    it("rejects unknown model", () => expect(() => openAiProvider("unapproved", vi.fn())).toThrow());
    it("never sends private catalog fields", async () => {
        const transport = vi.fn();
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호", signal: new AbortController().signal, catalog: [{ kind: "PROGRAMS", items: [], capacity: 8 } as never] })).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
    });
});
