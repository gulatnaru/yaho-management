import { z } from "zod";
import { HANDOFF, ServiceDenied, healthKeywordPattern, skillHandoffCard, skillReply, skillSchema } from "./contracts";
import { handleSkill, type Dependencies } from "./handler";
import { authenticateSkill } from "./transport";

const DEADLINE_MS = 4000;
const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
// Format detection only: even synthetic/invalid-checksum PII must never reach
// the delegate, provider factory, request ledger, or any other DB access.
const piiFormats = [
    /\d{6}[-\s]?\d{7}/,
    /(?:0\d{1,2}|\+82[-.\s]?\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/,
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    healthKeywordPattern,
    // Birthdates need a birth-context word: a bare year date ("2026년 10월 18일")
    // is an ordinary schedule expression and must keep passing (recorded
    // regression: "야호 2026년 10월 18일 일정 준비물을 알려 주세요").
    // Residual year dates are still caught by layer 3 (decideSelection
    // rejects unexplained text), and "생년월일" is gated in the handler.
    // (PLAN §1.1 (i) narrowed — see BUILD report DEVIATION-1.)
    /(생년월일|생일|출생|태어난)[^\d]{0,8}(19|20)\d{2}[-./년\s]?\d{1,2}[-./월\s]?\d{1,2}/,
    /(19|20)\d{2}년\s?\d{1,2}월\s?\d{1,2}일\s?생/,
    /(19|20)\d{2}년생/,
];
const requestSchema = skillSchema.extend({
    // Kakao real Skill requests carry no top-level `version` (it is a response-only
    // field). Absent is allowed; a present value must be exactly "2.0".
    version: z.literal("2.0").optional(),
    userRequest: skillSchema.shape.userRequest.extend({
        utterance: skillSchema.shape.userRequest.shape.utterance.refine(
            value => !piiFormats.some(pattern => pattern.test(value.normalize("NFKC").replace(/\p{Cf}/gu, ""))),
            "Sensitive input is not allowed",
        ),
    }),
    action: skillSchema.shape.action.extend({
        clientExtra: z.record(z.unknown()).nullish(),
    }),
});
const replySchema = z.object({
    version: z.literal("2.0"),
    template: z.object({
        outputs: z.tuple([z.object({
            simpleText: z.object({ text: z.string().trim().min(1).max(1000) }).strict(),
        }).strict()]),
    }).strict(),
}).strict();

/** Trusted internal service seam; never pass model output directly to this adapter. */
export type SkillService = (headers: Headers, raw: string, stableRequestId: string, deps: Dependencies) => Promise<unknown>;

/**
 * HANDOFF as a textCard with an operator button. The card builder enforces the
 * 400-char title+description budget; if it ever throws, fall back to the plain
 * HANDOFF text rather than leaving the user with no reply.
 */
function handoffCard() {
    try {
        return skillHandoffCard();
    } catch {
        return skillReply();
    }
}

/**
 * Synthetic/internal DI entrypoint only. Public routes remain disabled.
 * The caller must supply a stable request identity: Kakao's real identity/retry
 * contract is still an activation gate. Never derive it from user/utterance.
 */
export async function handleKakaoSkill(headers: Headers, raw: string, stableRequestId: string, deps: Dependencies, service: SkillService = handleSkill) {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Authentication must precede even JSON parsing and any service/DB access.
        authenticateSkill(headers, { prod: deps.secret, test: deps.testSecret }, deps.environment);
        if (Buffer.byteLength(raw, "utf8") > 16384)
            throw new ServiceDenied();
        const input = requestSchema.parse(JSON.parse(raw));
        requestIdSchema.parse(stableRequestId);
        if (input.bot.id !== deps.botId || input.userRequest.callbackUrl !== undefined)
            throw new ServiceDenied();

        // Keep only fields used by the core; clientExtra:null is valid Kakao input.
        // Ignore unstable context/metadata rather than making retries new requests.
        const normalized = JSON.stringify({
            bot: { id: input.bot.id },
            userRequest: { utterance: input.userRequest.utterance, user: { id: input.userRequest.user.id } },
            action: { id: input.action.id, name: input.action.name },
        });
        const remaining = DEADLINE_MS - (Date.now() - started);
        if (remaining <= 0)
            return handoffCard();
        const deadline = new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), remaining);
        });
        // Keep the stable identity unchanged: the existing ledger HMACs it under
        // every retained key version and owns durable deduplication and charging.
        // The race also bounds a noncooperative delegate or settlement. Its attached
        // rejection handler consumes late errors without publishing a late reply.
        const result = await Promise.race([
            Promise.resolve().then(() => service(headers, normalized, stableRequestId, deps)),
            deadline,
        ]);
        if (Date.now() - started >= DEADLINE_MS)
            return handoffCard();
        const reply = replySchema.safeParse(result);
        if (!reply.success)
            return handoffCard();
        const text = reply.data.template.outputs[0].simpleText.text;
        return text === "HUMAN_HANDOFF" || text === HANDOFF ? handoffCard() : skillReply(text);
    }
    catch {
        return handoffCard();
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
