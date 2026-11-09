import { createHash, timingSafeEqual } from "node:crypto";
import { parse, ServiceDenied, skillSchema, type Environment } from "./contracts";
/**
 * Authenticate before parsing or storing any user input. Secret never becomes model input.
 *
 * `secrets.prod` is the operational secret; `secrets.test` is the console test-header
 * secret. The test secret is accepted only in PREVIEW: in PRODUCTION it is rejected
 * at request level even when configured. The request body's `surface` value is never
 * an authentication signal — only the `x-yaho-skill-key` header is trusted.
 * Returns which secret authenticated ("prod" | "test"); throws ServiceDenied otherwise.
 */
export type SkillSecrets = { prod: string | undefined; test?: string | undefined };
export type SkillAuthContext = "prod" | "test";
export function authenticateSkill(headers: Headers, secrets: SkillSecrets, environment: Environment): SkillAuthContext {
    const supplied = headers.get("x-yaho-skill-key");
    const { prod, test } = secrets;
    if (!prod || prod.length < 32 || prod.length > 256 || !supplied || supplied.length > 256)
        throw new ServiceDenied();
    const suppliedHash = createHash("sha256").update(supplied).digest();
    if (timingSafeEqual(suppliedHash, createHash("sha256").update(prod).digest()))
        return "prod";
    if (environment === "PREVIEW" && test && test.length >= 32 && test.length <= 256 && test !== prod &&
        timingSafeEqual(suppliedHash, createHash("sha256").update(test).digest()))
        return "test";
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
