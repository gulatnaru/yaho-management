import { describe, expect, it } from "vitest";
import { deriveStableRequestId } from "@/server/ai-service/request-id";

const base = { botId: "synthetic-bot", userId: "synthetic-guardian", blockId: "synthetic-block",
    utterance: "야호 준비물을 알려 주세요", now: new Date("2026-11-08T00:02:00Z") };

describe("deriveStableRequestId (SPEC OQ-9 server heuristic hash)", () => {
    it("F-7 is deterministic for identical inputs and matches the request-id format", () => {
        const first = deriveStableRequestId(base);
        const second = deriveStableRequestId(base);
        expect(first).toBe(second);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    it("F-7 changes the id when the utterance, user, or block changes", () => {
        const id = deriveStableRequestId(base);
        expect(deriveStableRequestId({ ...base, utterance: "12월 숲체험 일정 알려주세요." })).not.toBe(id);
        expect(deriveStableRequestId({ ...base, userId: "synthetic-other-guardian" })).not.toBe(id);
        expect(deriveStableRequestId({ ...base, blockId: "synthetic-other-block" })).not.toBe(id);
    });

    it("F-7 keeps the same id inside one 5-minute window and changes it across the boundary", () => {
        const id = deriveStableRequestId(base);
        expect(deriveStableRequestId({ ...base, now: new Date("2026-11-08T00:04:59Z") })).toBe(id);
        expect(deriveStableRequestId({ ...base, now: new Date("2026-11-08T00:05:00Z") })).not.toBe(id);
        expect(deriveStableRequestId({ ...base, now: new Date("2026-11-08T00:09:59Z") })).not.toBe(id);
    });

    it("F-7 allows an empty block id but rejects a missing bot, user, utterance, or time", () => {
        expect(deriveStableRequestId({ ...base, blockId: "" })).toMatch(/^[0-9a-f]{64}$/);
        expect(() => deriveStableRequestId({ ...base, botId: "" })).toThrow("AI_SERVICE_DENIED");
        expect(() => deriveStableRequestId({ ...base, userId: "" })).toThrow("AI_SERVICE_DENIED");
        expect(() => deriveStableRequestId({ ...base, utterance: "" })).toThrow("AI_SERVICE_DENIED");
        expect(() => deriveStableRequestId({ ...base, now: new Date("invalid") })).toThrow("AI_SERVICE_DENIED");
    });

    it("F-7 does not normalise the utterance: a spacing change is a different request", () => {
        expect(deriveStableRequestId({ ...base, utterance: "야호  준비물을 알려 주세요" })).not.toBe(deriveStableRequestId(base));
    });
});
