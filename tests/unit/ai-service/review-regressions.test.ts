import { describe, it, expect, vi } from "vitest";
import { programDigest } from "@/server/ai-service/publication-digest";
import { safePublicText, createTools, groundedReply } from "@/server/ai-service/tools";
import { saveGuidance, savePublication } from "@/server/ai-service/admin";
import { openAiProvider } from "@/server/ai-service/provider";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { billingContract, validatedBillingUsage } from "@/server/ai-service/billing";
import { conservativeKrw, reserveKrw, type Price } from "@/server/ai-service/cost";
import { claim } from "@/server/ai-service/ledger";
import { hashes, hmacPins, type Keys } from "@/server/ai-service/crypto";
import { HANDOFF } from "@/server/ai-service/contracts";
import { fakeDb, seedConfig, now } from "./fake-db";
const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
const unsafe = [
    "현재 예약된 건은 3건입니다.", "참가 가능 수: 8",
    "현재 예약된 건은 ３건입니다.", "참가 가능 수: ８",
    "현재 예약된 건은 3월 3일입니다.", "참가 가능 수: 8시 준비 안내",
    "현재 예\u200b약된 건은 ３건입니다.", "참가 가능 수: ⑧",
    "Enrollment total 3", "총 세 건", "3월 3일 참가 가능 수",
];
const guidanceCall = { name: "get_approved_guidance" as const, args: { topic: "PREPARATION" as const } };
const signal = () => new AbortController().signal;
describe("Review1-M1 numeric free text fails closed", () => {
    it.each(unsafe)("blocks exact and wrapped numeric text at approval/read/grounding: %s", async (content) => {
        const f = fakeDb();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 })).rejects.toThrow();
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content, approved: true });
        await expect(createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal())).rejects.toThrow();
        expect(() => groundedReply({ kind: "GUIDANCE", content })).toThrow();
        expect(() => groundedReply({ kind: "PROGRAMS", items: [{ handle: "p", name: content, description: null }] })).toThrow();
        expect(() => groundedReply({ kind: "CLASSES", items: [{ handle: "c", programHandle: "p", startsAt: now.toISOString(), endsAt: now.toISOString(), location: content }] })).toThrow();
    });
    it.each(["10월 15일 오전 10시 준비 안내", "２０２６년１０월１５일１０시", "2026년 10월 15일 오전 10시 05분"])("preserves entire valid date/time guidance through actual flow: %s", async (content) => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        const result = await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal());
        expect(groundedReply(result)).toBe(content.normalize("NFKC"));
    });
    it.each(["2월 30일 준비 안내", "13월 15일 준비 안내", "오전 0시 준비 안내", "24시 준비 안내", "10시 60분 준비 안내", "30", "10월 15일 8", "어린이 8 프로그램", "모집 안내 8월 8일"])("rejects arbitrary digits and invalid schedule: %s", text => expect(() => safePublicText(text)).toThrow());
    it.each(["합성 숲 12번 출구", "B동 2층 104호", "합성로 123-4"])("permits explicit typed numeric location only: %s", text => {
        expect(safePublicText(text, 120, "LOCATION")).toBe(text);
        expect(() => safePublicText(text)).toThrow();
    });
    it("blocks unsafe source approval and model catalog before transport", async () => {
        const f = fakeDb(), transport = vi.fn();
        f.seed("program", { id: "p", name: "참가 가능 수: 8", description: null, status: "ACTIVE", updatedAt: now });
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 })).rejects.toThrow();
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [{ kind: "PROGRAMS", items: [{ handle: "p", name: "현재 예약된 건은 3건입니다.", description: null }] }] })).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
    });
});
function keys(): Keys { return { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" }; }
const secret = "synthetic-unit-secret-0123456789abcdef";
const raw = JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance: "야호 준비물을 알려 주세요", user: { id: "synthetic-guardian" } }, action: { id: "synthetic-action", name: "synthetic" } });
function response(usage: unknown, extra: Record<string, unknown> = {}) {
    return { status: "completed", output: [{ type: "function_call", name: "get_approved_guidance", arguments: JSON.stringify({ topic: "PREPARATION" }) }], usage, ...extra };
}
async function runResponse(body: unknown) {
    const f = fakeDb();
    seedConfig(f);
    f.state.aiServiceConfig[0].provider = "OPENAI";
    await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content: "합성 준비물은 모자입니다.", approved: true, expectedVersion: 0 });
    const transport = vi.fn(async (_body: unknown, _signal: AbortSignal) => { void _body; void _signal; return body; }), provider = openAiProvider("gpt-6-luna", transport);
    const deps: Dependencies = { db: f.db, environment: "PREVIEW", keys: keys(), secret, botId: "synthetic-bot", provider: () => provider, tools: createTools(f.db, "PREVIEW", () => now), clock: () => now };
    const result = await handleSkill(new Headers({ "x-yaho-skill-key": secret }), raw, "synthetic-request-0001", deps);
    return { f, result, deps, transport };
}
const price: Price = { ...billingContract("OPENAI", "gpt-6-luna"), inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, priceVersion: "synthetic-v1" };
describe("Review1-M2 premium usage is charged or held", () => {
    it("settles full cache-write counterexample at2KRW and stores only numeric details", async () => {
        const { f, transport } = await runResponse(response({ input_tokens: 4000, output_tokens: 200, total_tokens: 4200, input_tokens_details: { cache_write_tokens: 4000, cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 20 } }));
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 2, billingUsage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200, cacheWriteTokens: 4000, cachedInputTokens: 0, reasoningOutputTokens: 20 } });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 2, reservedKrw: 0, unknownCount: 0 });
        expect(Object.values(f.state.aiServiceRequest[0].billingUsage as object).every(v => typeof v === "number")).toBe(true);
        expect(f.state.aiServiceRequest[0].priceSnapshot).toMatchObject({ billingContract: "OPENAI_STANDARD_INPUT_MAX_V1", inputCostNumerator: 5, inputCostDenominator: 4 });
        expect(transport.mock.calls[0][0]).toMatchObject({ service_tier: "default", store: false, parallel_tool_calls: false });
    });
    it.each([
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cached_tokens: 2000, cache_write_tokens: 1000 } },
        { input_tokens: 4000, output_tokens: 200 },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: {} },
    ])("charges maximum input without assumed cache discounts %#", async (usage) => {
        const { f } = await runResponse(response(usage));
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 2 });
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(0);
    });
    const invalid = [
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cache_write_tokens: -1 } },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cache_write_tokens: 1.5 } },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cache_write_tokens: "4000" } },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cache_write_tokens: 4001 } },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { cached_tokens: 2000, cache_write_tokens: 3000 } },
        { input_tokens: 4000, output_tokens: 200, output_tokens_details: { reasoning_tokens: 201 } },
        { input_tokens: 4000, output_tokens: 200, total_tokens: 4199 },
        { input_tokens: 4000, output_tokens: 200, input_tokens_details: { future_charge_tokens: 1 } },
        { input_tokens: 4000, output_tokens: 200, additional_billable_tokens: 10 },
        { input_tokens: 4000 },
        null,
    ];
    it.each(invalid)("preserves UNKNOWN hold for invalid/missing/unknown billing metadata %#", async (usage) => {
        const { f, result, deps } = await runResponse(response(usage));
        expect(result.template.outputs[0].simpleText.text).toBe(HANDOFF);
        expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 2, unknownCount: 1 });
        expect(f.state.aiServiceDailyMetric).toHaveLength(0);
        await handleSkill(new Headers({ "x-yaho-skill-key": secret }), raw, "synthetic-request-0002", deps);
        expect(f.state.aiServiceRequest).toHaveLength(1);
    });
    it("unsupported service tier retains cost rather than settling standardprice", async () => {
        const { f } = await runResponse(response({ input_tokens: 4000, output_tokens: 200 }, { service_tier: "priority" }));
        expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN");
        expect(f.state.aiServiceBudgetMonth[0].reservedKrw).toBe(2);
    });
    it("reserve and settlement share immutable premium and reject unregistered contracts", () => {
        expect(conservativeKrw(price, 4000, 200)).toBe(2);
        expect(reserveKrw(price, now)).toBe(conservativeKrw(price, 6000, 256));
        expect(() => conservativeKrw({ ...price, billingContract: "UNVERIFIED" }, 4000, 200)).toThrow();
        expect(() => conservativeKrw({ ...price, inputCostNumerator: 4 }, 4000, 200)).toThrow();
        expect(() => billingContract("GEMINI", "future-model")).toThrow();
        expect(() => validatedBillingUsage({ inputTokens: 4, outputTokens: 2, cacheWriteTokens: 5 })).toThrow();
    });
    it("premium reservation admits only one last-cap request under repository serialization", async () => {
        const f = fakeDb();
        seedConfig(f);
        f.seed("aiServiceBudgetMonth", { id: "b", environment: "PREVIEW", month: "2026-10", capKrw: 1000, usedKrw: 998, reservedKrw: 0, correctionKrw: 0, unknownCount: 0, version: 1 });
        const k = keys();
        const input = (id: string) => ({ environment: "PREVIEW" as const, now, hmacPins: hmacPins(k, "PREVIEW"), requestHashes: hashes(k, "request", "PREVIEW", id), payloadHashes: hashes(k, "payload", "PREVIEW", "synthetic"), subjectHashes: hashes(k, "subject", "PREVIEW", "synthetic") });
        const result = await Promise.allSettled([claim(f.db, input("synthetic-request-0001")), claim(f.db, input("synthetic-request-0002"))]);
        expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 998, reservedKrw: 2 });
    });
});

