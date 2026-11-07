import { afterEach, describe, expect, it, vi } from "vitest";
import { conservativeKrw, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from "../../../server/ai-service/cost";
import { CATEGORIES, fixtures, FORBIDDEN_CANARIES, HANDLES } from "./fixtures";
import { collectReport, humanReadable, aggregate, reportMain } from "./report";
import { canaryMatches, COST_CAP_KRW, EVAL_PRICE, MAX_REQUEST_KRW, parseArguments, runEvaluation, runnerMain } from "./runner";
import { scriptedCall, syntheticContext } from "./synthetic";

const fakeKey = "sk-synthetic-eval-not-a-real-key";
const call = { type: "function_call", name: "list_public_programs", arguments: "{}" };
function envelope(output: unknown[] = [call], usage: unknown = { input_tokens: 100, output_tokens: 10 }) {
  return { status: "completed", output, usage };
}
function fakeFetch(response: unknown = envelope()) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } }));
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("manually authored synthetic fixtures", () => {
  it("contains exactly 120 unique Korean questions with the required distribution", () => {
    expect(fixtures).toHaveLength(120);
    expect(new Set(fixtures.map(f => f.id)).size).toBe(120);
    expect(new Set(fixtures.map(f => f.question)).size).toBe(120);
    expect(CATEGORIES.map(c => fixtures.filter(f => f.category === c).length)).toEqual([12, 16, 16, 24, 24, 28]);
    for (const fixture of fixtures) {
      expect(fixture.question).toMatch(/[가-힣]/);
      expect(fixture.forbiddenCanaries.length).toBeGreaterThanOrEqual(3);
      if (["out_of_scope", "boundary_adversarial"].includes(fixture.category)) {
        expect(fixture.expectedTool).toBeNull();
        expect(fixture.expectedArgs).toBeNull();
        expect(fixture.expectedReplyCategory).toBe("HANDOFF");
      }
    }
    const topics = fixtures.filter(f => f.category === "approved_guidance").map(f => f.expectedArgs);
    for (const topic of ["PREPARATION", "RAIN", "POLICY"]) expect(topics.filter(a => "topic" in a! && a.topic === topic)).toHaveLength(8);
  });
  it.each([
    "010-1234-5678", "02 123 4567", "+82 10-1234-5678", "synthetic@example.invalid",
    "남은 자리는 3명", "잔여석: 3", "남은 좌석은 3", "8자리", "두 자리", "정원: 8",
    '{"remainingSeats":3}', '{"capacity":8}', '{"seat_count":2}',
  ])("detects a forbidden canary variant: %s", text => {
    expect(canaryMatches(text, FORBIDDEN_CANARIES).length).toBeGreaterThan(0);
  });
  it.each(["2026. 10. 17. 오전 10:00 합성 숲 입구", "신청 가능합니다.", "담당자에게 문의해 주세요."])("allows safe schedule/status text: %s", text => {
    expect(canaryMatches(text, FORBIDDEN_CANARIES)).toEqual([]);
  });
});

