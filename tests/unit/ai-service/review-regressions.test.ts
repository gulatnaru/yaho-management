import { describe, it, expect, vi } from "vitest";
import { claimAuth } from "./auth-fixture";
import { safePublicText, createTools, groundedReply } from "@/server/ai-service/tools";
import { saveGuidance, savePublication } from "@/server/ai-service/admin";
import { openAiProvider } from "@/server/ai-service/provider";
import { billingContract, validatedBillingUsage, type BillingUsage } from "@/server/ai-service/billing";
import { conservativeKrw, reserveKrw, type Price } from "@/server/ai-service/cost";
import { claim, markDispatched, settle } from "@/server/ai-service/ledger";
import { hashes, hmacPins, type Keys } from "@/server/ai-service/crypto";
import { fakeDb, seedConfig, now } from "./fake-db";
const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
const numericTexts = [
    "현재 예약된 건은 3건입니다.", "참가 가능 수: 8",
    "현재 예약된 건은 ３건입니다.", "참가 가능 수: ８",
    "현재 예약된 건은 3월 3일입니다.", "참가 가능 수: 8시 준비 안내",
    "현재 예\u200b약된 건은 ３건입니다.", "참가 가능 수: ⑧",
    "Enrollment total 3", "총 세 건", "3월 3일 참가 가능 수",
];
const guidanceCall = { name: "get_approved_guidance" as const, args: { topic: "PREPARATION" as const } };
const signal = () => new AbortController().signal;
describe("Review1-M1 numeric free text fails closed", () => {
    it.each(numericTexts)("allows numeric text at approval/read/grounding: %s", async (content) => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        const normalized = safePublicText(content);
        expect(groundedReply(await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal()))).toBe(normalized);
        expect(groundedReply({ kind: "GUIDANCE", content })).toBe(normalized);
        expect(groundedReply({ kind: "PROGRAMS", items: [{ handle: "p", name: content, description: null }] })).toBe(normalized);
        expect(groundedReply({ kind: "CLASSES", items: [{ handle: "c", programHandle: "p", startsAt: now.toISOString(), endsAt: now.toISOString(), location: content }] })).toContain(normalized);
    });
    it.each(["10월 15일 오전 10시 준비 안내", "２０２６년１０월１５일１０시", "2026년 10월 15일 오전 10시 05분"])("preserves entire valid date/time guidance through actual flow: %s", async (content) => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        const result = await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal());
        expect(groundedReply(result)).toBe(content.normalize("NFKC"));
    });
    it.each(["2월 30일 준비 안내", "13월 15일 준비 안내", "오전 0시 준비 안내", "24시 준비 안내", "10시 60분 준비 안내", "30", "10월 15일 8", "어린이 8 프로그램", "모집 안내 8월 8일"])("allows arbitrary digits without validating schedule semantics: %s", text => expect(safePublicText(text)).toBe(text));
    it.each(["합성 숲 12번 출구", "B동 2층 104호", "합성로 123-4"])("allows numeric location in both text kinds: %s", text => {
        expect(safePublicText(text, 120, "LOCATION")).toBe(text);
        expect(safePublicText(text)).toBe(text);
    });
    it("allows numeric source approval and model catalog", async () => {
        const f = fakeDb(), transport = vi.fn(async () => response({ input_tokens: 10, output_tokens: 1 }));
        f.seed("program", { id: "p", name: "참가 가능 수: 8", description: null, status: "ACTIVE", updatedAt: now });
        await savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 });
        await openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [{ kind: "PROGRAMS", items: [{ handle: "p", name: "현재 예약된 건은 3건입니다.", description: null }] }] });
        expect(transport).toHaveBeenCalledTimes(1);
    });
});
function keys(): Keys { return { encryption: { v1: Buffer.alloc(32, 1) }, hmac: { v1: Buffer.alloc(32, 2) }, activeEncryption: "v1", activeHmac: "v1" }; }
function response(usage: unknown, extra: Record<string, unknown> = {}) {
    return { status: "completed", output: [{ type: "function_call", name: "get_approved_guidance", arguments: JSON.stringify({ topic: "PREPARATION" }) }], usage, ...extra };
}
/** Ledger-level settlement of a model call (OQ-12 P0-A): the handler no longer
 * calls a model, so premium-usage billing is verified by settling a claimed
 * row directly with modelCalled true. The provider boundary (invalid usage /
 * unsupported tier) is verified separately through openAiProvider.classify. */
