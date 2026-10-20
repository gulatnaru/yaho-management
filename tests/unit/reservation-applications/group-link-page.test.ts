import * as React from "react";
vi.mock("@/server/reservation-applications/groups", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/reservation-applications/groups")>()), readClassLinkRevision: vi.fn(async () => "a".repeat(64)) }));
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), group: vi.fn(), classes: vi.fn(), settings: vi.fn(), consent: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.admin }));
vi.mock("@/lib/reservation-applications/consent-content", () => ({ isConsentContentReady: mocks.consent }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  reservationApplicationGroup: { findUnique: mocks.group },
  classSchedule: { findMany: mocks.classes },
  reservationApplicationSettings: { findUnique: mocks.settings },
} }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ markGroupManualTestSession: vi.fn() }));
vi.mock("@/app/(admin)/reservation-applications/groups/group-link-button", () => ({ GroupLinkButton: () => null }));
vi.mock("@/app/(admin)/reservation-applications/groups/group-edit-form", () => ({ GroupEditForm: () => null }));
const { default: GroupPage } = await import("@/app/(admin)/reservation-applications/groups/[id]/page");
const settings = { bankName: "은행", accountNumber: "123", accountHolder: "예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/photo", kakaoChannelUrl: "https://example.test/chat" };
const classSchedule = { id: "class-1", startsAt: new Date("2099-01-01T01:00:00Z"), status: "SCHEDULED", applicationPrice: 10000, program: { name: "테스트 프로그램" } };
const group = { id: "group-1", isActive: true, syntheticRunId: null, syntheticSettings: null, links: [{ isActive: true }], classes: [{ classSchedule }] };
const render = async () => renderToStaticMarkup(await GroupPage({ params: Promise.resolve({ id: "group-1" }) }));

beforeEach(() => {
  vi.unstubAllEnvs(); vi.stubGlobal("React", React); vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ role: "ADMIN" }); mocks.group.mockResolvedValue(group);
  mocks.classes.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.consent.mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("group detail shared readiness", () => {
  it("retains stopped history and Preview restriction as independent facts", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.group.mockResolvedValue({ ...group, links: [{ isActive: false }], syntheticSettings: settings });
    const html = await render();
    expect(html).toContain("링크 비활성 · 접수 중지");
    expect(html).toContain("일반 보호자 신청을 받지 않습니다");
    expect(html).toContain("운영 환경의 접수 상태는 여기서 확인할 수 없습니다");
    expect(html).toContain("입금 안내 준비됨"); expect(html).not.toContain("미발급");
    expect(mocks.group.mock.calls[0]?.[0].select.links).not.toHaveProperty("where");
  });
  it("shows per-class closure/price issues and links to existing applications", async () => {
    mocks.group.mockResolvedValue({ ...group, classes: [
      { classSchedule: { ...classSchedule, status: "CANCELLED" } },
      { classSchedule: { ...classSchedule, id: "class-2", applicationPrice: null } },
    ] });
    const html = await render();
    expect(html).toContain("취소된 클래스 · 신규 접수 불가"); expect(html).toContain("신청금액 미설정");
    expect(html).toContain('href="/classes/class-2/edit"');
    expect(html).toContain("신청 목록 보기 · 전체 클래스"); expect(html).toContain('href="/reservation-applications"');
    expect(html).toContain("<details>"); expect(html).not.toContain("<details open");
  });
  it("reports missing modern settings without an env fallback", async () => {
    mocks.settings.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("입금 안내 설정 필요"); expect(html).toContain('href="/reservation-applications/settings"');
  });
  it.each(["MANAGER", "TEACHER"])("denies %s before any group/settings query", async (role) => {
    mocks.admin.mockRejectedValue(new Error(`${role}_DENIED`));
    await expect(render()).rejects.toThrow("DENIED");
    for (const read of [mocks.group, mocks.classes, mocks.settings]) expect(read).not.toHaveBeenCalled();
  });
});