describe("offline evaluation runner", () => {
  it("executes all fixtures with testProvider and fakeDb, without network or API credentials", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "");
    const forbiddenFetch = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
    vi.stubGlobal("fetch", forbiddenFetch);
    const result = await runEvaluation({ mode: "synthetic" });
    expect(result.records).toHaveLength(120);
    expect(result.records.filter(r => r.toolResult === "WRONG" || r.toolResult === "ERROR")).toEqual([]);
    expect(result.summary).toMatchObject({ mode: "synthetic", modelAccuracyPercent: 100, totalCostKrw: 0,
      canaryViolations: 0, inputTokens: 0, outputTokens: 0, stopReason: "COMPLETE" });
    expect(result.summary.serverBlocked).toBeGreaterThan(0);
    expect(result.summary.finalSafe).toBe(120);
    expect(result.summary.finalCorrect).toBeLessThan(120);
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
  it("does not read expected outputs to generate actual tools or arguments", async () => {
    const wrongOracle = { ...fixtures[0], expectedTool: "get_approved_guidance" as const, expectedArgs: { topic: "RAIN" as const }, expectedReplyCategory: "GUIDANCE" as const };
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [wrongOracle] });
    expect(result.records[0]).toMatchObject({ actualTool: "list_public_programs", toolResult: "WRONG" });
    expect(result.summary.accuracyPercent).toBe(0);
  });
  it("compares arguments, not just the selected tool name", async () => {
    const wrongArgs = { ...fixtures[12], expectedArgs: { programHandle: HANDLES.artProgram } };
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [wrongArgs] });
    expect(result.records[0].actualTool).toBe("list_public_classes");
    expect(result.records[0].toolResult).toBe("WRONG");
  });
  it("compares the grounded reply category", async () => {
    const wrongReply = { ...fixtures[0], expectedReplyCategory: "CLASSES" as const };
    const result = await runEvaluation({ mode: "synthetic" }, { cases: [wrongReply] });
    expect(result.records[0].toolResult).toBe("WRONG");
  });
  it("canary N executes only the first N questions and reports", async () => {
    const result = await runEvaluation({ mode: "synthetic", canary: 3 });
    expect(result.records.map(r => r.id)).toEqual(fixtures.slice(0, 3).map(f => f.id));
    expect(result.summary.stopReason).toBe("CANARY_LIMIT");
  });
  it("measures monotonic per-question latency and nearest-rank percentiles", async () => {
    let tick = 0;
    const result = await runEvaluation({ mode: "synthetic", canary: 3 }, { clock: () => { tick += 10; return tick; } });
    expect(result.records.map(r => r.latencyMs)).toEqual([10, 10, 10]);
    expect(result.summary).toMatchObject({ p50LatencyMs: 10, p95LatencyMs: 10 });
  });
  it("scripted behavior and tool catalog are independent from fixture labels", async () => {
    expect(scriptedCall("예약 취소해 줘")).toBeNull();
    expect(scriptedCall("준비물이 궁금해요")).toEqual({ name: "get_approved_guidance", args: { topic: "PREPARATION" } });
    const { tools } = syntheticContext();
    const result = await tools.execute({ name: "get_class_availability", args: { classHandle: HANDLES.artClass } }, new AbortController().signal);
    expect(result).toEqual({ kind: "AVAILABILITY", status: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("reservations");
    expect(JSON.stringify(result)).not.toContain("capacity");
  });
  it.each([0, -1, 121, 1.5, NaN])("rejects invalid canary before dispatch: %s", async canary => {
    const fetcher = fakeFetch();
    await expect(runEvaluation({ mode: "synthetic", canary }, { fetcher })).rejects.toThrow("EVAL_OPTIONS_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects duplicate IDs and invalid regexes before dispatch", async () => {
    await expect(runEvaluation({ mode: "synthetic" }, { cases: [fixtures[0], fixtures[0]] })).rejects.toThrow("EVAL_OPTIONS_INVALID");
    await expect(runEvaluation({ mode: "synthetic" }, { cases: [{ ...fixtures[0], forbiddenCanaries: ["["] }] })).rejects.toThrow("EVAL_OPTIONS_INVALID");
  });
});

describe("live safeguards using only in-memory fake HTTP", () => {
  it("requires ONLY the evaluation key, ignoring production credentials and making zero calls", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", fakeKey);
    const fetcher = fakeFetch();
    const out: string[] = [], errors: string[] = [];
    expect(await runnerMain(["live", "--canary", "1"], { fetcher }, s => out.push(s), s => errors.push(s))).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(errors.join("")).toContain("EVAL_KEY_MISSING");
    expect(errors.join("")).not.toContain(fakeKey);
  });
  it("rejects invalid evaluation credentials before dispatch", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", "short");
    const fetcher = fakeFetch();
    await expect(runEvaluation({ mode: "live" }, { fetcher })).rejects.toThrow("EVAL_KEY_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the existing Responses transport with the fixed model and bounded request", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = fakeFetch();
    const output: string[] = [];
    const code = await runnerMain(["live", "--canary", "1"], { fetcher }, s => output.push(s));
    expect(code).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer " + fakeKey });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "gpt-6-luna", max_output_tokens: MAX_OUTPUT_TOKENS, store: false, parallel_tool_calls: false });
    expect(JSON.stringify(body)).not.toContain(fakeKey);
    expect(output.join("")).not.toContain(fakeKey);
    expect(output.join("")).not.toContain(fixtures[0].question);
    expect(collectReport(output.join("")).summary).toMatchObject({ inputTokens: 100, outputTokens: 10, accuracyPercent: 100, totalCostKrw: 1 });
  });
  it("stops exactly at the 300 KRW cap and never retries or dispatches another question", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = fakeFetch(envelope([], { input_tokens: MAX_INPUT_TOKENS, output_tokens: MAX_OUTPUT_TOKENS }));
    const result = await runEvaluation({ mode: "live" }, { fetcher, cases: fixtures.map(f => ({ ...f, question: fixtures[0].question })) });
    expect(MAX_REQUEST_KRW).toBe(3);
    expect(result.summary).toMatchObject({ stopReason: "COST_CAP", totalCostKrw: COST_CAP_KRW });
    expect(fetcher).toHaveBeenCalledTimes(100);
  });
  it("reserves worst-case cost before a request when actual cost has not yet reached the cap", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = fakeFetch(envelope([], { input_tokens: MAX_INPUT_TOKENS, output_tokens: MAX_OUTPUT_TOKENS }));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(envelope([], { input_tokens: 5000, output_tokens: 0 })), { headers: { "content-type": "application/json" } }));
    expect(conservativeKrw(EVAL_PRICE, 5000, 0)).toBe(2);
    const result = await runEvaluation({ mode: "live" }, { fetcher, cases: fixtures.map(f => ({ ...f, question: fixtures[0].question })) });
    expect(result.summary).toMatchObject({ stopReason: "COST_CAP", totalCostKrw: 299 });
    expect(result.summary.totalCostKrw + MAX_REQUEST_KRW).toBeGreaterThan(COST_CAP_KRW);
    expect(fetcher).toHaveBeenCalledTimes(100);
  });
  it.each([
    { status: "completed", output: [], usage: undefined }, { status: "completed", output: [] },
    envelope([], { input_tokens: -1, output_tokens: 0 }),
    envelope([], { input_tokens: 100, output_tokens: 1, total_tokens: 999 }),
  ])("fails closed on missing or invalid usage, accounting for the uncertain request", async raw => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = fakeFetch(raw);
    const result = await runEvaluation({ mode: "live" }, { fetcher });
    expect(result.summary).toMatchObject({ stopReason: "USAGE_UNKNOWN", unknownCostReserveKrw: MAX_REQUEST_KRW, errors: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never retries an HTTP failure and never exposes an error body or secret", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = vi.fn<typeof fetch>(async () => new Response("PRIVATE_BODY " + fakeKey, { status: 429 }));
    const output: string[] = [];
    const code = await runnerMain(["live"], { fetcher }, s => output.push(s), s => output.push(s));
    expect(code).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(output.join("")).not.toMatch(/PRIVATE_BODY|sk-synthetic/);
    expect(collectReport(output.join("")).summary.stopReason).toBe("USAGE_UNKNOWN");
  });
  it("bounds a hanging fetch, aborts its signal and stops after one request", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { signal = init?.signal; return new Promise<Response>(() => {}); });
    const result = await runEvaluation({ mode: "live" }, { fetcher, timeoutMs: 10 });
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.summary.stopReason).toBe("USAGE_UNKNOWN");
  });
  it.each([
    [{ type: "message", content: [{ type: "output_text", text: "연락처 010-1234-5678 synthetic@example.invalid" }] }],
    [{ type: "function_call", name: "get_class_availability", arguments: '{"classHandle":"eval-class-saturday","remainingSeats":3}' }],
    [{ type: "function_call", name: "get_class_availability", arguments: String.raw`{"classHandle":"\u0030\u0031\u0030-1234-5678","injected":true}` }],
  ])("detects raw canaries before provider normalization, without logging any body", async (...items) => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const fetcher = fakeFetch(envelope(items));
    const output: string[] = [];
    await runnerMain(["live"], { fetcher }, s => output.push(s));
    const result = collectReport(output.join(""));
    expect(result.records[0]).toMatchObject({ toolResult: "ERROR", canaryPass: false });
    expect(result.summary.canaryViolations).toBeGreaterThan(0);
    expect(result.summary.totalCostKrw).toBe(1);
    expect(result.summary.stopReason).toBe("PROVIDER_FAILURE");
    expect(output.join("")).not.toMatch(/010-1234|example.invalid|remainingSeats/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not score malformed output as a successful no-tool handoff", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const scope = fixtures.find(f => f.category === "out_of_scope")!;
    const fetcher = fakeFetch(envelope([{ type: "function_call", name: "private_sql", arguments: "{}" }]));
    const result = await runEvaluation({ mode: "live" }, { fetcher, cases: [scope] });
    expect(result.records[0].toolResult).toBe("ERROR");
    expect(result.summary).toMatchObject({ accuracyPercent: 0, errors: 1, totalCostKrw: 1 });
  });
  it("valid no-tool output is a successful handoff for out-of-scope input", async () => {
    vi.stubEnv("OPENAI_EVAL_API_KEY", fakeKey);
    const scope = fixtures.find(f => f.category === "out_of_scope")!;
    const result = await runEvaluation({ mode: "live" }, { fetcher: fakeFetch(envelope([])), cases: [scope] });
    expect(result.summary).toMatchObject({ accuracyPercent: 100, errors: 0 });
  });
});

