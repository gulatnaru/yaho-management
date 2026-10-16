import { z } from "zod";
import { ServiceDenied } from "./contracts";
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const billingUsageSchema = z.object({
    inputTokens: tokens, outputTokens: tokens, cachedInputTokens: tokens.optional(), cacheWriteTokens: tokens.optional(),
    reasoningOutputTokens: tokens.optional(), totalTokens: tokens.optional(),
}).strict().superRefine((v, c) => {
    if ((v.cachedInputTokens ?? 0) + (v.cacheWriteTokens ?? 0) > v.inputTokens ||
        (v.reasoningOutputTokens ?? 0) > v.outputTokens ||
        (v.totalTokens !== undefined && v.totalTokens !== v.inputTokens + v.outputTokens))
        c.addIssue({ code: "custom", message: "AI_BILLING_USAGE_UNKNOWN" });
});
export type BillingUsage = z.infer<typeof billingUsageSchema>;
export function billingContract(provider: string, model: string) {
    if ((provider !== "OPENAI" && provider !== "TEST_DOUBLE") || model !== "gpt-6-luna")
        throw new ServiceDenied();
    return { billingContract: provider + "_STANDARD_INPUT_MAX_V1", inputCostNumerator: 5, inputCostDenominator: 4 };
}
export function validatedBillingUsage(value: unknown): BillingUsage {
    const parsed = billingUsageSchema.safeParse(value);
    if (!parsed.success)
        throw new ServiceDenied();
    return parsed.data;
}