describe("QA3 numeric provenance and notation-independent private counts", () => {
    it.each(["Ⅷ", "ⅷ", "㆒", "㆓", "〸", "〹", "VIII", "여덟"])("blocks count notation %s at approval/read/catalog/grounding", async notation => {
        const content = "참가 가능 수: " + notation, f = fakeDb(), transport = vi.fn();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content, approved: true });
        await expect(createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "GUIDANCE", content })).toThrow("AI_SERVICE_DENIED");
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [{ kind: "PROGRAMS", items: [{ handle: "p", name: content, description: null }] }] })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(transport).not.toHaveBeenCalled();
    });
    it("rejects every Unicode Number whose NFKC loses numeric classification", () => {
        const numbers: string[] = [];
        for (let cp = 0; cp <= 0x10ffff; cp++) {
            const char = String.fromCodePoint(cp);
            if (/\p{N}/u.test(char) && !/\p{N}/u.test(char.normalize("NFKC")))
                numbers.push(char);
        }
        expect(numbers).toContain("Ⅷ");
        expect(numbers).toContain("㆒");
        for (const char of numbers) {
            expect(() => safePublicText("합성 " + char)).toThrow("AI_SERVICE_DENIED");
            expect(() => safePublicText(char + "숲 12번 출구", 120, "LOCATION")).toThrow("AI_SERVICE_DENIED");
        }
    });
    it("prevents lost numeric provenance hiding in an otherwise valid location", () => {
        expect(() => safePublicText("Ⅷ숲 12번 출구", 120, "LOCATION")).toThrow();
        expect(() => safePublicText("참가 가능 수 여덟 숲 12번 출구", 120, "LOCATION")).toThrow();
        expect(() => safePublicText("예약된 건은 VIII", 120)).toThrow();
    });
    it("preserves decimal date/time/location and fixed availability replies", () => {
        expect(safePublicText("10월 15일 오전 10시 준비 안내")).toBe("10월 15일 오전 10시 준비 안내");
        expect(safePublicText("１０월１５일 오전１０시 준비 안내")).toBe("10월15일 오전10시 준비 안내");
        expect(safePublicText("합성 숲 12번 출구", 120, "LOCATION")).toBe("합성 숲 12번 출구");
        expect(safePublicText("B동 2층 104호", 120, "LOCATION")).toBe("B동 2층 104호");
        for (const status of ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"])
            expect(() => groundedReply({ kind: "AVAILABILITY", status })).not.toThrow();
    });
});

