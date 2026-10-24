import type { BillingUsage } from "./billing";
import { HANDOFF, ServiceDenied, type Environment, skillReply } from "./contracts";
import { authenticateSkill, parseSkill } from "./transport";
import { hashes, hmacPins, validateKeys, encrypt, type Keys } from "./crypto";
import { claim, markDispatched, settle } from "./ledger";
import { transaction, type Database } from "./repository";
import { type Tools } from "./tools";
import { executeSelection, selectionCatalog } from "./selection-policy";
import { type LlmProvider } from "./provider";
export type Dependencies = {
    db: Database;
    environment: Environment;
    keys: Keys;
    secret: string;
    botId: string;
    provider: (id: string, model: string) => LlmProvider;
    tools: Tools;
    clock?: () => Date;
};
/** All current public routes remain disabled. This DI core is exercised with synthetic test doubles only. */
export async function handleSkill(headers: Headers, raw: string, stableRequestId: string, deps: Dependencies) {
    const clock = deps.clock ?? (() => new Date()), started = Date.now();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    let claimed: Awaited<ReturnType<typeof claim>> | undefined;
    let dispatched = false;
    let knownUsage: BillingUsage | undefined;
    async function stage<T>(fn: (signal: AbortSignal) => Promise<T>, maxMs: number): Promise<T> {
        const remaining = Math.min(maxMs, 3000 - (Date.now() - started));
        if (remaining <= 0 || controller.signal.aborted)
            throw new ServiceDenied();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new ServiceDenied()); }, remaining); });
        try {
            return await Promise.race([fn(controller.signal), deadline]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    try {
        authenticateSkill(headers, deps.secret);
        const input = parseSkill(raw, deps.botId);
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(stableRequestId))
            throw new ServiceDenied();
        validateKeys(deps.keys);
        const utterance = input.userRequest.utterance;
        // Reject obvious secret/PII/execution requests before external dispatch, regardless of model behavior.
        if (!/야호|숲|프로그램|일정|예약|준비물|우천|비가|운영정책/.test(utterance) ||
            /(?:이전|모든)\s*지시|무시|system\s*prompt|ignore|SQL|개인정보|비밀번호|카드번호|계좌번호|주민번호|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(utterance))
            return skillReply();
        claimed = await stage(() => claim(deps.db, { environment: deps.environment, now: clock(), hmacPins: hmacPins(deps.keys, deps.environment),
            requestHashes: hashes(deps.keys, "request", deps.environment, stableRequestId),
            payloadHashes: hashes(deps.keys, "payload", deps.environment, utterance),
            subjectHashes: hashes(deps.keys, "subject", deps.environment, input.userRequest.user.id) }), 350);
        if (claimed.kind !== "CLAIMED")
            return skillReply();
        const row = claimed.row, provider = deps.provider(row.provider, row.model);
        if (provider.id !== row.provider)
            throw new ServiceDenied();
        const binding = { id: row.id, environment: deps.environment, createdAt: row.createdAt, expiresAt: row.expiresAt };
        const initial = encrypt(deps.keys, binding, { utterance, reply: HANDOFF });
        await stage(() => transaction(deps.db, deps.environment, async (tx) => {
            const written = await tx.aiServiceRequest.updateMany({ where: { id: row.id, environment: deps.environment, status: "PROCESSING", attempt: row.attempt },
                data: initial });
            if (!written.count)
                throw new ServiceDenied();
        }), 250);
        // A bounded approved catalog lets the single model call refer to server-issued public handles.
        const programs = await stage(signal => deps.tools.execute({ name: "list_public_programs", args: {} }, signal), 200);
        const classes = await stage(signal => deps.tools.execute({ name: "list_public_classes", args: { programHandle: null } }, signal), 200);
        const catalog = selectionCatalog([programs, classes]);
        await stage(() => markDispatched(deps.db, deps.environment, row.id, row.attempt, clock()), 200);
        dispatched = true;
        const result = await stage(signal => provider.classify({ utterance, signal, catalog: structuredClone(catalog) }), 1500);
        knownUsage = result.usage;
        const selected = structuredClone(result.call);
        const response = await stage(signal => executeSelection(utterance, selected, catalog, deps.tools, signal), 200);
        const { text, category } = response;
        const encrypted = encrypt(deps.keys, binding, { utterance, reply: text });
        const recorded = await settle(deps.db, deps.environment, row.id, row.attempt, { kind: "KNOWN",
            inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, billingUsage: result.usage, category, ...encrypted }, clock());
        if (!recorded || controller.signal.aborted || Date.now() - started >= 3500)
            return skillReply();
        if (selected && text !== HANDOFF) {
            const final = await stage(signal => executeSelection(utterance, selected, catalog, deps.tools, signal), 200);
            if (final.text !== text)
                return skillReply();
        }
        return skillReply(text);
    }
    catch {
        if (claimed?.kind === "CLAIMED") {
            await settle(deps.db, deps.environment, claimed.row.id, claimed.row.attempt, knownUsage ? { kind: "KNOWN", ...knownUsage, billingUsage: knownUsage, category: "HUMAN_HANDOFF" } : { kind: dispatched ? "UNKNOWN" : "UNDISPATCHED" }, clock()).catch(() => undefined);
        }
        return skillReply();
    }
    finally {
        clearTimeout(timer);
        controller.abort();
    }
}
