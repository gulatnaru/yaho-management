import { createHash } from "node:crypto";
import { ServiceDenied } from "./contracts";

/**
 * Stable request identity for the live Skill route (SPEC OQ-9, user-approved
 * 2026-11-08: server heuristic hash).
 *
 * Kakao provides no per-request id, so the server derives one from the
 * request's own fields: (bot id, user id, block id, utterance, 5-minute UTC
 * window). The canonical string is JSON of a versioned tuple and is hashed
 * once with plain SHA-256 (hex, 64 chars). The raw user id and utterance are
 * never stored, logged, or returned as part of this value: the ledger HMACs
 * the id again under every retained key version before persisting it, and
 * the handler keeps the request payload encrypted.
 *
 * This is a deduplication key, NOT an authentication token and NOT a
 * Kakao-provided key. Its limits are by design and must not be reported as
 * perfect deduplication:
 *  - a re-sent request that crosses a 5-minute window boundary derives a
 *    different id and may be claimed twice (bounded: the atomic reserve +
 *    hardcap + quota still cap the total spend);
 *  - the same id with a different utterance is rejected (ServiceDenied) --
 *    the ledger treats it as a conflicting claim, not a retry;
 *  - expired rows are treated as unknown and block the id until a human
 *    confirms the invoice, so a re-sent request after a stale recovery is
 *    also rejected rather than silently re-run.
 *
 * Input extraction lives in the route (W-3.1): botId from the payload's
 * bot.id, userId from userRequest.user.id with the plusfriendUserKey
 * fallback (both absent -> ServiceDenied), blockId from
 * userRequest.block?.id ("" when absent), utterance verbatim (never
 * normalised -- normalisation would merge distinct requests).
 */
export function deriveStableRequestId(input: {
    botId: string;
    userId: string;
    blockId: string;
    utterance: string;
    now: Date;
}): string {
    if (!input.botId || !input.userId || !input.utterance || !Number.isFinite(input.now.getTime()))
        throw new ServiceDenied();
    const window = Math.floor(input.now.getTime() / 300000).toString(10);
    const canonical = JSON.stringify([
        "ai-service-stable-request-v1",
        input.botId,
        input.userId,
        input.blockId,
        input.utterance,
        window,
    ]);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
}
