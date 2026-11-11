import { z } from "zod";
export const HANDOFF = "확인 가능한 안내가 없습니다. 담당자에게 문의해 주세요.";
export const RETENTION_MS = 90 * 86400000;
export const ENVIRONMENTS = ["PREVIEW", "PRODUCTION"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const environmentSchema = z.enum(ENVIRONMENTS);
export const hardCap = (environment: Environment) => environment === "PREVIEW" ? 1000 : 7000;
export class ServiceDenied extends Error {
    constructor() { super("AI_SERVICE_DENIED"); }
}
export type Actor = {
    userId: string;
    role: string;
    active: boolean;
};
export function assertAdmin(actor: Actor) {
    if (!actor.active || actor.role !== "ADMIN" || !actor.userId)
        throw new ServiceDenied();
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new ServiceDenied();
    return result.data;
}
export const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export const toolCallSchema = z.discriminatedUnion("name", [
    z.object({ name: z.literal("list_public_programs"), args: z.object({}).strict() }).strict(),
    z.object({ name: z.literal("list_public_classes"), args: z.object({ programHandle: safeId.nullable() }).strict() }).strict(),
    z.object({ name: z.literal("get_class_availability"), args: z.object({ classHandle: safeId }).strict() }).strict(),
    z.object({ name: z.literal("get_approved_guidance"), args: z.object({ topic: z.enum(["POLICY", "PREPARATION", "RAIN"]) }).strict() }).strict(),
]);
export type ToolCall = z.infer<typeof toolCallSchema>;
export const handoffCallSchema = z.object({ name: z.literal("HUMAN_HANDOFF"), args: z.object({}).strict() }).strict();
export const configSchema = z.object({
    expectedVersion: z.number().int().nonnegative(), paused: z.boolean().default(true), provider: z.enum(["OPENAI", "TEST_DOUBLE"]),
    model: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), priceVersion: safeId,
    inputNanoUsdPerToken: z.number().int().positive().max(1000000),
    outputNanoUsdPerToken: z.number().int().positive().max(1000000),
    fxMilliKrwPerUsd: z.number().int().min(100000).max(10000000),
    fxCheckedAt: z.coerce.date(), fxSource: z.string().trim().min(1).max(120),
    /** Auto-delete scheduler switch (OQ-12 P0-B, P-1). Default false: code may be
     * deployed/merged while the scheduler stays off; activation is a separate
     * operational approval executed by an ADMIN toggling this flag. */
    schedulerEnabled: z.boolean().default(false),
}).strict();
/** Health/allergy vocabulary shared by the Skill PII filter and the handler
 * keyword gate (OQ-12 P0-A, layer 1 + layer 2). One source so the two layers
 * cannot drift apart. A match means HANDOFF, never a model call. Names and
 * addresses cannot be pattern-matched, so layer 3 (residual text) is the
 * final defense for those. */
export const healthKeywordPattern = /알레르기|아토피|천식|질환|복용|처방|장애|발달|진단|수술|병원|약물|증상|아픈|아파/;
export type ConfigInput = z.infer<typeof configSchema>;
export const publicationSchema = z.object({ kind: z.enum(["PROGRAM", "CLASS"]), id: safeId,
    enabled: z.boolean(), expectedVersion: z.number().int().nonnegative() }).strict();
export const guidanceSchema = z.object({ topic: z.enum(["POLICY", "PREPARATION", "RAIN"]),
    content: z.string().trim().min(1).max(1000), approved: z.boolean(), expectedVersion: z.number().int().nonnegative() }).strict();
export const recordSchema = z.object({ utterance: z.string().max(1000), reply: z.string().max(1000) }).strict();
export const skillSchema = z.object({
    bot: z.object({ id: safeId }).passthrough(),
    userRequest: z.object({ utterance: z.string().trim().min(1).max(1000),
        user: z.object({ id: z.string().min(1).max(128), type: z.string().max(40).optional() }).passthrough(),
        callbackUrl: z.string().url().optional() }).passthrough(),
    action: z.object({ id: safeId, name: z.string().max(100), params: z.record(z.string()).optional(),
        detailParams: z.record(z.unknown()).optional(), clientExtra: z.record(z.unknown()).optional() }).passthrough(),
}).passthrough();
export function skillReply(text = HANDOFF) {
    return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}
/**
 * HANDOFF card for the real Kakao Skill adapter only. Title and button label are
 * fixed by user decision; description is the HANDOFF constant. Kakao textCard
 * budget: title + description <= 400 chars, button label <= 14 chars. The
 * builder throws ServiceDenied when the budget is exceeded; the adapter falls
 * back to the simpleText HANDOFF in that case. The `operator` button needs no
 * extra field (official answer_json_format: Button fields are label/action plus
 * action-specific fields; `operator` is listed with no additional field).
 */
export const HANDOFF_CARD_TITLE = "야호 상담 안내";
export const HANDOFF_CARD_BUTTON_LABEL = "담당자 연결";
export function skillHandoffCard(description: string = HANDOFF) {
    if (HANDOFF_CARD_TITLE.length + description.length > 400) throw new ServiceDenied();
    return { version: "2.0", template: { outputs: [{ textCard: { title: HANDOFF_CARD_TITLE,
        description, buttons: [{ action: "operator", label: HANDOFF_CARD_BUTTON_LABEL }] } }] } };
}
export const skillCardReplySchema = z.object({
    version: z.literal("2.0"),
    template: z.object({
        outputs: z.tuple([z.object({
            textCard: z.object({
                title: z.string().trim().min(1).max(400),
                description: z.string().trim().min(1).max(400),
                buttons: z.tuple([z.object({ action: z.literal("operator"), label: z.string().min(1).max(14) }).strict()]),
            }).strict().refine(card => card.title.length + card.description.length <= 400, "textCard budget exceeded"),
        }).strict()]),
    }).strict(),
}).strict();
