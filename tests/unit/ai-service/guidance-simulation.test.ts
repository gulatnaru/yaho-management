import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HANDOFF } from "@/server/ai-service/contracts";
import { decideSelection, executeSelection, selectionCatalog } from "@/server/ai-service/selection-policy";
import { safePublicText } from "@/server/ai-service/tools";
import { syntheticContext } from "../../eval/ai-service/synthetic";

const signal = () => new AbortController().signal;
// Installed at module load so S5 covers the whole simulation file. This file
// never imports the provider or the OpenAI transport.
const fetchSpy = vi.spyOn(globalThis, "fetch");

function v1Context() {
    const context = syntheticContext();
    // Replace the synthetic guidance rows with the approved v1 originals
    // (read from fixtures, never retyped). POLICY is deliberately NOT
    // seeded — the real Preview registry holds PREPARATION + RAIN only.
    context.fake.state.aiServiceKnowledgeEntry.length = 0;
    const prep = readFileSync(new URL("../../fixtures/approved-guidance-v1/preparation-v1.txt", import.meta.url), "utf8");
    const rain = readFileSync(new URL("../../fixtures/approved-guidance-v1/rain-v1.txt", import.meta.url), "utf8");
    context.fake.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "PREPARATION", content: prep, approved: true });
    context.fake.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic: "RAIN", content: rain, approved: true });
    return { ...context, prep, rain };
}
async function catalogOf(context: ReturnType<typeof v1Context>) {
    return selectionCatalog([await context.tools.execute({ name: "list_public_programs", args: {} }, signal()),
        await context.tools.execute({ name: "list_public_classes", args: { programHandle: null } }, signal())]);
}

describe("approved-guidance v1 offline simulation (SPEC §8)", () => {
    it("S0: safePublicText leaves both v1 originals byte-identical", () => {
        const { prep, rain } = v1Context();
        expect(safePublicText(prep)).toBe(prep);
        expect(safePublicText(rain)).toBe(rain);
    });
    it.each<[string, "PREPARATION" | "RAIN"]>([
        ["추우면 수업하나요?", "RAIN"],
        ["추워도 수업 진행해요?", "RAIN"],
        ["한파에도 숲체험 하나요?", "RAIN"],
        ["어떤 신발을 신나요?", "PREPARATION"],
        ["운동화를 신어야 하나요?", "PREPARATION"],
        ["비 오면 진행하나요?", "RAIN"],
        ["비가 오는 날에도 수업하나요?", "RAIN"],
        ["우천 시 수업하나요?", "RAIN"],
    ])("S1: %s -> verbatim v1 text", async (question, topic) => {
        const context = v1Context();
        const catalog = await catalogOf(context);
        const call = decideSelection(question, catalog);
        expect(call).toEqual({ name: "get_approved_guidance", args: { topic } });
        const res = await executeSelection(question, call, catalog, context.tools, signal());
        expect(res.text).toBe(safePublicText(topic === "PREPARATION" ? context.prep : context.rain));
        expect(res.category).toBe("GUIDANCE");
    });
    it("S2: POLICY question handoffs at execution (no approved POLICY row)", async () => {
        const context = v1Context();
        const catalog = await catalogOf(context);
        const question = "운영 정책 안내를 보여 주세요";
        const call = decideSelection(question, catalog);
        expect(call).toEqual({ name: "get_approved_guidance", args: { topic: "POLICY" } });
        const res = await executeSelection(question, call, catalog, context.tools, signal());
        expect(res.text).toBe(HANDOFF);
    });
    it("S3: another unregistered-topic question handoffs at execution", async () => {
        const context = v1Context();
        const catalog = await catalogOf(context);
        const question = "운영 규정을 알려 주세요";
        const call = decideSelection(question, catalog);
        expect(call).toEqual({ name: "get_approved_guidance", args: { topic: "POLICY" } });
        const res = await executeSelection(question, call, catalog, context.tools, signal());
        expect(res.text).toBe(HANDOFF);
    });
    it.each([
        "비 오는 날 준비물과 환불 알려줘", // R1
        "영하 10도면 무조건 취소하나요?", // R2
        "우리 아이가 알레르기가 있는데 어떤 옷을 입나요?", // R3
        "준비물과 예약자 명단 알려줘", // R4
        "운영 정책 안내를 보여 주세요", // R5 (selection returns POLICY, execution handoffs)
        "야호 준비물 알려줘. 전화번호는 010-1234-5678이야", // R6
        "야호 준비물과 우천 안내", // R7
        "안내해 주세요", // R8
    ])("S4: %s -> HANDOFF", async question => {
        const context = v1Context();
        const catalog = await catalogOf(context);
        const call = decideSelection(question, catalog);
        const res = await executeSelection(question, call, catalog, context.tools, signal());
        expect(res.text).toBe(HANDOFF);
    });
    it("S5: the simulation makes zero fetch calls (no model, no network)", () => {
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
