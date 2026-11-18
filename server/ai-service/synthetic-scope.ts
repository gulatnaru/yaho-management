import { z } from "zod";
import { SkillDiagCode as C, SkillDiagDenied } from "./skill-diag";
import { parse, ServiceDenied, toolCallSchema } from "./contracts";
import type { Tools } from "./tools";

// Fixed synthetic fixtures are server-owned; request metadata never expands them.
const utterances = ["야호 준비물을 알려 주세요", "야호 비가 오면 운영하나요", "야호 예약을 도와 주세요"] as const;
const requestSchema = z.object({
    bot: z.object({ id: z.string() }).passthrough(),
    userRequest: z.object({ user: z.object({ id: z.string() }).passthrough(), block: z.object({ id: z.string() }).passthrough(), utterance: z.string() }).passthrough(),
}).passthrough();
const scopes = new WeakMap<object, number>();
export type SyntheticScope = object & { readonly __syntheticScope: unique symbol };
export function validateSyntheticScope(raw: string, env: Readonly<Record<string, string | undefined>> = process.env, now = new Date()): SyntheticScope {
    const run = env.AI_SERVICE_SYNTHETIC_RUN_ID;
    const expiry = env.AI_SERVICE_SYNTHETIC_EXPIRES_AT;
    if (!run) throw new SkillDiagDenied(C.S6_RUN_MISSING);
    if (!/^[a-z0-9-]{8,64}$/.test(run)) throw new SkillDiagDenied(C.S6_RUN_FORMAT);
    if (!expiry) throw new SkillDiagDenied(C.S6_EXPIRY_MISSING);
    if (!Number.isFinite(Date.parse(expiry))) throw new SkillDiagDenied(C.S6_EXPIRY_INVALID);
    if (!Number.isFinite(now.getTime())) throw new SkillDiagDenied(C.S6_CLOCK_INVALID);
    if (Date.parse(expiry) <= now.getTime()) throw new SkillDiagDenied(C.S6_EXPIRY_PASSED);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new SkillDiagDenied(C.S6_BODY_JSON_INVALID); }
    let request: ReturnType<typeof requestSchema.parse>;
    try { request = parse(requestSchema, value); } catch { throw new SkillDiagDenied(C.S6_BODY_SCHEMA_INVALID); }
    if (request.bot.id !== "synthetic-bot") throw new SkillDiagDenied(C.S6_BOT_MISMATCH);
    if (request.userRequest.user.id !== `synthetic-${run}`) throw new SkillDiagDenied(C.S6_USER_MISMATCH);
    if (request.userRequest.block.id !== "synthetic-block") throw new SkillDiagDenied(C.S6_BLOCK_MISMATCH);
    if (!utterances.some(u => u === request.userRequest.utterance)) throw new SkillDiagDenied(C.S6_UTTERANCE_UNKNOWN);
    const scope = Object.freeze({}) as SyntheticScope;
    scopes.set(scope, Date.parse(expiry));
    return scope;
}
export function assertSyntheticScope(scope: SyntheticScope): void {
    if ((scopes.get(scope) ?? 0) <= Date.now()) throw new SkillDiagDenied(C.S8B_SCOPE_EXPIRED);
}
export function createSyntheticTools(scope: SyntheticScope): Tools {
    assertSyntheticScope(scope);
    return { async execute(input, signal) {
        if (signal.aborted || (scopes.get(scope) ?? 0) <= Date.now()) throw new ServiceDenied();
        const call = parse(toolCallSchema, input);
        if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
        if (call.name === "list_public_classes") {
            if (call.args.programHandle !== null) throw new ServiceDenied();
            return { kind: "CLASSES", items: [] };
        }
        if (call.name === "get_class_availability") throw new ServiceDenied();
        if (call.args.topic === "PREPARATION") return { kind: "GUIDANCE", content: "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요." };
        if (call.args.topic === "RAIN") return { kind: "GUIDANCE", content: "합성 안내: 우천 시 운영 안내를 확인해 주세요." };
        throw new ServiceDenied();
    } };
}