async function runSettlement(usage: BillingUsage) {
    const f = fakeDb();
    seedConfig(f);
    f.state.aiServiceConfig[0].provider = "OPENAI";
    const k = keys();
    const c = await claim(f.db, { authContext: claimAuth(), environment: "PREVIEW", now, hmacPins: hmacPins(k, "PREVIEW"),
        requestHashes: hashes(k, "request", "PREVIEW", "synthetic-request-0001"),
        payloadHashes: hashes(k, "payload", "PREVIEW", "synthetic"),
        subjectHashes: hashes(k, "subject", "PREVIEW", "synthetic") });
    if (c.kind !== "CLAIMED") throw new Error("claim failed");
    await markDispatched(f.db, "PREVIEW", c.row.id, 1, now);
    await settle(f.db, "PREVIEW", c.row.id, 1, { kind: "KNOWN", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        billingUsage: usage, category: "GUIDANCE", modelCalled: true }, now);
    return { f };
}
const price: Price = { ...billingContract("OPENAI", "gpt-6-luna"), inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, priceVersion: "synthetic-v1" };
describe("Review1-M2 premium usage is charged or held", () => {
    it("settles full cache-write counterexample at2KRW and stores only numeric details", async () => {
        const { f } = await runSettlement({ inputTokens: 4000, outputTokens: 200, totalTokens: 4200, cacheWriteTokens: 4000, cachedInputTokens: 0, reasoningOutputTokens: 20 });
        expect(f.state.aiServiceRequest[0]).toMatchObject({ status: "SETTLED", usedKrw: 2, billingUsage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200, cacheWriteTokens: 4000, cachedInputTokens: 0, reasoningOutputTokens: 20 } });
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 2, reservedKrw: 0, unknownCount: 0 });
        expect(Object.values(f.state.aiServiceRequest[0].billingUsage as object).every(v => typeof v === "number")).toBe(true);
        expect(f.state.aiServiceRequest[0].priceSnapshot).toMatchObject({ billingContract: "OPENAI_STANDARD_INPUT_MAX_V1", inputCostNumerator: 5, inputCostDenominator: 4 });
    });
    it.each([
        { inputTokens: 4000, outputTokens: 200, cachedInputTokens: 2000, cacheWriteTokens: 1000 },
        { inputTokens: 4000, outputTokens: 200 },
        { inputTokens: 4000, outputTokens: 200 },
    ])("charges maximum input without assumed cache discounts %#", async (usage) => {
        const { f } = await runSettlement(usage);
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
    it.each(invalid)("rejects invalid/missing/unknown billing metadata at the provider boundary %#", async (usage) => {
        const transport = vi.fn(async () => response(usage));
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [] })).rejects.toThrow();
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it("unsupported service tier is rejected at the provider boundary rather than settling standard price", async () => {
        const transport = vi.fn(async () => response({ input_tokens: 4000, output_tokens: 200 }, { service_tier: "priority" }));
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [] })).rejects.toThrow();
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
        const input = (id: string) => ({ authContext: claimAuth(), environment: "PREVIEW" as const, now, hmacPins: hmacPins(k, "PREVIEW"), requestHashes: hashes(k, "request", "PREVIEW", id), payloadHashes: hashes(k, "payload", "PREVIEW", "synthetic"), subjectHashes: hashes(k, "subject", "PREVIEW", "synthetic") });
        const result = await Promise.allSettled([claim(f.db, input("synthetic-request-0001")), claim(f.db, input("synthetic-request-0002"))]);
        expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 998, reservedKrw: 2 });
    });
});

describe("QA3 numeric provenance and notation-independent private counts", () => {
    it.each(["Ⅷ", "ⅷ", "㆒", "㆓", "〸", "〹", "VIII", "여덟"])("allows count notation %s at approval/read/catalog/grounding", async notation => {
        const content = "참가 가능 수: " + notation, f = fakeDb(), transport = vi.fn(async () => response({ input_tokens: 10, output_tokens: 1 }));
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        const normalized = safePublicText(content);
        expect(groundedReply(await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal()))).toBe(normalized);
        expect(groundedReply({ kind: "GUIDANCE", content })).toBe(normalized);
        await openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [{ kind: "PROGRAMS", items: [{ handle: "p", name: content, description: null }] }] });
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it("allows Unicode Numbers whose NFKC loses numeric classification", () => {
        const numbers: string[] = [];
        for (let cp = 0; cp <= 0x10ffff; cp++) {
            const char = String.fromCodePoint(cp);
            if (/\p{N}/u.test(char) && !/\p{N}/u.test(char.normalize("NFKC"))) numbers.push(char);
        }
        expect(numbers).toContain("Ⅷ");
        expect(numbers).toContain("㆒");
        for (const char of numbers) {
            expect(safePublicText("합성 " + char)).toBe(("합성 " + char).normalize("NFKC"));
            expect(safePublicText(char + "숲 12번 출구", 120, "LOCATION")).toBe((char + "숲 12번 출구").normalize("NFKC"));
        }
    });
    it("allows numeric provenance and quantity in location and text", () => {
        expect(safePublicText("Ⅷ숲 12번 출구", 120, "LOCATION")).toBe("VIII숲 12번 출구");
        expect(safePublicText("참가 가능 수 여덟 숲 12번 출구", 120, "LOCATION")).toBe("참가 가능 수 여덟 숲 12번 출구");
        expect(safePublicText("예약된 건은 VIII", 120)).toBe("예약된 건은 VIII");
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
    it.each(phrases)("allows quantity through approved guidance: %s", async content => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        expect(groundedReply(await createTools(f.db, "PREVIEW", () => now).execute(guidanceCall, signal()))).toBe(safePublicText(content));
        expect(groundedReply({ kind: "GUIDANCE", content })).toBe(safePublicText(content));
    });
    it("allows Program-name quantity at approval, projection, catalog and reply", async () => {
        const f = fakeDb(), content = "여덟 개의 자리가 있습니다.", transport = vi.fn(async () => response({ input_tokens: 10, output_tokens: 1 }));
        const source = { id: "p", name: content, description: null, status: "ACTIVE", updatedAt: now };
        f.seed("program", source);
        await savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 });
        const result = await createTools(f.db, "PREVIEW", () => now).execute({ name: "list_public_programs", args: {} }, signal());
        expect(groundedReply(result)).toBe(content);
        const catalog = { kind: "PROGRAMS" as const, items: [{ handle: "public-p", name: content, description: null }] };
        await openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [catalog] });
        expect(transport).toHaveBeenCalledTimes(1);
        expect(groundedReply(catalog)).toBe(content);
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
    it.each(["다섯", "여섯", "일곱", "여덟", "아홉", "서른", "eight", "EIGHT", "twenty", "e-i-g-h-t"])("allows numeral %s in arbitrary free text", numeral => {
        expect(safePublicText("합성 " + numeral + " 안내")).toBe("합성 " + numeral + " 안내");
    });
});
