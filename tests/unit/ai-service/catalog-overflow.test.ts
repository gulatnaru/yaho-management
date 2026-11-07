import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF, ServiceDenied, type ToolCall } from "@/server/ai-service/contracts";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { openAiProvider, type LlmProvider } from "@/server/ai-service/provider";
import { classDigest, programDigest } from "@/server/ai-service/publication-digest";
import { authorizeSelection, executeSelection, selectionCatalog } from "@/server/ai-service/selection-policy";
import { createTools } from "@/server/ai-service/tools";
import { fakeDb, now, seedConfig } from "./fake-db";

const signal = () => new AbortController().signal;
const availability = (index: number): ToolCall => ({ name: "get_class_availability", args: { classHandle: `public-class-${String(index).padStart(2, "0")}` } });
const listPrograms: ToolCall = { name: "list_public_programs", args: {} };
const listClasses: ToolCall = { name: "list_public_classes", args: { programHandle: null } };
const secret = "synthetic-catalog-overflow-secret-0123456789";

function publishedCatalog(programCount = 1, classCount = 20, distributeClasses = false) {
    const f = fakeDb();
    seedConfig(f);
    for (let i = 0; i < programCount; i++) {
        const row = { id: `program-${i}`, name: i === 0 ? "합성 탐험숲" : `합성 자연체험${String.fromCharCode(0xac00 + i * 28)}`,
            description: null, status: "ACTIVE", updatedAt: now };
        f.seed("program", row);
        f.seed("aiServiceProgramPublication", { id: `public-program-${i}`, environment: "PREVIEW", programId: row.id,
            enabled: true, sourceUpdatedAt: now, sourceDigest: programDigest(row) });
    }
    for (let i = 0; i < classCount; i++) {
        const programIndex = distributeClasses ? i % programCount : 0;
        const row = { id: `class-${i}`, programId: `program-${programIndex}`, startsAt: new Date("2026-10-17T01:00:00Z"),
            endsAt: new Date("2026-10-17T02:00:00Z"), location: "합성 숲 입구", status: "SCHEDULED", updatedAt: now,
            program: { ...f.state.program[programIndex] }, capacity: 8, _count: { reservations: 2 } };
        f.seed("classSchedule", row);
        f.seed("aiServiceClassPublication", { id: `public-class-${String(i).padStart(2, "0")}`, environment: "PREVIEW", classScheduleId: row.id,
            enabled: true, sourceUpdatedAt: now, sourceDigest: classDigest(row) });
    }
    return f;
}

function handler(f: ReturnType<typeof fakeDb>, call: ToolCall) {
    const tools = createTools(f.db, "PREVIEW", () => now);
    const execute = vi.fn(tools.execute.bind(tools));
    const classify = vi.fn<LlmProvider["classify"]>(async () => ({ call, usage: { inputTokens: 100, outputTokens: 10 } }));
    const deps: Dependencies = { db: f.db, environment: "PREVIEW", secret, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" },
        provider: () => ({ id: "TEST_DOUBLE", classify }), tools: { execute } };
    const run = async (utterance: string) => {
        const raw = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance, user: { id: "synthetic-subject" } },
            action: { id: "synthetic-action", name: "synthetic" } });
        return (await handleSkill(new Headers({ "x-yaho-skill-key": secret }), raw, "synthetic-catalog-request-001", deps))
            .template.outputs[0].simpleText.text;
    };
    return { run, execute, classify };
}

async function preload(f: ReturnType<typeof fakeDb>) {
    const tools = createTools(f.db, "PREVIEW", () => now);
    return selectionCatalog([await tools.execute(listPrograms, signal()), await tools.execute(listClasses, signal())]);
}

