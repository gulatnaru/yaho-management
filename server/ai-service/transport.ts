import { createHash, timingSafeEqual } from "node:crypto";
import { parse, ServiceDenied, skillSchema } from "./contracts";
/** Authenticate before parsing or storing any user input. Secret never becomes model input. */
export function authenticateSkill(headers: Headers, secret: string | undefined) {
    const supplied = headers.get("x-yaho-skill-key");
    if (!secret || secret.length < 32 || secret.length > 256 || !supplied || supplied.length > 256)
        throw new ServiceDenied();
    const a = createHash("sha256").update(supplied).digest(), b = createHash("sha256").update(secret).digest();
    if (!timingSafeEqual(a, b))
        throw new ServiceDenied();
}
export function parseSkill(raw: string, botId: string) {
    if (Buffer.byteLength(raw) > 16384)
        throw new ServiceDenied();
    let json: unknown;
    try {
        json = JSON.parse(raw);
    }
    catch {
        throw new ServiceDenied();
    }
    const input = parse(skillSchema, json);
    if (input.bot.id !== botId || input.userRequest.callbackUrl)
        throw new ServiceDenied();
    return input;
}
