import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { validatedBillingUsage, type BillingUsage } from "../../../server/ai-service/billing";
import { HANDOFF, handoffCallSchema, toolCallSchema, type ToolCall } from "../../../server/ai-service/contracts";
import { conservativeKrw, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from "../../../server/ai-service/cost";
import { openAiResponsesTransport } from "../../../server/ai-service/openai-transport";
import { openAiProvider, testProvider, type LlmProvider, type ProviderResult } from "../../../server/ai-service/provider";
import { type ToolResult } from "../../../server/ai-service/tools";
import { handleSkill } from "../../../server/ai-service/handler";
import { CATEGORIES, fixtures, type Fixture, type ReplyCategory } from "./fixtures";
import { aggregate, modeSchema, type Mode, type QuestionRecord, type RunResult, type StopReason } from "./report";
import { scriptedCall, syntheticContext, syntheticHandlerDependencies } from "./synthetic";
import { MODEL, COST_CAP_KRW, EVAL_PRICE, MAX_REQUEST_KRW } from "./valuation";

export { MODEL, COST_CAP_KRW, EVAL_PRICE, MAX_REQUEST_KRW } from "./valuation";
export const LIVE_TIMEOUT_MS = 15_000;
const optionsSchema = z.object({ mode: modeSchema, canary: z.number().int().min(1).max(120).optional() }).strict();
type Options = z.infer<typeof optionsSchema>;
const fixtureSchema = z.object({
  id: z.string().regex(/^(?:program|schedule|availability|guidance|scope|boundary)-\d{2}$/), category: z.enum(CATEGORIES),
  question: z.string().min(1).max(1000), expectedTool: z.enum(["list_public_programs", "list_public_classes", "get_class_availability", "get_approved_guidance"]).nullable(),
  expectedArgs: z.record(z.unknown()).nullable(), expectedReplyCategory: z.enum(["PROGRAMS", "CLASSES", "AVAILABILITY", "GUIDANCE", "HANDOFF"]),
  forbiddenCanaries: z.array(z.string().min(1).max(1000)).min(1).max(20),
}).strict().superRefine((f, ctx) => {
  if (f.expectedTool === null ? f.expectedArgs !== null || f.expectedReplyCategory !== "HANDOFF"
    : !toolCallSchema.safeParse({ name: f.expectedTool, args: f.expectedArgs }).success) {
    ctx.addIssue({ code: "custom", message: "INVALID_FIXTURE" });
  }
});

type Dependencies = {
  /** Tests inject in-memory HTTP, never another credential source or another model. */
  fetcher?: typeof fetch;
  cases?: readonly Fixture[];
  emit?: (row: QuestionRecord | RunResult["summary"]) => void;
  clock?: () => number;
  timeoutMs?: number;
  /** Offline-only test seams; fixtures never supply execution or classification expectations. */
  context?: typeof syntheticContext;
  syntheticProvider?: (question: string) => LlmProvider;
};
type Observation = { violations: Set<number>; semanticValid: boolean };
class ConfigurationError extends Error {
  constructor(readonly code: "EVAL_KEY_MISSING" | "EVAL_KEY_INVALID" | "EVAL_OPTIONS_INVALID") { super(code); }
}

export function canaryMatches(text: string, patterns: readonly string[]): number[] {
  return patterns.flatMap((source, index) => new RegExp(source, "iu").test(text) ? [index] : []);
}

/** Inspect only in memory. No raw response, arguments or prose leaves this function. */
function inspectRaw(raw: unknown, fixture: Fixture, observation: Observation) {
  const envelope = z.object({ status: z.string(), output: z.array(z.unknown()) }).passthrough().safeParse(raw);
  if (!envelope.success) { observation.semanticValid = false; return; }
  for (const match of canaryMatches(JSON.stringify(envelope.data.output), fixture.forbiddenCanaries)) observation.violations.add(match);
  // Function arguments and message text are JSON-escaped by the enclosing response.
  // Scan each string value too, so encoded JSON seat keys cannot evade detection.
  const scanStrings = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of canaryMatches(value, fixture.forbiddenCanaries)) observation.violations.add(match);
    } else if (Array.isArray(value)) value.forEach(scanStrings);
    else if (value && typeof value === "object") Object.values(value).forEach(scanStrings);
  };
  scanStrings(envelope.data.output);
  const output = envelope.data.output;
  observation.semanticValid = envelope.data.status === "completed" && output.length <= 1;
  if (!observation.semanticValid || !output.length) return;
  const call = z.object({ type: z.literal("function_call"), name: z.string(), arguments: z.string() }).passthrough().safeParse(output[0]);
  if (!call.success) { observation.semanticValid = false; return; }
  try {
    const args: unknown = JSON.parse(call.data.arguments);
    scanStrings(args);
    for (const match of canaryMatches(JSON.stringify(args), fixture.forbiddenCanaries)) observation.violations.add(match);
    const selected = { name: call.data.name, args };
    observation.semanticValid = toolCallSchema.safeParse(selected).success || handoffCallSchema.safeParse(selected).success;
  } catch { observation.semanticValid = false; }
}

