import { describe, expect, it } from "vitest";
import type { ToolCall } from "@/server/ai-service/contracts";
import { authorizeSelection, extractRequestedMonths, selectionCatalog } from "@/server/ai-service/selection-policy";
import { syntheticContext } from "../../eval/ai-service/synthetic";
import { HANDLES } from "../../eval/ai-service/fixtures";

const signal = () => new AbortController().signal;
const classes: ToolCall = { name: "list_public_classes", args: { programHandle: null } };
const programs: ToolCall = { name: "list_public_programs", args: {} };
const rain: ToolCall = { name: "get_approved_guidance", args: { topic: "RAIN" } };
const december: ToolCall = { name: "get_class_availability", args: { classHandle: HANDLES.decemberClass } };

async function context() {
    const { tools } = syntheticContext();
    const catalog = selectionCatalog([await tools.execute(programs, signal()), await tools.execute(classes, signal())]);
    return { catalog };
}

/**
 * REVIEW condition (1): direct unit tests for the month-matching rejection
 * branches. The eval oracle (scriptedCall) returns null for these utterances,
 * so executeSelection never reaches authorizeSelection's month logic through
 * the eval path -- these cases call authorizeSelection directly, as a real
 * model (which may return a Tool for a rejected utterance) would exercise it.
 */
describe("month matching: direct authorization of rejection branches", () => {
    it.each<[string, ToolCall]>([
        ["11월 숲체험 일정 알려주세요.", classes],
        ["13월 숲체험 일정 알려주세요.", classes],
        ["12월 5일 숲체험 일정 알려주세요.", classes],
        ["2026년 12월 숲체험 일정 알려주세요.", classes],
        ["다음 달 숲 일정 알려주세요.", classes],
        ["12월 우천 안내 알려주세요.", rain],
        ["12월 프로그램 목록 알려주세요.", programs],
        ["12월 토요일 숲 신청 가능한가요?", december],
        ["11월12월 숲체험 일정 알려주세요.", classes],
    ])("denies month-mismatched selection: %s", async (question, call) => {
        const { catalog } = await context();
        expect(authorizeSelection(question, call, catalog)).toEqual({ allowed: false });
    });

    it.each<[string, ToolCall]>([
        ["12월 숲체험 일정 알려주세요.", classes],
        ["12월 일요일 숲 신청 가능한가요?", december],
    ])("allows month-matched selection: %s", async (question, call) => {
        const { catalog } = await context();
        expect(authorizeSelection(question, call, catalog)).toEqual({ allowed: true, call });
    });
});

describe("extractRequestedMonths: direct parser cases", () => {
    it.each<[string, number[]]>([
        ["11월12월", [11, 12]],
        ["13월", []],
        ["2026년12월", [12]],
        ["12월", [12]],
    ])("parses %s as %s", (compacted, expected) => {
        expect(extractRequestedMonths(compacted)).toEqual(expected);
    });
});
