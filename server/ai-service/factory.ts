import { openAiProvider, type LlmProvider } from "./provider";
import { openAiResponsesTransport } from "./openai-transport";
import { readServiceKeys } from "./keys";
import { ServiceDenied } from "./contracts";
import { createTools } from "./tools";
import type { Database } from "./repository";
import type { Environment } from "./contracts";
import type { Dependencies } from "./handler";

/**
 * Live (non-test) dependency assembly for the AI Service Skill route.
 *
 * The provider function is closed over the OpenAI transport and allows exactly
 * one (id, model) pair: OPENAI + gpt-6-luna. Every other pair -- including the
 * TEST_DOUBLE provider used by the unit/eval doubles -- is rejected with
 * ServiceDenied. The test double is never imported here, so no live code path
 * can select it.
 *
 * Secrets are read from the process environment and never written to logs,
 * errors, or responses: every failure surfaces as the fixed ServiceDenied
 * message "AI_SERVICE_DENIED". The API key is validated by the transport
 * (20-256 chars, no CR/LF); the Skill secret is validated by authenticateSkill
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
    const apiKey = input.env.AI_SERVICE_OPENAI_API_KEY;
    if (!apiKey || apiKey.length < 20 || apiKey.length > 256 || /[\r\n]/.test(apiKey)) throw new ServiceDenied();
    const secret = input.env.AI_SERVICE_SKILL_SECRET;
    if (!secret || secret.length < 32 || secret.length > 256) throw new ServiceDenied();
    // Empty string means unset (same convention as the operational secret).
    const testSecret = input.env.AI_SERVICE_SKILL_TEST_SECRET || undefined;
    if (testSecret && (testSecret.length < 32 || testSecret.length > 256 || testSecret === secret)) throw new ServiceDenied();
    const transport = openAiResponsesTransport(apiKey, globalThis.fetch);
    const provider = (id: string, model: string): LlmProvider => {
        if (id !== "OPENAI" || model !== "gpt-6-luna") throw new ServiceDenied();
        return openAiProvider("gpt-6-luna", transport);
    };
    const tools = createTools(input.db, input.environment);
    return { db: input.db, environment: input.environment, keys, secret, testSecret, botId: input.botId, provider, tools };
}
