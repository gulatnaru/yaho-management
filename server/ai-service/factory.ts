import { readServiceKeys } from "./keys";
import { ServiceDenied } from "./contracts";
import { createTools } from "./tools";
import type { Database } from "./repository";
import type { Environment } from "./contracts";
import type { Dependencies } from "./handler";

/**
 * Live (non-test) dependency assembly for the AI Service Skill route.
 *
 * OQ-12 P0-A: the live path no longer calls a model, so this factory assembles
 * no provider and validates no OpenAI API key. A missing key must not fail
 * startup of a path that never uses it. `provider.ts` / `openai-transport.ts`
 * remain for eval live mode and unit regression only; no live code path can
 * select them because `Dependencies` has no provider field at all.
 *
 * Secrets are read from the process environment and never written to logs,
 * errors, or responses: every failure surfaces as the fixed ServiceDenied
 * message "AI_SERVICE_DENIED". The Skill secret is validated by authenticateSkill
 * (32-256 chars) before the route derives the stable request id. The optional
 * test secret (AI_SERVICE_SKILL_TEST_SECRET) is validated here when present:
 * it must be 32-256 chars and differ from the operational secret. It is never
 * accepted in PRODUCTION — that rejection happens per request in authenticateSkill.
 *
 * botId is a factory argument, never hardcoded: the route supplies it from
 * the AI_SERVICE_BOT_ID environment variable.
 */
export type LiveDependenciesInput = {
    env: NodeJS.ProcessEnv;
    db: Database;
    environment: Environment;
    botId: string;
};

export function createLiveDependencies(input: LiveDependenciesInput): Dependencies {
    const keys = readServiceKeys(input.env);
    const secret = input.env.AI_SERVICE_SKILL_SECRET;
    if (!secret || secret.length < 32 || secret.length > 256) throw new ServiceDenied();
    // Empty string means unset (same convention as the operational secret).
    const testSecret = input.env.AI_SERVICE_SKILL_TEST_SECRET || undefined;
    if (testSecret && (testSecret.length < 32 || testSecret.length > 256 || testSecret === secret)) throw new ServiceDenied();
    const tools = createTools(input.db, input.environment);
    return { db: input.db, environment: input.environment, keys, secret, testSecret, botId: input.botId, tools };
}
