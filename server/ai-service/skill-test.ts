import { z } from "zod";
import { ServiceDenied, skillReply, type ToolCall } from "./contracts";
import { testProvider } from "./provider";
import { executeSelection } from "./selection-policy";
import { authenticateSkill } from "./transport";
import type { ToolResult, Tools } from "./tools";

// A marker on arbitrary text cannot prove synthetic provenance. Accept only these
// closed fixtures; ordinary Kakao envelopes, identifiers and free text are rejected.
const inputSchema = z.object({
    synthetic: z.literal(true),
    scenario: z.enum(["PROGRAMS", "POLICY", "PREPARATION", "RAIN", "HANDOFF"]),
}).strict();
const MAX_BYTES = 16384;
const catalog: ToolResult[] = [{ kind: "PROGRAMS", items: [
    { handle: "synthetic-test-program", name: "합성 테스트 프로그램", description: null },
] }, { kind: "CLASSES", items: [] }];
const fixtureTools: Tools = {
    async execute(call, signal) {
        if (signal.aborted) throw new ServiceDenied();
        if (call.name === "list_public_programs") return structuredClone(catalog[0]);
        // No official guidance has been supplied or approved for this test route.
        if (call.name === "get_approved_guidance") return { kind: "GUIDANCE", content: null };
        throw new ServiceDenied();
    },
};

async function boundedBody(request: Request) {
    if (!request.body) throw new ServiceDenied();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => undefined);
    }, 3500);
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > MAX_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw new ServiceDenied();
            }
            chunks.push(next.value);
        }
        if (timedOut || request.signal.aborted) throw new ServiceDenied();
        return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } finally {
        clearTimeout(timer);
        reader.releaseLock();
    }
}

/** No DB, keys, live provider, default fetch, credential lookup or durable writes. */
export async function syntheticSkillResponse(request: Request, secret: string | undefined) {
    const response = (status: number, text?: string) => Response.json(skillReply(text), {
        status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
    if (!secret || secret.length < 32 || secret.length > 256) return response(503);
    try { authenticateSkill(request.headers, secret); }
    catch { return response(401); }
    try {
        if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
            throw new ServiceDenied();
        const input = inputSchema.parse(JSON.parse(await boundedBody(request)));
        const utterance = input.scenario === "PROGRAMS" ? "프로그램 목록 알려주세요"
            : input.scenario === "POLICY" ? "정책 알려주세요"
            : input.scenario === "PREPARATION" ? "준비물 알려주세요"
            : input.scenario === "RAIN" ? "우천 안내 알려주세요" : "환불 문의";
        const call: ToolCall | null = input.scenario === "PROGRAMS" ? { name: "list_public_programs", args: {} }
            : input.scenario === "HANDOFF" ? null
            : { name: "get_approved_guidance", args: { topic: input.scenario } };
        const signal = request.signal;
        const provider = testProvider({ call, usage: { inputTokens: 0, outputTokens: 0 } });
        const result = await provider.classify({ utterance, catalog: structuredClone(catalog), signal });
        const selected = await executeSelection(utterance, result.call, catalog, fixtureTools, signal);
        return response(200, selected.text);
    } catch { return response(400); }
}
