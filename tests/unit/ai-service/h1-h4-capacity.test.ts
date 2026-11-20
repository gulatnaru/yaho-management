import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeApprovedGuidanceText } from "@/server/ai-service/approved-guidance-text";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const draftV2 = readFileSync(new URL("../../fixtures/approved-guidance-v1/policy-v2-draft.txt", import.meta.url), "utf8");
const texts = Object.fromEntries((["PREPARATION", "RAIN", "POLICY"] as const).map(topic => [topic, readFileSync(new URL(`../../fixtures/approved-guidance-v1/${topic.toLowerCase()}-v1.txt`, import.meta.url), "utf8")])) as Record<"PREPARATION" | "RAIN" | "POLICY", string>;
const deniedV1 = readFileSync(new URL("../../fixtures/approved-guidance-v1/policy-v1-denied.txt", import.meta.url), "utf8");

describe("numeric guidance policy", () => {
    it("allows the revised unapproved v2 draft with exact bytes", () => {
        expect(draftV2.length).toBe(220);
        expect(Buffer.byteLength(draftV2)).toBe(508);
        expect(draftV2.endsWith("\n")).toBe(false);
        expect(draftV2).toBe("1. 신청 마감 및 신청 방법\n\n야호 숲체험은 수업 전날 오후 6시까지 신청할 수 있으며, 정원이 먼저 차면 조기 마감됩니다. 신청 링크를 통해 접수할 수 있고, 입금 확인 후 예약이 확정됩니다.\n\n2. 참여 연령 및 보호자 동반\n\n야호 숲체험은 만 4세부터 만 7세까지의 어린이를 대상으로 합니다. 보호자 없이 아이들만 선생님과 함께 참여하는 수업이며, 한 반의 아동 정원은 기본 8명입니다.");
        expect(sha256(draftV2)).toBe("9a7c291799b80ffc1b5c21862dd91edba8d1614c1211817aab33e1993b5d442c");
        expect(safeApprovedGuidanceText(draftV2, "POLICY")).toBe(draftV2);
    });
    it.each([
        "정원은 기본 8명입니다.",
        "정원 8명입니다.",
        "한 반의 아동 정원은 기본 8명입니다.",
        "기본 정원은 8명입니다.",
        "정원이 8명입니다.",
        "정원은 기본 8명이고, 선생님과 함께 참여합니다.",
        "정원은 기본 8명입니다. 명단은 담당자가 확인합니다.",
        "정원은 기본 8명입니다. 만 4세부터 만 7세까지의 어린이를 대상으로 합니다.",
        "정원은 기본 8명입니다. 수업 전날 오후 6시까지 신청할 수 있습니다.",
        texts.PREPARATION,
        texts.RAIN,
        texts.POLICY,
        "정원이 먼저 차면 조기 마감됩니다.",
        "신청할 수 있습니다.",
    ])("allows %s", value => expect(safeApprovedGuidanceText(value, "POLICY")).toBe(value));
    it("preserves the superseded complete policy bytes and accepts its numbers", () => {
        expect(deniedV1.length).toBe(230);
        expect(sha256(deniedV1)).toBe("b021f937912b69268b1d3ac19e6475e51042a9a06fd90a8f289a17af02dc21b7");
        expect(safeApprovedGuidanceText(deniedV1, "POLICY")).toBe(deniedV1);
    });
    it.each([
        "정원 12명입니다.",
        "정원 7명입니다.",
        "정원 80명입니다.",
        "정원은 기본 8명이고 선생님 2명이 함께합니다.",
        "선생님 2명이 함께합니다.",
        "지도사 2명이 함께합니다.",
        "잔여석 3석이 남았습니다.",
        "남은 자리 2자리가 있습니다.",
        "현재 5명이 신청했습니다.",
        "정원은 기본 8명이고 만 4세부터 만 7세까지의 어린이를 대상으로 합니다.",
        "정원은 약 8명입니다.",
        "정원은 최대 8명입니다.",
        "정원은 기본 8명 이상입니다.",
        "정원은 여덟 명입니다.",
        "정원은 팔 명입니다.",
        "정원은 기본 8인입니다.",
        "정원 8명입니다. 3명이 신청했습니다.",
        "정원 현황을 확인해 주세요.",
        "정원은 기본 8명입니다. 정원 12명인 반도 있습니다.",
    ])("allows numeric text %s", value => expect(safeApprovedGuidanceText(value, "POLICY")).toBe(value));
});