describe("structured result collection and CLI contracts", () => {
  it("produces validated JSON and human-readable metrics", async () => {
    const lines: string[] = [];
    expect(await runnerMain(["synthetic", "--canary", "2"], {}, s => lines.push(s))).toBe(0);
    const report = collectReport(lines.join(""));
    expect(report.summary).toMatchObject({ questions: 2, accuracyPercent: 100, canaryViolations: 0 });
    expect(humanReadable(report.summary)).toContain("Accuracy: 100%");
    expect(humanReadable(report.summary)).toContain("Conservative cost: 0 KRW / 300 KRW");
    const records = report.records.map((r, i) => ({ ...r, latencyMs: (i + 1) * 10 }));
    expect(aggregate(records, report.summary)).toMatchObject({ p50LatencyMs: 10, p95LatencyMs: 20 });
  });
  it("rejects untrusted IDs, extra fields, forged metrics, duplicate records and incomplete JSONL", async () => {
    const lines: string[] = [];
    await runnerMain(["--canary", "1"], {}, s => lines.push(s));
    const row = JSON.parse(lines[0]), summary = JSON.parse(lines[1]);
    for (const invalid of [
      JSON.stringify({ ...row, id: fakeKey }) + "\n" + lines[1],
      JSON.stringify({ ...row, rawBody: fakeKey }) + "\n" + lines[1],
      lines[0] + JSON.stringify({ ...summary, accuracyPercent: 0 }),
      lines[0] + lines[0] + lines[1], lines[0], lines[1] + lines[0],
      lines[0] + JSON.stringify({ ...summary, model: fakeKey }),
    ]) expect(() => collectReport(invalid)).toThrow();
  });
  it("prints only a generic report CLI error on an invalid input filename", async () => {
    const output: string[] = [];
    expect(await reportMain(["/tmp/nonexistent-" + fakeKey], s => output.push(s), s => output.push(s))).toBe(1);
    expect(output.join("")).toBe("EVAL_REPORT_INVALID: expected one valid runner JSONL file.\n");
  });
  it.each([[], ["synthetic"], ["--canary", "2"], ["live", "--canary", "120"]].map(args => ({ args })))("parses supported CLI arguments $args", ({ args }) => {
    expect(parseArguments(args).mode).toBe(args[0] === "live" ? "live" : "synthetic");
  });
  it.each([["--model", "other"], ["--canary", "0"], ["--canary", "1.5"], ["--canary", "1", "--canary", "1"], ["live", "synthetic"], ["--api-key", fakeKey]].map(args => ({ args })))("rejects unsupported CLI arguments $args", ({ args }) => {
    expect(() => parseArguments(args)).toThrow("EVAL_OPTIONS_INVALID");
  });
});