describe("Review2 natural-language quantity boundary", () => {
    const phrases = [
        "여덟 개의 자리가 있습니다.", "최대 수용량은 여덟입니다.", "현재 참가한 가족은 여덟입니다.",
        "여 덟 개 의 자리 가 있습니다.", "여\u200b덟 개의 자리가 있습니다.", "eight places are available.",
        "There are e i g h t places.", "현재 참가한 가족은 두 가족입니다.", "한 개의 자리가 있습니다.",
        "최대 수용량은 충분합니다.", "모집 규모는 담당자 정보입니다.", "현재 참가한 가족은 많습니다.",
    ];
    it.each(phrases)("blocks private quantity or clear numeral through approved guidance: %s", async content => {
        const f = fakeDb();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceKnowledgeEntry).toHaveLength(0);
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content, approved: true });
        await expect(createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "GUIDANCE", content })).toThrow("AI_SERVICE_DENIED");
    });
    it("blocks exact Program-name counterexample at approval, persisted projection, catalog and reply", async () => {
        const f = fakeDb(), content = "여덟 개의 자리가 있습니다.", transport = vi.fn();
        const source = { id: "p", name: content, description: null, status: "ACTIVE", updatedAt: now };
        f.seed("program", source);
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(f.state.aiServiceProgramPublication).toHaveLength(0);
        f.seed("aiServiceProgramPublication", { id: "public-p", environment: "PREVIEW", programId: "p", enabled: true, sourceUpdatedAt: now, sourceDigest: programDigest(source), version: 1 });
        await expect(createTools(f.db, "PREVIEW", () => now).execute({ name: "list_public_programs", args: {} }, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        const catalog = { kind: "PROGRAMS" as const, items: [{ handle: "public-p", name: content, description: null }] };
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [catalog] })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(transport).not.toHaveBeenCalled();
        expect(() => groundedReply(catalog)).toThrow("AI_SERVICE_DENIED");
    });
    it.each([
        "한낮에는 모자를 준비해 주세요.", "두꺼운 옷을 준비해 주세요.", "세심한 보호자 확인이 필요합니다.",
        "열이 나면 담당자에게 문의해 주세요.", "여름에는 물과 모자를 준비해 주세요.",
        "Everyone should bring water.", "Ask someone for guidance.",
    ])("preserves ordinary guidance without treating ambiguous short syllables as numbers: %s", async content => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        expect(groundedReply(await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal()))).toBe(content);
    });
});

describe("canonical numerals are independent of adjacent quantity units", () => {
    it.each(["다섯", "여섯", "일곱", "여덟", "아홉", "서른", "eight", "EIGHT", "twenty", "e-i-g-h-t"])("rejects clear numeral %s in arbitrary free text", numeral => {
        expect(() => safePublicText("합성 " + numeral + " 안내")).toThrow("AI_SERVICE_DENIED");
    });
});
