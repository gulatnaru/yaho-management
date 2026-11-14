import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleSkill, type Dependencies } from "@/server/ai-service/handler";
import { HANDOFF, type ToolCall } from "@/server/ai-service/contracts";
import type { ToolResult } from "@/server/ai-service/tools";
import { fakeDb, seedConfig, now } from "./fake-db";
const secret = "synthetic-selection-secret-0123456789";
const body = (utterance: string) => JSON.stringify({ bot: { id: "synthetic-bot" }, userRequest: { utterance, user: { id: "synthetic-subject" } }, action: { id: "synthetic-action", name: "synthetic" } });
function setup() {
    const f = fakeDb(); seedConfig(f);
    const execute = vi.fn(async (call: ToolCall): Promise<ToolResult> => call.name === "list_public_programs" ? { kind: "PROGRAMS" as const, items: [] } : call.name === "list_public_classes" ? { kind: "CLASSES" as const, items: [] } : { kind: "GUIDANCE" as const, content: "합성 준비물은 모자입니다." });
    const deps: Dependencies = { db: f.db, environment: "PREVIEW", secret, botId: "synthetic-bot", clock: () => now,
        keys: { encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" },
        tools: { execute } };
    const run = async (question = "야호 준비물을 알려 주세요") => (await handleSkill(new Headers({ "x-yaho-skill-key": secret }), body(question), "synthetic-selection-request-001", deps)).template.outputs[0].simpleText.text;
    return { f, deps, execute, run };
}
describe("handler selection boundaries and billing", () => {
    it.each([
        "야호 준비물과 우천 안내",
        "야호 운영정책에 결제 안내",
        "야호 준비물 그리고 추천 식당",
        "야호 신청 가능한가요",
    ])("executes only trusted preloads on undecidable requests %#", async question => {
        const { run, execute, f } = setup();
        expect(await run(question)).toBe(HANDOFF);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });
    it.each(["야호 준비물과 우천 안내", "야호 운영정책에 결제 안내", "야호 준비물 그리고 추천 식당"])("rejects mixed content even with a valid read choice: %s", async q => {
        const { run, execute } = setup(); expect(await run(q)).toBe(HANDOFF); expect(execute).toHaveBeenCalledTimes(2);
    });
    it("validates again before freshness execution instead of trusting a previously accepted mutable selection", async () => {
        const { run, execute } = setup();
        let guidanceReads = 0;
        execute.mockImplementation(async call => {
            if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
            if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] };
            return { kind: "GUIDANCE", content: ++guidanceReads === 1 ? "합성 준비물은 모자입니다." : "합성 준비물은 우산입니다." };
        });
        expect(await run()).toBe(HANDOFF);
        expect(execute).toHaveBeenCalledTimes(4);
        expect(guidanceReads).toBe(2);
    });
    it("hides publication changes during post-settlement re-read and settles known at 0 KRW once", async () => {
        const { run, execute, f } = setup(); let selectedReads = 0;
        execute.mockImplementation(async call => call.name === "list_public_programs" ? { kind: "PROGRAMS", items: [] } : call.name === "list_public_classes" ? { kind: "CLASSES", items: [] } : { kind: "GUIDANCE", content: ++selectedReads === 1 ? "합성 준비물은 모자입니다." : null });
        expect(await run()).toBe(HANDOFF); expect(selectedReads).toBe(2);
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });
    it("returns fixed handoff for selected execution failure and never raw error", async () => {
        const { run, execute, f } = setup();
        execute.mockImplementation(async call => { if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] }; if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] }; throw new Error("secret failure"); });
        expect(await run()).toBe(HANDOFF); expect(execute).toHaveBeenCalledTimes(3); expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
    });
    it("bounds a stuck selected tool at 200ms and holds the unknown charge", async () => {
        vi.useFakeTimers();
        try {
            const { run, execute, f } = setup();
            execute.mockImplementation(async call => {
                if (call.name === "list_public_programs") return { kind: "PROGRAMS", items: [] };
                if (call.name === "list_public_classes") return { kind: "CLASSES", items: [] };
                return new Promise<ToolResult>(() => {});
            });
            const response = run(); await vi.advanceTimersByTimeAsync(201);
            expect(await response).toBe(HANDOFF);
            expect(f.state.aiServiceRequest[0].status).toBe("UNKNOWN");
            expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 2, unknownCount: 1 });
        } finally { vi.useRealTimers(); }
    });
    it("returns handoff before claim when the account-number word rides along (COND-1)", async () => {
        const { run, execute, f } = setup();
        expect(await run("야호 준비물 알려줘. 계좌번호는 123-456-789야")).toBe(HANDOFF);
        expect(execute).not.toHaveBeenCalled();
        expect(f.state.aiServiceRequest).toHaveLength(0);
    });
});

// Handler gate + classifier phrasing (2026-11-14, SPEC §3 / PLAN §4.2 Level B).
// Added red-first: the 8 accepted phrasings return HANDOFF on the pre-change
// code (5 gate-blocked, 3 classifier-blocked — see the gate baseline probe).
// The mocked tools return "합성 준비물은 모자입니다." for any guidance call,
// so this level asserts gate pass + grounded reply, not the v1 wording
// (that is the simulation's job, S1).
describe("handler gate + classifier phrasing (SPEC §3)", () => {
    it.each([
        "추우면 수업하나요?",
        "추워도 수업 진행해요?",
        "한파에도 숲체험 하나요?",
        "어떤 신발을 신나요?",
        "운동화를 신어야 하나요?",
        "비 오면 진행하나요?",
        "비가 오는 날에도 수업하나요?",
        "우천 시 수업하나요?",
    ])("grounds the accepted phrasing: %s", async question => {
        const { run, execute, f } = setup();
        expect(await run(question)).toBe("합성 준비물은 모자입니다.");
        expect(execute).toHaveBeenCalledTimes(4);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });
    it.each([
        "비용이 얼마예요?",
        "비공개 수업 하나요?",
        "환불 하나요?",
        "정원 하나요?",
        "영하에도 수업하나요?",
        "추운데도 수업하나요?",
    ])("gate blocks before claim: %s", async question => {
        const { run, execute, f } = setup();
        expect(await run(question)).toBe(HANDOFF);
        expect(execute).not.toHaveBeenCalled();
        expect(f.state.aiServiceRequest).toHaveLength(0);
    });
    it.each([
        "추석 일정 알려주세요", // gate passes on 일정, classifier blocks on residual 추석
        "예약자 명단 하나요?", // gate passes on 예약, classifier blocks on forbidden 예약자·명단
        "비 오는 날 준비물과 환불 알려줘", // R1: gate passes on 준비물, forbidden 환불 blocks
        "준비물과 예약자 명단 알려줘", // R4: gate passes on 준비물, forbidden 예약자·명단 blocks
    ])("classifier blocks after preloads only: %s", async question => {
        const { run, execute, f } = setup();
        expect(await run(question)).toBe(HANDOFF);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(f.state.aiServiceRequest[0].status).toBe("SETTLED");
        expect(f.state.aiServiceBudgetMonth[0]).toMatchObject({ usedKrw: 0, reservedKrw: 0 });
    });
});
