import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures";
import { runEvaluation, runnerMain } from "./runner";

const scope = fixtures.find(fixture => fixture.category === "out_of_scope")!;
const handoff = { type: "function_call", name: "HUMAN_HANDOFF", arguments: "{}" };
function response(output: unknown[], status = "completed") {
    return new Response(JSON.stringify({ status, output, usage: { input_tokens: 100, output_tokens: 10 } }), { headers: { "content-type": "application/json" } });
}
beforeEach(() => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "sk-synthetic-eval-handoff-not-a-real-key");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("strict explicit handoff evaluation with fake HTTP only", () => {
    it("scores a valid HUMAN_HANDOFF and continues to the next fixture", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => response([handoff]));
        fetcher.mockResolvedValueOnce(response([handoff])).mockResolvedValueOnce(response([{ type: "function_call", name: "list_public_programs", arguments: "{}" }]));
        const result = await runEvaluation({ mode: "live" }, { fetcher, cases: [scope, fixtures[0]] });
        expect(result.records.map(row => row.toolResult)).toEqual(["CORRECT", "CORRECT"]);
        expect(result.records[0]).toMatchObject({ actualTool: null, usage: { inputTokens: 100, outputTokens: 10 } });
        expect(result.summary).toMatchObject({ stopReason: "COMPLETE", questions: 2, correct: 2, errors: 0, totalCostKrw: 2, unknownCostReserveKrw: 0 });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("returns a successful CLI result for a valid explicit handoff", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => response([handoff]));
        const output = vi.fn();
        expect(await runnerMain(["live"], { fetcher, cases: [scope] }, output, output)).toBe(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        { output: [{ ...handoff, arguments: '{"reason":"unsupported"}' }] },
        { output: [{ ...handoff, arguments: "null" }] },
        { output: [{ ...handoff, arguments: "broken" }] },
        { output: [{ ...handoff, name: "UNKNOWN_HANDOFF" }] },
        { output: [handoff, handoff] },
        { output: [handoff], status: "incomplete" },
    ])("retains provider failure handling for invalid handoffs %#", async ({ output, status }) => {
        const fetcher = vi.fn<typeof fetch>(async () => response(output, status));
        const result = await runEvaluation({ mode: "live" }, { fetcher, cases: [scope, fixtures[0]] });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].toolResult).toBe("ERROR");
        expect(result.summary).toMatchObject({ stopReason: "PROVIDER_FAILURE", correct: 0, errors: 1, totalCostKrw: 1 });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
    });
});
