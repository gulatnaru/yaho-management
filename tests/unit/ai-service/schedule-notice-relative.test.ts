import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safePublicText, groundedReply, createTools } from "@/server/ai-service/tools";
import { fakeDb } from "./fake-db";
const prepPath = new URL("../../fixtures/approved-guidance-v1/preparation-v1.txt", import.meta.url);
const rainPath = new URL("../../fixtures/approved-guidance-v1/rain-v1.txt", import.meta.url);
const prep = readFileSync(prepPath, "utf8");
const rain = readFileSync(rainPath, "utf8");
const signal = () => new AbortController().signal;
// Accept set (PLAN §1.1): all eight must pass byte-identical.
const accept = [
    prep,
    rain,
    "10월 15일 오전 10시 준비 안내",
    "수업 시작 1시간 전까지 안내드립니다.",
    "수업 시작 24시간 전까지 안내드립니다.",
    "시작 2시간 전까지 안내드립니다.",
    "수업 시작 2시간 전입니다.",
    "수업 시작 두 시간 전에 알려드립니다.",
];
// Reject set (PLAN §1.1): all twelve must throw AI_SERVICE_DENIED.
const reject = [
    "수업 시작 0시간 전에 알려드립니다.",
    "수업 시작 25시간 전에 알려드립니다.",
    "수업 시작 100시간 전에 알려드립니다.",
    "수업 시작 2시간 전에 5명이 모입니다.",
    "수업 시작 2시간 전에 10월 15일 일정을 알려드립니다.",
    "2시간 전에 알려드립니다.",
    "수업 2시간 전에 알려드립니다.",
    "수업 시작 2시간 후에 알려드립니다.",
    "수업 시작 2시간 전에 010-1234-5678로 연락주세요.",
    "수업 시작 2시간 전에 정원은 8명입니다.",
    "안내는 3건입니다.",
    "수업 시작 2시간 전에 5% 할인을 안내합니다.",
];
describe("schedule-notice relative-time gate (OQ-1)", () => {
    it.each(accept)("accepts: %s", (text) => {
        expect(safePublicText(text)).toBe(text);
    });
    it.each(reject)("rejects: %s", (text) => {
        expect(() => safePublicText(text)).toThrow("AI_SERVICE_DENIED");
    });
    it("returns the RAIN v1 text verbatim through the guidance read path", async () => {
        const f = fakeDb();
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "RAIN", content: rain, approved: true, updatedById: "synthetic-admin" });
        const tools = createTools(f.db, "PREVIEW");
        const result = await tools.execute({ name: "get_approved_guidance", args: { topic: "RAIN" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content: rain });
        expect(groundedReply(result)).toBe(rain);
    });
    it("returns HANDOFF through the guidance read path when the row is unapproved", async () => {
        const f = fakeDb();
        f.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "RAIN", content: rain, approved: false, updatedById: "synthetic-admin" });
        const tools = createTools(f.db, "PREVIEW");
        const result = await tools.execute({ name: "get_approved_guidance", args: { topic: "RAIN" } }, signal());
        expect(result).toEqual({ kind: "GUIDANCE", content: null });
        expect(groundedReply(result)).toBe("확인 가능한 안내가 없습니다. 담당자에게 문의해 주세요.");
    });
});
