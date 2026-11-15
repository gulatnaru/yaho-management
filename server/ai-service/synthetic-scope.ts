import { z } from "zod";
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
    if (!run || !/^[a-z0-9-]{8,64}$/.test(run) || !expiry || !Number.isFinite(Date.parse(expiry)) || !Number.isFinite(now.getTime()) || Date.parse(expiry) <= now.getTime()) throw new ServiceDenied();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new ServiceDenied(); }
    const request = parse(requestSchema, value);
    if (request.bot.id !== "synthetic-bot" || request.userRequest.user.id !== `synthetic-${run}` || request.userRequest.block.id !== "synthetic-block" || !utterances.some(u => u === request.userRequest.utterance)) throw new ServiceDenied();
    const scope = Object.freeze({}) as SyntheticScope;
    scopes.set(scope, Date.parse(expiry));
    return scope;
}
export function assertSyntheticScope(scope: SyntheticScope): void {
    if ((scopes.get(scope) ?? 0) <= Date.now()) throw new ServiceDenied();
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