async function boundedClassify(provider: LlmProvider, question: string, catalog: ToolResult[], timeoutMs: number, parentSignal: AbortSignal): Promise<ProviderResult> {
  const controller = new AbortController();
  let rejectAbort: (reason: Error) => void = () => {};
  const abort = () => { controller.abort(); rejectAbort(new Error("EVAL_TIMEOUT")); };
  parentSignal.addEventListener("abort", abort, { once: true });
  if (parentSignal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.classify({ utterance: question, catalog, signal: controller.signal }),
      new Promise<never>((_, reject) => { rejectAbort = reject; }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("EVAL_TIMEOUT")); }, timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); parentSignal.removeEventListener("abort", abort); controller.abort(); }
}

export async function runEvaluation(input: Options, dependencies: Dependencies = {}): Promise<RunResult> {
  const options = optionsSchema.safeParse(input);
  const parsedCases = z.array(fixtureSchema).min(1).max(120).safeParse(dependencies.cases ?? fixtures);
  const timeout = z.number().int().positive().max(LIVE_TIMEOUT_MS).safeParse(dependencies.timeoutMs ?? LIVE_TIMEOUT_MS);
  if (!options.success || !parsedCases.success || !timeout.success) throw new ConfigurationError("EVAL_OPTIONS_INVALID");
  const allCases = parsedCases.data as Fixture[];
  if (new Set(allCases.map(f => f.id)).size !== allCases.length) throw new ConfigurationError("EVAL_OPTIONS_INVALID");
  for (const fixture of allCases) {
    try { fixture.forbiddenCanaries.forEach(pattern => new RegExp(pattern, "iu")); }
    catch { throw new ConfigurationError("EVAL_OPTIONS_INVALID"); }
  }
  const { mode, canary } = options.data;
  // Credential validation precedes transport construction, catalog construction, and dispatch.
  let transport: ReturnType<typeof openAiResponsesTransport> | undefined;
  if (mode === "live") {
    const apiKey = process.env.OPENAI_EVAL_API_KEY;
    if (!apiKey) throw new ConfigurationError("EVAL_KEY_MISSING");
    try { transport = openAiResponsesTransport(apiKey, dependencies.fetcher ?? fetch); }
    catch { throw new ConfigurationError("EVAL_KEY_INVALID"); }
  }
  const records: QuestionRecord[] = [];
  let totalCostKrw = 0, unknownCostReserveKrw = 0;
  let stopReason: StopReason = canary !== undefined && canary < allCases.length ? "CANARY_LIMIT" : "COMPLETE";
  const clock = dependencies.clock ?? (() => performance.now());
  for (const fixture of allCases.slice(0, canary ?? allCases.length)) {
    // Reserve the maximum bounded request BEFORE dispatch, not merely the last actual usage.
    if (mode === "live" && totalCostKrw + MAX_REQUEST_KRW > COST_CAP_KRW) { stopReason = "COST_CAP"; break; }
    const observation: Observation = { violations: new Set(), semanticValid: true };
    const provider = mode === "synthetic" ? dependencies.syntheticProvider?.(fixture.question) ?? testProvider({ call: scriptedCall(fixture.question), usage: { inputTokens: 0, outputTokens: 0 } })
      : openAiProvider(MODEL, async (body, requestSignal) => {
        const raw: unknown = await transport!(body, requestSignal);
        inspectRaw(raw, fixture, observation);
        return raw;
      });
    const start = clock();
    let usage: BillingUsage | null = null;
    const model: { call: ToolCall | null; result: QuestionRecord["modelResult"] } = { call: null, result: "NOT_EVALUATED" };
    let toolResult: QuestionRecord["toolResult"] = "ERROR";
    let serverPolicy: QuestionRecord["serverPolicy"] = "ERROR";
    let finalCategory: ReplyCategory = "HANDOFF", finalCorrect = false, finalSafe = false;
    let finalCanaryViolations = 0;
    let modelDispatched = false, modelCompleted = false, selectedReads = 0, toolFailed = false;
    let fatal: StopReason | undefined;
    try {
      const context = (dependencies.context ?? syntheticContext)();
      const deps = syntheticHandlerDependencies(context, () => ({
        // The fake ledger uses TEST_DOUBLE even when the injected transport models OPENAI.
        id: "TEST_DOUBLE",
        async classify(request) {
          modelDispatched = true;
          try {
            const result = await boundedClassify(provider, request.utterance, request.catalog ?? [], timeout.data, request.signal);
            usage = validatedBillingUsage(result.usage);
            if (mode === "live") totalCostKrw += conservativeKrw(EVAL_PRICE, usage.inputTokens, usage.outputTokens);
            model.call = structuredClone(result.call);
            modelCompleted = true;
            if (!observation.semanticValid || usage.inputTokens > MAX_INPUT_TOKENS || usage.outputTokens > MAX_OUTPUT_TOKENS) {
              fatal = "PROVIDER_FAILURE"; model.result = "ERROR";
            } else model.result = (model.call?.name ?? null) === fixture.expectedTool && isDeepStrictEqual(model.call?.args ?? null, fixture.expectedArgs) ? "CORRECT" : "WRONG";
            return result;
          } catch {
            model.result = "ERROR";
            if (mode === "live" && usage === null) { unknownCostReserveKrw = MAX_REQUEST_KRW; fatal = "USAGE_UNKNOWN"; }
            else fatal = "PROVIDER_FAILURE";
            throw new Error("EVAL_PROVIDER_FAILED");
          }
        },
      }));
      deps.tools = { async execute(selection, signal) {
        if (modelCompleted) selectedReads++;
        try { return await context.tools.execute(selection, signal); }
        catch { toolFailed = true; throw new Error("EVAL_TOOL_FAILED"); }
      } };
      const response = await handleSkill(new Headers({ "x-yaho-skill-key": deps.secret }), JSON.stringify({
        bot: { id: deps.botId }, userRequest: { utterance: fixture.question, user: { id: "synthetic-eval-subject" } },
        action: { id: "synthetic-eval-action", name: "synthetic" },
      }), "synthetic-eval-request-" + fixture.id, deps);
      const reply = response.template.outputs[0].simpleText.text;
      const ledger = context.fake.state.aiServiceRequest[0];
      const category = z.enum(["PROGRAMS", "CLASSES", "AVAILABILITY", "GUIDANCE"]).safeParse(ledger?.category);
      finalCategory = reply === HANDOFF ? "HANDOFF" : category.success ? category.data : "HANDOFF";
      const finalViolations = canaryMatches(reply, fixture.forbiddenCanaries);
      finalCanaryViolations = finalViolations.length;
      finalCorrect = finalCategory === fixture.expectedReplyCategory;
      finalSafe = finalViolations.length === 0 && (fixture.expectedTool !== null || reply === HANDOFF);
      if (toolFailed) fatal = "TOOL_FAILURE";
      // Evidence comes from the actual handler: preflight creates no ledger, selection denial
      // settles usage but never reaches a selected tool. A failing read is never policy credit.
      serverPolicy = fatal ? "ERROR" : !modelDispatched && !ledger && context.fake.operations.length === 0 && reply === HANDOFF ? "INPUT_BLOCKED"
        : modelCompleted && ledger?.status === "SETTLED" && model.call !== null && selectedReads === 0 && reply === HANDOFF ? "SELECTION_BLOCKED"
        : modelCompleted && ledger?.status === "SETTLED" ? model.call === null ? "MODEL_HANDOFF" : "ALLOWED" : "ERROR";
      if (serverPolicy === "ERROR" && !fatal) fatal = "TOOL_FAILURE";
      toolResult = fatal ? "ERROR" : serverPolicy === "INPUT_BLOCKED" || serverPolicy === "SELECTION_BLOCKED" ? "SERVER_BLOCKED"
        : model.result === "CORRECT" && finalCorrect ? "CORRECT" : "WRONG";
    } catch {
      if (mode === "live" && modelDispatched && usage === null) { unknownCostReserveKrw = MAX_REQUEST_KRW; fatal = "USAGE_UNKNOWN"; }
      else fatal = "TOOL_FAILURE";
    }
    const row: QuestionRecord = {
      type: "question", id: fixture.id, actualTool: model.call?.name ?? null, toolResult,
      modelResult: model.result, serverPolicy, finalCategory, finalCorrect, finalSafe,
      rawCanaryViolations: observation.violations.size, finalCanaryViolations,
      latencyMs: Math.max(0, Math.round((clock() - start) * 100) / 100), usage,
      canaryPass: observation.violations.size + finalCanaryViolations === 0, canaryViolations: observation.violations.size + finalCanaryViolations,
    };
    records.push(row);
    dependencies.emit?.(row);
    if (fatal) { stopReason = fatal; break; }
    if (mode === "live" && totalCostKrw >= COST_CAP_KRW) { stopReason = "COST_CAP"; break; }
  }
  const summary = aggregate(records, { mode, stopReason, totalCostKrw, unknownCostReserveKrw });
  dependencies.emit?.(summary);
  return { records, summary };
}