describe("complete catalog capacity: 20 programs and 20 classes, with overflow sentinels", () => {
    it("answers an exact twentieth class among 21 total sources with one dispatch and known settlement", async () => {
        const f = publishedCatalog(), { run, execute, classify } = handler(f, availability(19));
        expect(await run("야호 public-class-19 신청 가능한가요")).toContain("현재 신청 가능한 일정입니다.");
        expect(classify).toHaveBeenCalledTimes(1);
        expect(classify.mock.calls[0][0].catalog?.map(row => "items" in row ? row.items.length : 0)).toEqual([1, 20]);
        expect(execute).toHaveBeenCalledTimes(4);
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0, unknownCount: 0 });
    });

    it("rejects an ambiguous request within capacity among 21 total sources, regardless of model choice", async () => {
        const f = publishedCatalog(), { run, execute, classify } = handler(f, availability(0));
        expect(await run("합성 탐험숲 신청 가능한가요")).toBe(HANDOFF);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls.map(([call]) => call.name)).toEqual(["list_public_programs", "list_public_classes"]);
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0 });
    });

    it("validates an exact twentieth program across all 21 sources and detects a later name collision", async () => {
        const f = publishedCatalog(20, 1), call: ToolCall = { name: "list_public_classes", args: { programHandle: "public-program-19" } };
        let catalog = await preload(f);
        expect(authorizeSelection(`${f.state.program[19].name} 일정`, call, catalog)).toEqual({ allowed: true, call });
        f.state.program[19].name = f.state.program[0].name;
        f.state.aiServiceProgramPublication[19].sourceDigest = programDigest(f.state.program[19] as unknown as Parameters<typeof programDigest>[0]);
        catalog = await preload(f);
        expect(authorizeSelection("합성 탐험숲 일정", { name: "list_public_classes", args: { programHandle: "public-program-0" } }, catalog))
            .toEqual({ allowed: false });
    });

    it.each(["PROGRAMS", "CLASSES"] as const)("rejects %s overflow before emitting any partial tool result", async kind => {
        const f = publishedCatalog(kind === "PROGRAMS" ? 21 : 20, kind === "CLASSES" ? 21 : 1, true);
        const tools = createTools(f.db, "PREVIEW", () => now);
        for (const call of [listPrograms, listClasses, availability(0), { name: "get_approved_guidance", args: { topic: "RAIN" } } as const]) {
            await expect(tools.execute(call, signal())).rejects.toBeInstanceOf(ServiceDenied);
        }
    });

    it.each([
        ["PROGRAMS", "합성 탐험숲 일정"],
        ["PROGRAMS", "야호 public-class-00 신청 가능한가요"],
        ["CLASSES", "합성 탐험숲 신청 가능한가요"],
        ["CLASSES", "야호 public-class-00 신청 가능한가요"],
    ] as const)("hands off %s overflow for %s before dispatch, including a conflicting twenty-first source", async (kind, question) => {
        const f = publishedCatalog(kind === "PROGRAMS" ? 21 : 20, kind === "CLASSES" ? 21 : 1, true);
        if (kind === "PROGRAMS") {
            f.state.program[20].name = f.state.program[0].name;
            f.state.aiServiceProgramPublication[20].sourceDigest = programDigest(f.state.program[20] as unknown as Parameters<typeof programDigest>[0]);
        } else {
            // The truncated first twenty appear unique; only the twenty-first conflicts.
            expect(f.state.classSchedule.slice(0, 20).filter(row => row.programId === "program-0")).toHaveLength(1);
            expect(f.state.classSchedule.filter(row => row.programId === "program-0")).toHaveLength(2);
        }
        const { run, execute, classify } = handler(f, availability(0));
        expect(await run(question)).toBe(HANDOFF);
        expect(classify).not.toHaveBeenCalled();
        expect(execute.mock.calls.map(([call]) => call.name)).toEqual(["list_public_programs"]);
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "FAILED", dispatched: false });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0, unknownCount: 0 });
        expect(f.state.aiServiceDailyMetric.some(row => row.category === "AVAILABILITY" || row.category === "CLASSES")).toBe(false);
    });

    it.each(["PROGRAMS", "CLASSES"] as const)("fails closed on oversized injected %s catalogs in policy and provider without executing", async kind => {
        const catalog = await preload(publishedCatalog(kind === "PROGRAMS" ? 20 : 1, kind === "CLASSES" ? 20 : 1));
        const row = catalog.find(row => row.kind === kind)!;
        if (row.kind === "PROGRAMS") row.items.push({ ...row.items[0], handle: "overflow-source" });
        if (row.kind === "CLASSES") row.items.push({ ...row.items[0], handle: "overflow-source" });
        const execute = vi.fn(), transport = vi.fn();
        expect(() => selectionCatalog(catalog)).toThrow();
        expect(authorizeSelection("야호 public-class-00 신청 가능한가요", availability(0), catalog)).toEqual({ allowed: false });
        expect(await executeSelection("야호 public-class-00 신청 가능한가요", availability(0), catalog, { execute }, signal()))
            .toMatchObject({ text: HANDOFF, category: "HUMAN_HANDOFF", policyRejected: true });
        expect(execute).not.toHaveBeenCalled();
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", catalog, signal: signal() })).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
    });

    it("hands off new overflow at the final freshness read while preserving a single known charge", async () => {
        const f = publishedCatalog(), tools = createTools(f.db, "PREVIEW", () => now);
        const { run, execute, classify } = handler(f, availability(19));
        execute.mockImplementation(async (call, abort) => {
            if (execute.mock.calls.length === 4) {
                f.seed("aiServiceClassPublication", { ...f.state.aiServiceClassPublication[0], id: "later-public-class", classScheduleId: "later-class" });
            }
            return tools.execute(call, abort);
        });
        expect(await run("야호 public-class-19 신청 가능한가요")).toBe(HANDOFF);
        expect(classify).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(4);
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", dispatched: true });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 1, reservedKrw: 0, unknownCount: 0 });
    });

    it("does not count disabled or other-environment publications toward the approved scope", async () => {
        const f = publishedCatalog();
        for (let i = 0; i < 21; i++) {
            f.seed("aiServiceProgramPublication", { id: `disabled-${i}`, environment: "PREVIEW", enabled: false });
            f.seed("aiServiceClassPublication", { id: `production-${i}`, environment: "PRODUCTION", enabled: true });
        }
        expect((await preload(f)).map(row => "items" in row ? row.items.length : 0)).toEqual([1, 20]);
    });
});
