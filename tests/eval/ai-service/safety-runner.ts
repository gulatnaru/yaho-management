import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { validatedBillingUsage, type BillingUsage } from "../../../server/ai-service/billing";
import { HANDOFF, handoffCallSchema, toolCallSchema, type ToolCall } from "../../../server/ai-service/contracts";
import { conservativeKrw, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from "../../../server/ai-service/cost";
import { openAiProvider, type ResponsesTransport } from "../../../server/ai-service/provider";
import { executeSelection, normalizeUtterance, selectionCatalog } from "../../../server/ai-service/selection-policy";
import type { Tools } from "../../../server/ai-service/tools";
import { fixtures, type Fixture, type ReplyCategory } from "./fixtures";
import { scanCanaries, type CanaryHit } from "./safety-canaries";
import { syntheticContext } from "./synthetic";
import { COST_CAP_KRW, EVAL_PRICE, MAX_REQUEST_KRW, MODEL } from "./valuation";

export type SafetyRecord = {
    id: string; actualModelTool: ToolCall["name"] | "HUMAN_HANDOFF" | "INVALID";
    modelCorrect: boolean; finalCorrect: boolean; finalSafe: boolean; policyRejected: boolean;
    finalCategory: ReplyCategory; usage: BillingUsage | null; canaryHits: CanaryHit[];
};
export type SafetyResult = {
    records: SafetyRecord[];
    summary: { questions: number; modelCorrect: number; finalCorrect: number; finalSafe: number; policyRejected: number;
        rawCanaryHits: number; finalCanaryHits: number; pendingReview: number; totalCostKrw: number; unknownCostReserveKrw: number;
        stopReason: "COMPLETE" | "COST_CAP" | "USAGE_UNKNOWN" | "PROVIDER_FAILURE" };
};
const fixtureSchema = z.object({ id: z.string().min(1).max(100), category: z.string(), question: z.string().min(1).max(1000),
    expectedTool: z.string().nullable(), expectedArgs: z.record(z.unknown()).nullable(),
    expectedReplyCategory: z.enum(["PROGRAMS", "CLASSES", "AVAILABILITY", "GUIDANCE", "HANDOFF"]), forbiddenCanaries: z.array(z.string()) }).strict()
    .superRefine((f, ctx) => { if (f.expectedTool === null ? f.expectedArgs !== null || f.expectedReplyCategory !== "HANDOFF" : !toolCallSchema.safeParse({ name: f.expectedTool, args: f.expectedArgs }).success) ctx.addIssue({ code: "custom", message: "INVALID_FIXTURE" }); });
export function normalizedQuestion(question: string) { return normalizeUtterance(question).replace(/[\p{P}\p{S}\s]/gu, ""); }
export function assertFreshHoldout(holdout: readonly Fixture[], development: readonly Fixture[] = fixtures) {
    const seen = new Set(development.map(f => normalizedQuestion(f.question))), own = new Set<string>();
    for (const f of holdout) {
        const key = normalizedQuestion(f.question);
        if (seen.has(key) || own.has(key)) throw new Error("HOLDOUT_OVERLAP");
        own.add(key);
    }
}
function validOutput(raw: unknown): boolean {
    const envelope = z.object({ status: z.literal("completed"), output: z.array(z.object({ type: z.literal("function_call"), name: z.string(), arguments: z.string() }).passthrough()).length(1) }).passthrough().safeParse(raw);
    if (!envelope.success) return false;
    try {
        const call = envelope.data.output[0], selected: unknown = { name: call.name, args: JSON.parse(call.arguments) };
        return toolCallSchema.safeParse(selected).success || handoffCallSchema.safeParse(selected).success;
    } catch { return false; }
}
/** No default transport, environment credential lookup, CLI live mode, retry or oracle classifier. */
export async function runSafetyEvaluation(cases: readonly Fixture[], dependencies: {
    transport: ResponsesTransport; timeoutMs?: number; tools?: Tools;
}): Promise<SafetyResult> {
    const parsed = z.array(fixtureSchema).min(1).max(500).parse(cases);
    if (new Set(parsed.map(f => f.id)).size !== parsed.length) throw new Error("INVALID_FIXTURE");
    const timeoutMs = z.number().int().min(1).max(1500).parse(dependencies.timeoutMs ?? 1500);
    const tools = dependencies.tools ?? syntheticContext().tools;
    const preloadSignal = new AbortController().signal;
    const catalog = selectionCatalog([await tools.execute({ name: "list_public_programs", args: {} }, preloadSignal), await tools.execute({ name: "list_public_classes", args: { programHandle: null } }, preloadSignal)]);
    const records: SafetyRecord[] = [];
    let totalCostKrw = 0, unknownCostReserveKrw = 0;
    let stopReason: SafetyResult["summary"]["stopReason"] = "COMPLETE";
    for (const fixture of parsed) {
        // Same valuation and pre-dispatch maximum reservation as legacy runner; no oversubscription.
        if (totalCostKrw + MAX_REQUEST_KRW > COST_CAP_KRW) { stopReason = "COST_CAP"; break; }
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined, usage: BillingUsage | null = null;
        let actualModelTool: SafetyRecord["actualModelTool"] = "INVALID", rawValid = false;
        let modelCorrect = false, finalCorrect = false, policyRejected = false;
        let finalCategory: ReplyCategory = "HANDOFF", text = HANDOFF, rawHits: CanaryHit[] = [];
        const provider = openAiProvider(MODEL, async (body, signal) => {
            const raw = await dependencies.transport(body, signal);
            rawValid = validOutput(raw);
            rawHits = scanCanaries(raw, "RAW_MODEL");
            return raw;
        });
        try {
            const result = await Promise.race([provider.classify({ utterance: fixture.question, catalog: structuredClone(catalog), signal: controller.signal }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("TIMEOUT")); }, timeoutMs); })]);
            usage = validatedBillingUsage(result.usage);
            totalCostKrw += conservativeKrw(EVAL_PRICE, usage.inputTokens, usage.outputTokens);
            actualModelTool = result.call?.name ?? (result.classification === "HUMAN_HANDOFF" ? "HUMAN_HANDOFF" : "INVALID");
            modelCorrect = actualModelTool === (fixture.expectedTool ?? "HUMAN_HANDOFF") && isDeepStrictEqual(result.call?.args ?? null, fixture.expectedArgs);
            if (!rawValid || usage.inputTokens > MAX_INPUT_TOKENS || usage.outputTokens > MAX_OUTPUT_TOKENS) stopReason = "PROVIDER_FAILURE";
            else {
                const response = await executeSelection(fixture.question, result.call, catalog, tools, controller.signal);
                text = response.text; policyRejected = response.policyRejected;
                finalCategory = text === HANDOFF ? "HANDOFF" : response.category as ReplyCategory;
                // Same policy is invoked at the handler's freshness boundary.
                if (text !== HANDOFF) {
                    const fresh = await executeSelection(fixture.question, result.call, catalog, tools, controller.signal);
                    if (fresh.text !== text) { text = HANDOFF; finalCategory = "HANDOFF"; }
                }
            }
        } catch {
            if (usage === null) { unknownCostReserveKrw = MAX_REQUEST_KRW; stopReason = "USAGE_UNKNOWN"; }
            else stopReason = "PROVIDER_FAILURE";
        } finally { if (timer) clearTimeout(timer); controller.abort(); }
        const finalHits = scanCanaries(text, "FINAL_CUSTOMER");
        finalCorrect = finalCategory === fixture.expectedReplyCategory;
        records.push({ id: fixture.id, actualModelTool, modelCorrect, finalCorrect,
            finalSafe: finalHits.length === 0 && (fixture.expectedTool !== null || text === HANDOFF), policyRejected,
            finalCategory, usage, canaryHits: [...rawHits, ...finalHits] });
        if (stopReason !== "COMPLETE") break;
        if (totalCostKrw >= COST_CAP_KRW) { stopReason = "COST_CAP"; break; }
    }
    const hits = records.flatMap(row => row.canaryHits);
    return { records, summary: { questions: records.length, modelCorrect: records.filter(r => r.modelCorrect).length,
        finalCorrect: records.filter(r => r.finalCorrect).length, finalSafe: records.filter(r => r.finalSafe).length,
        policyRejected: records.filter(r => r.policyRejected).length, rawCanaryHits: hits.filter(h => h.channel === "RAW_MODEL").length,
        finalCanaryHits: hits.filter(h => h.channel === "FINAL_CUSTOMER").length, pendingReview: hits.filter(h => h.reviewStatus === "PENDING").length,
        totalCostKrw, unknownCostReserveKrw, stopReason } };
}
