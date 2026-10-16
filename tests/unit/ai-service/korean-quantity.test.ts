import { describe, it, expect, vi } from "vitest";
import { safePublicText, groundedReply, createTools } from "@/server/ai-service/tools";
import { saveGuidance, savePublication } from "@/server/ai-service/admin";
import { programDigest } from "@/server/ai-service/publication-digest";
import { openAiProvider } from "@/server/ai-service/provider";
import { fakeDb, now } from "./fake-db";
const actor = { userId: "synthetic-admin", role: "ADMIN", active: true };
const signal = () => new AbortController().signal;
const call = { name: "get_approved_guidance" as const, args: { topic: "PREPARATION" as const } };
// Independent expected tables, not imported from the production grammar.
const cardinalUnits = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const attributiveUnits = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const decades = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const expected = Array.from({ length: 99 }, (_, index) => {
    const value = index + 1, tens = Math.floor(value / 10), ones = value % 10;
    return { value, cardinal: decades[tens] + cardinalUnits[ones], attributive: value === 20 ? "스무" : decades[tens] + attributiveUnits[ones] };
});
describe("complete bounded native Korean quantity grammar", () => {
    it.each(expected)("rejects cardinal/adnominal/composite quantity $value", ({ cardinal, attributive }) => {
        expect(() => safePublicText(cardinal)).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText(attributive)).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성 " + cardinal + "만 안내")).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성" + cardinal + "만신청가능합니다.")).toThrow("AI_SERVICE_DENIED");
        for (const particle of ["만", "은", "는", "이", "가", "을", "를", "도", "의"])
            expect(() => safePublicText(cardinal + particle + " 신청 가능합니다.")).toThrow("AI_SERVICE_DENIED");
        for (const unit of ["개", "곳", "명", "자리", "좌석", "가족", "팀"])
            expect(() => safePublicText("합성 " + attributive + " " + unit + "의 안내")).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성 " + [...attributive].join(" ") + " 곳 의 자리 가 있습니다.")).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성 " + cardinal + " 의 자리 가 있습니다.")).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성 " + [...cardinal].join(" ") + " 만 안내")).toThrow("AI_SERVICE_DENIED");
    });
    const chineseOnes = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    const sino = Array.from({ length: 99 }, (_, i) => {
        const n = i + 1, tens = Math.floor(n / 10), ones = n % 10;
        return (tens === 0 ? "" : (tens === 1 ? "" : chineseOnes[tens]) + "십") + chineseOnes[ones];
    });
    it.each(sino)("rejects Sino quantity with unit or numeric copula: %s", numeral => {
        expect(() => safePublicText(numeral + " 명만 신청 가능합니다.")).toThrow("AI_SERVICE_DENIED");
        expect(() => safePublicText("합성 " + numeral + " 개의 자리가 있습니다.")).toThrow("AI_SERVICE_DENIED");
        for (const copula of ["입니다", "이다", "이에요", "예요", "임", "이고", "이며"])
            expect(() => safePublicText("합성 안내는 " + numeral + copula + ".")).toThrow("AI_SERVICE_DENIED");
    });
    it.each(["백", "천", "만", "억", "조"])("rejects explicit large Sino quantity %s", numeral => {
        expect(() => safePublicText(numeral + " 개의 자리가 있습니다.")).toThrow("AI_SERVICE_DENIED");
        for (const copula of ["입니다", "이다", "이에요", "예요", "임", "이고", "이며"])
            expect(() => safePublicText("합성 안내는 " + numeral + copula + ".")).toThrow("AI_SERVICE_DENIED");
    });
    it.each(["한낮에는 모자를 준비해 주세요.", "두꺼운 옷을 준비해 주세요.", "세심한 확인이 필요합니다.", "열이 나면 담당자에게 문의해 주세요.", "치열한 경쟁을 권하지 않습니다.", "이곳에서 모입니다.", "일이 있으면 담당자에게 문의해 주세요.", "만나서 안내합니다.", "꽃이 만개했어요.", "일자리에 관한 안내는 담당자에게 문의해 주세요."])("preserves normal words without treating every syllable as a numeral: %s", text => expect(safePublicText(text)).toBe(text));
    it("preserves decimal date/time, LOCATION and fixed availability", () => {
        expect(safePublicText("10월 15일 오전 10시 준비 안내")).toBe("10월 15일 오전 10시 준비 안내");
        expect(safePublicText("합성 숲 12번 출구", 120, "LOCATION")).toBe("합성 숲 12번 출구");
        expect(safePublicText("B동 2층 104호", 120, "LOCATION")).toBe("B동 2층 104호");
        for (const status of ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"])
            expect(() => groundedReply({ kind: "AVAILABILITY", status })).not.toThrow();
    });
});
describe("Review3 actual public boundaries", () => {
    const examples = ["쉰 개의 자리가 있습니다.", "두 곳의 자리가 있습니다.", "둘만 신청 가능합니다."];
    it.each(examples)("blocks exact guidance and Program counterexample: %s", async (content) => {
        const f = fakeDb(), transport = vi.fn();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content, approved: true });
        await expect(createTools(f.db, "PREVIEW", () => now).execute(call, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "GUIDANCE", content })).toThrow("AI_SERVICE_DENIED");
        const source = { id: "p", name: content, description: null, status: "ACTIVE", updatedAt: now };
        f.seed("program", source);
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        f.seed("aiServiceProgramPublication", { id: "public-p", environment: "PREVIEW", programId: "p", enabled: true, sourceUpdatedAt: now, sourceDigest: programDigest(source), version: 1 });
        await expect(createTools(f.db, "PREVIEW", () => now).execute({ name: "list_public_programs", args: {} }, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        const catalog = { kind: "PROGRAMS" as const, items: [{ handle: "public-p", name: content, description: null }] };
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [catalog] })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(transport).not.toHaveBeenCalled();
        expect(() => groundedReply(catalog)).toThrow("AI_SERVICE_DENIED");
    });
    it.each(["최대 수용량은 충분합니다.", "현재 참가한 가족은 많습니다.", "모집 규모는 내부 정보입니다."])("keeps private quantity concepts private without digits: %s", text => expect(() => safePublicText(text)).toThrow("AI_SERVICE_DENIED"));
});
describe("Review4 numeric assertion and raw capacity projection", () => {
    it.each(["현재 자리는 삼입니다.", "현재 자리는 십입니다.", "현재 자리는 백입니다."])("blocks guidance/Program/catalog/final exact assertion %s", async (content) => {
        const f = fakeDb(), transport = vi.fn();
        await expect(saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content, approved: true });
        await expect(createTools(f.db, "PREVIEW", () => now).execute(call, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        expect(() => groundedReply({ kind: "GUIDANCE", content })).toThrow("AI_SERVICE_DENIED");
        const source = { id: "p", name: content, description: null, status: "ACTIVE", updatedAt: now };
        f.seed("program", source);
        await expect(savePublication(f.db, "PREVIEW", actor, { kind: "PROGRAM", id: "p", enabled: true, expectedVersion: 0 })).rejects.toThrow("AI_SERVICE_DENIED");
        f.seed("aiServiceProgramPublication", { id: "public-p", environment: "PREVIEW", programId: "p", enabled: true, sourceUpdatedAt: now, sourceDigest: programDigest(source), version: 1 });
        await expect(createTools(f.db, "PREVIEW", () => now).execute({ name: "list_public_programs", args: {} }, signal())).rejects.toThrow("AI_SERVICE_DENIED");
        const catalog = { kind: "PROGRAMS" as const, items: [{ handle: "public-p", name: content, description: null }] };
        await expect(openAiProvider("gpt-6-luna", transport).classify({ utterance: "야호 프로그램", signal: signal(), catalog: [catalog] })).rejects.toThrow("AI_SERVICE_DENIED");
        expect(transport).not.toHaveBeenCalled();
        expect(() => groundedReply(catalog)).toThrow("AI_SERVICE_DENIED");
    });
    it.each(["현재 자리는 담당자 정보입니다.", "좌석 정보는 담당자가 안내합니다.", "전체 정원과 수용량은 운영 정보입니다.", "자리는 담당자 정보입니다.", "자리는 삼이라고 합니다.", "자리는 三이라고 합니다."])("rejects raw capacity quantity concepts before parsing numerals: %s", text => expect(() => safePublicText(text)).toThrow("AI_SERVICE_DENIED"));
    it.each(["예약 신청은 담당자 확인 후 확정됩니다.", "프로그램과 일정 안내는 담당자에게 문의해 주세요.", "신청 정보 변경은 담당자에게 문의해 주세요."])("preserves generic reservation process through approved guidance: %s", async (content) => {
        const f = fakeDb();
        await saveGuidance(f.db, "PREVIEW", actor, { topic: "PREPARATION", content, approved: true, expectedVersion: 0 });
        expect(groundedReply(await createTools(f.db, "PREVIEW", () => now).execute(call, signal()))).toBe(content);
    });
});
