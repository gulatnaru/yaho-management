import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, now } from "./fake-db";
import { RETENTION_MS } from "@/server/ai-service/contracts";

const mocked = vi.hoisted(() => ({ adminContext: vi.fn() }));
vi.mock("@/server/ai-service/admin-context", () => ({ adminContext: mocked.adminContext }));
vi.mock("@/app/(admin)/ai-service/actions", () => ({
    pauseServiceAction: vi.fn(), saveConfigAction: vi.fn(), saveGuidanceAction: vi.fn(), savePublicationAction: vi.fn(),
    reconcileAction: vi.fn(), retryRetentionAction: vi.fn(),
    previewSkillDiagPurgeAction: vi.fn(), executeSkillDiagPurgeAction: vi.fn(),
    lookupConsultationsBySubjectAction: vi.fn(), deleteConsultationAction: vi.fn(),
}));

import AiServicePage from "@/app/(admin)/ai-service/page";

describe("AI service server-rendered request summary", () => {
    let f: ReturnType<typeof fakeDb>;
    beforeEach(() => {
        vi.stubGlobal("React", React);
        vi.useFakeTimers();
        vi.setSystemTime(now);
        f = fakeDb();
        mocked.adminContext.mockResolvedValue({ db: f.db, environment: "PREVIEW", actor: { userId: "synthetic-admin", role: "ADMIN", active: true } });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("renders aggregate counts, UTC timestamp and retention scope while preserving existing controls", async () => {
        for (const [index, status] of ["SETTLED", "PROCESSING", "FAILED", "UNKNOWN"].entries())
            f.seed("aiServiceRequest", { id: `synthetic-${index}`, environment: "PREVIEW", status,
                dispatched: status === "SETTLED" || status === "UNKNOWN", createdAt: now, expiresAt: new Date(+now + 1) });
        f.seed("aiServiceRequest", { id: "synthetic-expired", environment: "PREVIEW", status: "UNKNOWN", dispatched: true, createdAt: now, expiresAt: now });
        f.seed("aiServiceDeletionAudit", { environment: "PREVIEW", kind: "EMERGENCY_PAUSE", actorId: "synthetic-admin", createdAt: now });

        const html = renderToStaticMarkup(await AiServicePage());

        expect(html).toContain('aria-labelledby="request-summary-heading"');
        expect(html).toContain("요청·호출 요약");
        for (const [label, count] of [["총 요청", 4], ["호출 시도", 2], ["실패 (FAILED)", 1], ["미확정 (UNKNOWN)", 1]])
            expect(html).toContain(`<dt>${label}</dt><dd class="text-2xl font-bold">${count}건</dd>`);
        expect(html).toContain(`<time dateTime="${now.toISOString()}">${now.toISOString()}</time>`);
        expect(html).toContain("현재 환경의 보관기간(90일) 내 전체 요청 기준 · 만료·삭제된 요청 제외");
        expect(html).toContain("호출 시도는 외부 호출 발송이 기록된 요청 수입니다.");
        expect(html).toMatch(/최근 중단 실행자: (?:<!-- -->)?synthetic-admin/);
        for (const label of ["설정 저장", "공개 설정 저장", "안내 저장", "예산·청구 대조", "삭제 작업 재시도", "유효 상담 기록"])
            expect(html).toContain(label);
        expect(html).toContain("/ai-service/synthetic-3");
        expect(html).not.toContain("/ai-service/synthetic-expired");
    });

    it("renders explicit zero counts for an empty retained scope", async () => {
        const html = renderToStaticMarkup(await AiServicePage());

        expect(html.match(/<dd class="text-2xl font-bold">0건<\/dd>/g)).toHaveLength(4);
        expect(html).toContain("조회 가능한 상담이 없습니다.");
        expect(html).toContain("스케줄러: 비활성 · 재시도 횟수 0/3");
        expect(html).toContain("최근 삭제 성공 (UTC): 미실행");
        expect(html).toContain("삭제 오류: 없음");
    });

    it("renders fixed retention failure metadata without raw errors or private request fields", async () => {
        f.seed("aiServiceRetentionJob", { environment: "PREVIEW", status: "FAILED", attempts: 3, deletedCount: 4,
            lastSuccessAt: now, nextRetryAt: null, errorCode: "RETENTION_FAILED" });
        const html = renderToStaticMarkup(await AiServicePage());
        expect(html).toContain("스케줄러: 비활성 · 재시도 횟수 3/3");
        expect(html).toContain(`최근 삭제 성공 (UTC): ${now.toISOString()}`);
        expect(html).toContain("다음 재시도 가능 시각 (UTC): 없음");
        expect(html).toContain("삭제 오류: RETENTION_FAILED");
    });

    it("renders all three diagnostic retention fields and the preview control", async () => {
        const oldest = new Date(+now - RETENTION_MS - 1);
        f.seed("aiServiceSkillDiag", { environment: "PREVIEW", emittedAt: oldest });
        f.seed("aiServiceSkillDiag", { environment: "PREVIEW", emittedAt: now });
        const html = renderToStaticMarkup(await AiServicePage());
        expect(html).toContain("90일 삭제 상태");
        expect(html).toContain("<dt>진단 행</dt><dd>2건</dd>");
        expect(html).toContain("<dt>진단 삭제 대상</dt><dd>1건</dd>");
        expect(html).toContain(`<dt>가장 오래된 진단 (UTC)</dt><dd>${oldest.toISOString()}</dd>`);
        expect(html).toContain("삭제 대상 확인");
        expect(html).not.toContain("진단 삭제 확정");
    });

    it("does not mount the diagnostic purge form when the admin lock is closed", async () => {
        mocked.adminContext.mockRejectedValue(new Error("AI_SERVICE_DENIED"));
        const html = renderToStaticMarkup(await AiServicePage());
        expect(html).toContain("현재 연결과 설정 변경은 비활성화되어 있습니다.");
        expect(html).not.toContain("삭제 대상 확인");
        expect(html).not.toContain("진단 삭제 확정");
    });

    it("keeps unavailable context disabled without querying or rendering summary data", async () => {
        mocked.adminContext.mockRejectedValue(new Error("AI_SERVICE_DENIED"));

        const html = renderToStaticMarkup(await AiServicePage());

        expect(html).toContain("현재 연결과 설정 변경은 비활성화되어 있습니다.");
        expect(html).not.toContain("요청·호출 요약");
        expect(f.operations).toEqual([]);
    });
});
