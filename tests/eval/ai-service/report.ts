import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { billingUsageSchema } from "../../../server/ai-service/billing";
import { conservativeKrw } from "../../../server/ai-service/cost";
import { fixtures } from "./fixtures";
import { EVAL_PRICE } from "./valuation";

const ids = new Set(fixtures.map(f => f.id));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metric = z.number().finite().nonnegative();
const toolName = z.enum(["list_public_programs", "list_public_classes", "get_class_availability", "get_approved_guidance"]);
export const questionRecordSchema = z.object({
  type: z.literal("question"), id: z.string().refine(id => ids.has(id)), actualTool: toolName.nullable(),
  toolResult: z.enum(["CORRECT", "WRONG", "ERROR", "SERVER_BLOCKED"]), latencyMs: metric,
  modelResult: z.enum(["CORRECT", "WRONG", "ERROR", "NOT_EVALUATED"]),
  serverPolicy: z.enum(["INPUT_BLOCKED", "SELECTION_BLOCKED", "MODEL_HANDOFF", "ALLOWED", "ERROR"]),
  finalCategory: z.enum(["PROGRAMS", "CLASSES", "AVAILABILITY", "GUIDANCE", "HANDOFF"]),
  finalCorrect: z.boolean(), finalSafe: z.boolean(),
  rawCanaryViolations: count, finalCanaryViolations: count,
  usage: billingUsageSchema.nullable(), canaryPass: z.boolean(), canaryViolations: count,
}).strict().superRefine((v, ctx) => {
  if (v.canaryPass !== (v.canaryViolations === 0)) ctx.addIssue({ code: "custom", message: "INVALID_RECORD" });
  const blocked = v.serverPolicy === "INPUT_BLOCKED" || v.serverPolicy === "SELECTION_BLOCKED";
  if ((v.toolResult === "SERVER_BLOCKED") !== blocked
    || v.canaryViolations !== v.rawCanaryViolations + v.finalCanaryViolations
    || (blocked && v.finalCategory !== "HANDOFF")
    || (v.serverPolicy === "INPUT_BLOCKED" && (v.modelResult !== "NOT_EVALUATED" || v.usage !== null || v.actualTool !== null))
    || (v.serverPolicy === "SELECTION_BLOCKED" && (v.actualTool === null || v.usage === null || v.modelResult === "NOT_EVALUATED" || v.modelResult === "ERROR"))
    || (v.finalSafe && v.finalCanaryViolations > 0)) ctx.addIssue({ code: "custom", message: "INVALID_RECORD" });
});
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
export const modeSchema = z.enum(["synthetic", "live"]);
export type Mode = z.infer<typeof modeSchema>;
const stopReasonSchema = z.enum(["COMPLETE", "CANARY_LIMIT", "COST_CAP", "PROVIDER_FAILURE", "USAGE_UNKNOWN", "TOOL_FAILURE"]);
export type StopReason = z.infer<typeof stopReasonSchema>;
export const summarySchema = z.object({
  type: z.literal("summary"), mode: modeSchema, model: z.literal("gpt-6-luna"), stopReason: stopReasonSchema,
  questions: count, correct: count, wrong: count, errors: count,
  serverBlocked: count, inputBlocked: count, selectionBlocked: count,
  modelEvaluated: count, modelCorrect: count, modelWrong: count, modelErrors: count, modelNotEvaluated: count,
  modelAccuracyPercent: metric.max(100), finalCorrect: count, finalSafe: count,
  rawCanaryViolations: count, finalCanaryViolations: count,
  accuracyPercent: metric.max(100), p50LatencyMs: metric, p95LatencyMs: metric,
  inputTokens: count, outputTokens: count, canaryViolations: count, canaryFailedQuestions: count,
  totalCostKrw: count, unknownCostReserveKrw: count, costCapKrw: z.literal(300),
}).strict();
export type Summary = z.infer<typeof summarySchema>;
export type RunResult = { records: QuestionRecord[]; summary: Summary };

/** Nearest-rank percentiles, including failed questions; empty runs are zero. */
function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