export function parseArguments(args: string[]): Options {
  let mode: Mode = "synthetic", canary: number | undefined;
  let modeSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "live" || arg === "synthetic") && !modeSeen) { mode = arg; modeSeen = true; }
    else if (arg === "--canary" && canary === undefined && /^\d+$/.test(args[i + 1] ?? "")) canary = Number(args[++i]);
    else throw new ConfigurationError("EVAL_OPTIONS_INVALID");
  }
  const parsed = optionsSchema.safeParse({ mode, ...(canary === undefined ? {} : { canary }) });
  if (!parsed.success) throw new ConfigurationError("EVAL_OPTIONS_INVALID");
  return parsed.data;
}

export async function runnerMain(args: string[], dependencies: Dependencies = {}, write: (text: string) => void = text => process.stdout.write(text), error: (text: string) => void = text => process.stderr.write(text)): Promise<number> {
  try {
    const result = await runEvaluation(parseArguments(args), { ...dependencies, emit: row => write(JSON.stringify(row) + "\n") });
    return ["PROVIDER_FAILURE", "USAGE_UNKNOWN", "TOOL_FAILURE"].includes(result.summary.stopReason)
      || result.summary.finalCorrect !== result.summary.questions || result.summary.wrong > 0 || result.summary.canaryViolations > 0 ? 1 : 0;
  } catch (caught) {
    error(caught instanceof ConfigurationError ? {
      EVAL_KEY_MISSING: "EVAL_KEY_MISSING: live mode requires OPENAI_EVAL_API_KEY; no request was sent.\n",
      EVAL_KEY_INVALID: "EVAL_KEY_INVALID: invalid evaluation credential; no request was sent.\n",
      EVAL_OPTIONS_INVALID: "EVAL_OPTIONS_INVALID: use [synthetic|live] [--canary 1..120].\n",
    }[caught.code] : "EVAL_FAILED: evaluation stopped.\n");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runnerMain(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
