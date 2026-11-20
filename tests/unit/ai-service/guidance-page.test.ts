import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("@/server/ai-service/guidance-context", () => ({ guidanceAdminContext: async () => ({ db: {}, environment: "PREVIEW", actor: {} }) }));
vi.mock("@/server/ai-service/guidance-admin", () => ({ readApprovedGuidanceState: mocks.state }));
vi.mock("@/app/(admin)/ai-service/guidance/actions", () => ({ saveApprovedGuidanceAction: async () => {} }));
import Page from "@/app/(admin)/ai-service/guidance/page";

const v1 = "6fac3ee24c783017d897bc90f452cc6ae8279aa889f99ef51e45d7e1e2c2e748";
const v2 = "9a7c291799b80ffc1b5c21862dd91edba8d1614c1211817aab33e1993b5d442c";
describe("guidance page stored state", () => {
    beforeEach(() => { vi.stubGlobal("React", React); mocks.state.mockReset(); });
    afterEach(() => vi.unstubAllGlobals());
    it.each([[v1, true, "v1 원문 잔존"], [v2, true, "현재 v2 원문 일치"], ["0".repeat(64), false, "기타 내용 불일치"], [v2, false, "현재 v2 원문 일치"]] as const)("distinguishes hash %s and approval %s", async (hash, approved, label) => {
        mocks.state.mockResolvedValue([{ topic: "POLICY", version: 7, approved, contentSha256: hash, updatedAt: new Date("2026-01-02T03:04:05Z") }]);
        const markup = renderToStaticMarkup(await Page());
        expect(markup).toContain("POLICY (v2)");
        expect(markup).toContain("yaho_oq16_policy_v2.txt");
        expect(markup).toContain("220자");
        expect(markup).toContain("508바이트");
        expect(markup).toContain(v2);
        expect(markup).toContain(`DB 버전 7`);
        expect(markup).toContain(approved ? " · 승인 · " : " · 미승인 · ");
        expect(markup).toContain(hash);
        expect(markup).toContain("2026-01-02T03:04:05.000Z");
        expect(markup).toContain(label);
        expect(markup).toContain('value="7"');
        expect(markup).toContain("PREPARATION (v1)");
        expect(markup).toContain("RAIN (v1)");
    });
    it("shows an unregistered state", async () => {
        mocks.state.mockResolvedValue([]);
        const markup = renderToStaticMarkup(await Page());
        expect(markup.match(/미등록/g)).toHaveLength(3);
    });
});
