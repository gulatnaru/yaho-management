import { z } from "zod";
import { HANDOFF, ServiceDenied, skillReply, skillSchema } from "./contracts";
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
];
const requestSchema = skillSchema.extend({
    version: z.literal("2.0"),
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
 * Synthetic/internal DI entrypoint only. Public routes remain disabled.
 * The caller must supply a stable request identity: Kakao's real identity/retry
 * contract is still an activation gate. Never derive it from user/utterance.
 */
export async function handleKakaoSkill(headers: Headers, raw: string, stableRequestId: string, deps: Dependencies, service: SkillService = handleSkill) {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Authentication must precede even JSON parsing and any service/DB access.
        authenticateSkill(headers, deps.secret);
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
            return skillReply();
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
            return skillReply();
        const reply = replySchema.safeParse(result);
        if (!reply.success)
            return skillReply();
        const text = reply.data.template.outputs[0].simpleText.text;
        return skillReply(text === "HUMAN_HANDOFF" ? HANDOFF : text);
    }
    catch {
        return skillReply();
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