export function aggregate(records: readonly QuestionRecord[], metadata: Pick<Summary, "mode" | "stopReason" | "totalCostKrw" | "unknownCostReserveKrw">): Summary {
  const parsed = z.array(questionRecordSchema).max(120).parse(records);
  if (new Set(parsed.map(r => r.id)).size !== parsed.length) throw new Error("EVAL_REPORT_INVALID");
  const calculatedCost = metadata.mode === "live" ? parsed.reduce((sum, row) => sum + (row.usage
    ? conservativeKrw(EVAL_PRICE, row.usage.inputTokens, row.usage.outputTokens) : 0), 0) : 0;
  if (calculatedCost !== metadata.totalCostKrw) throw new Error("EVAL_REPORT_INVALID");
  const correct = parsed.filter(r => r.toolResult === "CORRECT").length;
  return summarySchema.parse({
    type: "summary", ...metadata, model: "gpt-6-luna", costCapKrw: 300,
    questions: parsed.length, correct, wrong: parsed.filter(r => r.toolResult === "WRONG").length,
    errors: parsed.filter(r => r.toolResult === "ERROR").length,
    serverBlocked: parsed.filter(r => r.toolResult === "SERVER_BLOCKED").length,
    inputBlocked: parsed.filter(r => r.serverPolicy === "INPUT_BLOCKED").length,
    selectionBlocked: parsed.filter(r => r.serverPolicy === "SELECTION_BLOCKED").length,
    modelEvaluated: parsed.filter(r => r.modelResult !== "NOT_EVALUATED").length,
    modelCorrect: parsed.filter(r => r.modelResult === "CORRECT").length,
    modelWrong: parsed.filter(r => r.modelResult === "WRONG").length,
    modelErrors: parsed.filter(r => r.modelResult === "ERROR").length,
    modelNotEvaluated: parsed.filter(r => r.modelResult === "NOT_EVALUATED").length,
    modelAccuracyPercent: parsed.some(r => r.modelResult !== "NOT_EVALUATED") ? Math.round(parsed.filter(r => r.modelResult === "CORRECT").length / parsed.filter(r => r.modelResult !== "NOT_EVALUATED").length * 10000) / 100 : 0,
    finalCorrect: parsed.filter(r => r.finalCorrect).length, finalSafe: parsed.filter(r => r.finalSafe).length,
    rawCanaryViolations: parsed.reduce((sum, r) => sum + r.rawCanaryViolations, 0),
    finalCanaryViolations: parsed.reduce((sum, r) => sum + r.finalCanaryViolations, 0),
    accuracyPercent: parsed.length ? Math.round(correct / parsed.length * 10000) / 100 : 0,
    p50LatencyMs: percentile(parsed.map(r => r.latencyMs), 0.5), p95LatencyMs: percentile(parsed.map(r => r.latencyMs), 0.95),
    inputTokens: parsed.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: parsed.reduce((sum, r) => sum + (r.usage?.outputTokens ?? 0), 0),
    canaryViolations: parsed.reduce((sum, r) => sum + r.canaryViolations, 0),
    canaryFailedQuestions: parsed.filter(r => !r.canaryPass).length,
  });
}

export function humanReadable(summary: Summary): string {
  const s = summarySchema.parse(summary);
  return [
    `Mode: ${s.mode}; model: ${s.model}; stopped: ${s.stopReason}`,
    `Questions: ${s.questions}; correct: ${s.correct}; wrong: ${s.wrong}; errors: ${s.errors}`,
    `Server blocked: ${s.serverBlocked} (input ${s.inputBlocked}, selection ${s.selectionBlocked})`,
    `Model: ${s.modelCorrect}/${s.modelEvaluated} correct (${s.modelAccuracyPercent}%); wrong ${s.modelWrong}; errors ${s.modelErrors}; not evaluated ${s.modelNotEvaluated}`,
    `Final customer response: correct ${s.finalCorrect}/${s.questions}; safe ${s.finalSafe}/${s.questions}`,
    `Accuracy: ${s.accuracyPercent}%; P50: ${s.p50LatencyMs} ms; P95: ${s.p95LatencyMs} ms`,
    `Tokens: input ${s.inputTokens}, output ${s.outputTokens}`,
    `Conservative cost: ${s.totalCostKrw} KRW / ${s.costCapKrw} KRW; unknown-cost reserve: ${s.unknownCostReserveKrw} KRW`,
    `Canary violations: ${s.canaryViolations}; failed questions: ${s.canaryFailedQuestions}`,
    `Canary channels: raw model ${s.rawCanaryViolations}; final customer ${s.finalCanaryViolations}`,
  ].join("\n");
}

/** Accept only the runner's allowlisted JSONL contract, never echo untrusted input. */
export function collectReport(jsonl: string): RunResult {
  if (Buffer.byteLength(jsonl, "utf8") > 1024 * 1024) throw new Error("EVAL_REPORT_INVALID");
  const records: QuestionRecord[] = [];
  let final: Summary | undefined;
  const lines = jsonl.trim().split(/\r?\n/);
  if (lines.length > 121) throw new Error("EVAL_REPORT_INVALID");
  for (const line of lines) {
    const raw: unknown = JSON.parse(line);
    const row = questionRecordSchema.safeParse(raw);
    if (row.success && !final) { records.push(row.data); continue; }
    const summary = summarySchema.safeParse(raw);
    if (!summary.success || final) throw new Error("EVAL_REPORT_INVALID");
    final = summary.data;
  }
  if (!final) throw new Error("EVAL_REPORT_INVALID");
  const summary = aggregate(records, final);
  if (JSON.stringify(summary) !== JSON.stringify(summarySchema.parse(final))) throw new Error("EVAL_REPORT_INVALID");
  return { records, summary };
}

export async function reportMain(args: string[], write: (s: string) => void = s => process.stdout.write(s), error: (s: string) => void = s => process.stderr.write(s)): Promise<number> {
  try {
    if (args.length !== 1) throw new Error("INVALID_ARGUMENTS");
    const path = z.string().min(1).max(4096).parse(args[0]);
    if ((await stat(path)).size > 1024 * 1024) throw new Error("INVALID_FILE");
    const report = collectReport(await readFile(path, "utf8"));
    write(JSON.stringify(report) + "\n" + humanReadable(report.summary) + "\n");
    return 0;
  } catch {
    error("EVAL_REPORT_INVALID: expected one valid runner JSONL file.\n");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void reportMain(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
