import { afterEach, describe, expect, it, vi } from "vitest";
import { testProvider } from "../../../server/ai-service/provider";
import { type ToolCall } from "../../../server/ai-service/contracts";
import { fixtures, HANDLES, type Fixture } from "./fixtures";
import { runEvaluation, MAX_REQUEST_KRW } from "./runner";
import { syntheticContext } from "./synthetic";
import { collectReport } from "./report";

const prep: ToolCall = { name: "get_approved_guidance", args: { topic: "PREPARATION" } };
const preparation: Fixture = { ...fixtures[0], question: "야호 준비물을 알려 주세요", expectedTool: prep.name,
  expectedArgs: prep.args, expectedReplyCategory: "GUIDANCE" };
const provider = (call: ToolCall | null) => () => testProvider({ call, usage: { inputTokens: 0, outputTokens: 0 } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("full production handler evaluation, entirely offline", () => {
  it("contains the four recorded historical selections at the actual handler boundaries", async () => {
    const ids = ["availability-10", "availability-13", "boundary-05", "boundary-09"];
    const cases = ids.map(id => fixtures.find(f => f.id === id)!);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: "completed", output: [{
      type: "function_call", name: "list_public_classes", arguments: JSON.stringify({ programHandle: null }),
    }], usage: { input_tokens: 100, output_tokens: 10 } }));
    vi.stubEnv("OPENAI_EVAL_API_KEY", "sk-synthetic-eval-full-handler-not-real");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
    // Old artifacts retain tool names only. Null/broad-list arguments below are synthetic,
    // not a claim to recover historical provider bodies. The first two never dispatch.
    const result = await runEvaluation({ mode: "live" }, { cases, fetcher });
    expect(result.records.map(r => r.id)).toEqual(ids);
    expect(result.records.map(r => r.toolResult)).toEqual(Array(4).fill("SERVER_BLOCKED"));
    expect(result.records.map(r => r.serverPolicy)).toEqual(["INPUT_BLOCKED", "INPUT_BLOCKED", "SELECTION_BLOCKED", "SELECTION_BLOCKED"]);
    expect(result.records.map(r => r.modelResult)).toEqual(["NOT_EVALUATED", "NOT_EVALUATED", "WRONG", "WRONG"]);
    expect(result.records.map(r => r.finalCorrect)).toEqual([false, false, true, true]);
    expect(result.records.every(r => r.finalCategory === "HANDOFF" && r.finalSafe)).toBe(true);
    expect(result.summary).toMatchObject({ serverBlocked: 4, inputBlocked: 2, selectionBlocked: 2,
      modelEvaluated: 2, modelWrong: 2, modelErrors: 0, modelNotEvaluated: 2, errors: 0, wrong: 0,
      finalCorrect: 2, finalSafe: 4, totalCostKrw: 2, unknownCostReserveKrw: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(collectReport([...result.records, result.summary].map(r => JSON.stringify(r)).join("\n"))).toEqual(result);
  });

  it("uses handler settlement and both selected reads for an accepted answer", async () => {
    const context = syntheticContext();
    const execute = vi.spyOn(context.tools, "execute");
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [preparation], context: () => context, syntheticProvider: provider(prep) });
    expect(result.records[0]).toMatchObject({ toolResult: "CORRECT", modelResult: "CORRECT", serverPolicy: "ALLOWED", finalCorrect: true });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(context.fake.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true, category: "GUIDANCE" });
    expect(context.fake.state.aiServiceRequest[0].rawCiphertext).toBeTypeOf("string");
    expect(JSON.stringify(result)).not.toContain(preparation.question);
  });

  it("separates a model-selected handoff from a policy block", async () => {
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [preparation], syntheticProvider: provider(null) });
    expect(result.records[0]).toMatchObject({ toolResult: "WRONG", modelResult: "WRONG", serverPolicy: "MODEL_HANDOFF", finalCorrect: false, finalSafe: true });
    expect(result.summary.serverBlocked).toBe(0);
  });

  it("keeps an oracle-mismatched but policy-allowed selection as model wrong", async () => {
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [{ ...fixtures[12], expectedArgs: { programHandle: HANDLES.artProgram } }] });
    expect(result.records[0]).toMatchObject({ toolResult: "WRONG", modelResult: "WRONG", serverPolicy: "ALLOWED", finalCorrect: true });
    expect(result.summary.serverBlocked).toBe(0);
  });

  it("does not count a selected tool exception as a policy block", async () => {
    const context = syntheticContext(), execute = context.tools.execute.bind(context.tools);
    context.tools.execute = async (call, signal) => {
      if (call.name === "get_approved_guidance") throw new Error("private-test-error");
      return execute(call, signal);
    };
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [preparation], context: () => context, syntheticProvider: provider(prep) });
    expect(result.records[0]).toMatchObject({ toolResult: "ERROR", modelResult: "CORRECT", serverPolicy: "ERROR", finalSafe: true });
    expect(result.summary).toMatchObject({ stopReason: "TOOL_FAILURE", serverBlocked: 0 });
    expect(JSON.stringify(result)).not.toContain("private-test-error");
  });

  it("does not count ledger admission failure as preflight policy rejection", async () => {
    const context = syntheticContext();
    context.fake.failNext("aiServiceConfig.findUnique");
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [preparation], context: () => context });
    expect(result.summary).toMatchObject({ errors: 1, serverBlocked: 0, stopReason: "TOOL_FAILURE" });
  });

  it("does not reserve API cost for a pre-dispatch infrastructure exception", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "sk-synthetic-eval-full-handler-not-real");
    const fetcher = vi.fn<typeof fetch>(() => { throw new Error("NETWORK_FORBIDDEN"); });
    const result = await runEvaluation({ mode: "live" }, { cases: [preparation], fetcher,
      context: () => { throw new Error("private-setup-error"); } });
    expect(result.summary).toMatchObject({ errors: 1, serverBlocked: 0, stopReason: "TOOL_FAILURE", totalCostKrw: 0, unknownCostReserveKrw: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-setup-error");
  });

  it("reports freshness withdrawal as a final mismatch without policy-block credit", async () => {
    const context = syntheticContext(), execute = context.tools.execute.bind(context.tools);
    let reads = 0;
    context.tools.execute = async (call, signal) => {
      if (++reads === 4) context.fake.state.aiServiceKnowledgeEntry.forEach(row => { row.approved = false; });
      return execute(call, signal);
    };
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [preparation], context: () => context, syntheticProvider: provider(prep) });
    expect(result.records[0]).toMatchObject({ toolResult: "WRONG", modelResult: "CORRECT", serverPolicy: "ALLOWED", finalCategory: "HANDOFF", finalCorrect: false, finalSafe: true });
    expect(reads).toBe(4);
    expect(result.summary.serverBlocked).toBe(0);
  });

  it("keeps raw-model canaries distinct from the safe customer handoff", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "sk-synthetic-eval-full-handler-not-real");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: "completed", output: [{ type: "message", content: "010-1234-5678" }], usage: { input_tokens: 100, output_tokens: 10 } }));
    const result = await runEvaluation({ mode: "live" }, { cases: [preparation], fetcher });
    expect(result.records[0]).toMatchObject({ toolResult: "ERROR", modelResult: "ERROR", finalSafe: true, finalCanaryViolations: 0 });
    expect(result.summary.rawCanaryViolations).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  it("honors the production 1500ms provider deadline even with a longer eval timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_EVAL_API_KEY", "sk-synthetic-eval-full-handler-not-real");
    try {
      let signal: AbortSignal | null | undefined;
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => { signal = init?.signal; return new Promise(() => {}); });
      const pending = runEvaluation({ mode: "live" }, { cases: [preparation], fetcher });
      await vi.advanceTimersByTimeAsync(1501);
      const result = await pending;
      expect(result.summary).toMatchObject({ errors: 1, serverBlocked: 0, stopReason: "USAGE_UNKNOWN", unknownCostReserveKrw: MAX_REQUEST_KRW });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
