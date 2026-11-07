import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF, type ToolCall } from "@/server/ai-service/contracts";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { authorizeSelection, executeSelection, selectionCatalog } from "@/server/ai-service/selection-policy";
import type { ToolResult } from "@/server/ai-service/tools";
import { fakeDb, now, seedConfig } from "./fake-db";

const signal = () => new AbortController().signal;
const availability: ToolCall = { name: "get_class_availability", args: { classHandle: "class-first" } };
const listClasses: ToolCall = { name: "list_public_classes", args: { programHandle: null } };
function approvedScope(): ToolResult[] {
    return [
        { kind: "PROGRAMS", items: ["탐험숲", "자연미술", "곤충관찰", "별관찰"].map((name, index) => ({
            handle: `program-${index}`, name: `합성 ${name}`, description: null,
        })) },
        { kind: "CLASSES", items: [
            { handle: "class-first", programHandle: "program-0", startsAt: "2026-10-17T01:00:00Z", endsAt: "2026-10-17T02:00:00Z", location: "합성 숲 입구" },
            { handle: "class-second", programHandle: "program-1", startsAt: "2026-10-18T01:00:00Z", endsAt: "2026-10-18T02:00:00Z", location: "합성 공원 입구" },
            { handle: "class-third", programHandle: "program-2", startsAt: "2026-10-19T01:00:00Z", endsAt: "2026-10-19T02:00:00Z", location: "합성 산책로 입구" },
            { handle: "class-fourth", programHandle: "program-0", startsAt: "2026-10-24T01:00:00Z", endsAt: "2026-10-24T02:00:00Z", location: "합성 숲 입구" },
        ] },
    ];
}

describe("authorization across the complete approved selection scope", () => {
    it("preserves programs and classes beyond the first three during catalog construction", () => {
        expect(selectionCatalog(approvedScope()).map(row => "items" in row ? row.items.length : 0)).toEqual([4, 4]);
    });

    it.each(["합성 탐험숲 신청 가능한가요", "토요일 신청 가능한가요"])("blocks execution when a fourth approved class makes the request ambiguous: %s", async question => {
        const catalog = selectionCatalog(approvedScope());
        const execute = vi.fn(async (): Promise<ToolResult> => ({ kind: "AVAILABILITY", status: "AVAILABLE" }));
        expect(authorizeSelection(question, availability, catalog)).toEqual({ allowed: false });
        expect(await executeSelection(question, availability, catalog, { execute }, signal())).toMatchObject({ text: HANDOFF, policyRejected: true });
        expect(execute).not.toHaveBeenCalled();
    });

    it("authorizes an explicit unique class beyond the first three", async () => {
        const call: ToolCall = { name: "get_class_availability", args: { classHandle: "class-fourth" } };
        const execute = vi.fn(async (): Promise<ToolResult> => ({ kind: "AVAILABILITY", status: "AVAILABLE" }));
        expect(await executeSelection("class-fourth 신청 가능한가요", call, selectionCatalog(approvedScope()), { execute }, signal()))
            .toMatchObject({ category: "AVAILABILITY", policyRejected: false });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(call, expect.any(AbortSignal));
    });

    it("authorizes a unique program beyond the first three", () => {
        const call: ToolCall = { name: "list_public_classes", args: { programHandle: "program-3" } };
        expect(authorizeSelection("합성 별관찰 일정", call, selectionCatalog(approvedScope()))).toEqual({ allowed: true, call });
    });

    it("checks returned class facts against the complete scope", async () => {
        const scope = approvedScope();
        const catalog = selectionCatalog(scope);
        const approved = scope.find(row => row.kind === "CLASSES")!;
        const execute = vi.fn(async (): Promise<ToolResult> => approved);
        expect(await executeSelection("전체 일정", listClasses, catalog, { execute }, signal())).toMatchObject({ category: "CLASSES" });
        const changed = structuredClone(approved);
        changed.items[3].location = "합성 다른 입구";
        execute.mockResolvedValue(changed);
        expect(await executeSelection("전체 일정", listClasses, catalog, { execute }, signal())).toMatchObject({ text: HANDOFF });
    });

    it("rejects duplicate handles beyond the first three", () => {
        const catalog = approvedScope();
        const classes = catalog.find(row => row.kind === "CLASSES")!;
        classes.items[3].handle = classes.items[0].handle;
        expect(() => selectionCatalog(catalog)).toThrow();
    });

    it("rejects a program name collision beyond the first three before execution", async () => {
        const catalog = approvedScope();
        const programs = catalog.find(row => row.kind === "PROGRAMS")!;
        programs.items[3].name = programs.items[0].name;
        const call: ToolCall = { name: "list_public_classes", args: { programHandle: "program-0" } };
        const execute = vi.fn();
        expect(await executeSelection("합성 탐험숲 일정", call, selectionCatalog(catalog), { execute }, signal())).toMatchObject({ text: HANDOFF, policyRejected: true });
        expect(execute).not.toHaveBeenCalled();
    });

    it("keeps the fourth class visible to authorization through the handler preload", async () => {
        const f = fakeDb(); seedConfig(f);
        const catalog = approvedScope();
        const classify = vi.fn(async () => ({ call: availability, usage: { inputTokens: 100, outputTokens: 10 } }));
        const execute = vi.fn(async (call: ToolCall): Promise<ToolResult> => call.name === "list_public_programs" ? catalog[0]
            : call.name === "list_public_classes" ? catalog[1] : { kind: "AVAILABILITY", status: "AVAILABLE" });
        const secret = "synthetic-complete-scope-secret-0123456789";
        const deps: Dependencies = { db: f.db, environment: "PREVIEW", secret, botId: "synthetic-bot", clock: () => now,
            keys: { encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" },
            provider: () => ({ id: "TEST_DOUBLE", classify }), tools: { execute } };
        const raw = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance: "합성 탐험숲 신청 가능한가요", user: { id: "synthetic-subject" } }, action: { id: "synthetic-action", name: "synthetic" } });
        const response = await handleSkill(new Headers({ "x-yaho-skill-key": secret }), raw, "synthetic-complete-scope-001", deps);
        expect(response.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls.map(([call]) => call.name)).toEqual(["list_public_programs", "list_public_classes"]);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
    });
});
