import * as React from "react";
vi.mock("@/app/(admin)/classes/actions", () => ({ saveApplicationPrice: vi.fn() }));
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ principal: vi.fn(), detail: vi.fn(), inventory: vi.fn(), options: vi.fn(), adminReservations: vi.fn(), managerReservations: vi.fn(), teacherReservations: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/authorization", () => ({ requireCurrentPrincipal: mocks.principal }));
vi.mock("@/lib/classes/queries", () => ({ getClassDetailForPrincipal: mocks.detail }));
vi.mock("@/lib/reservation-applications/link-queries", () => ({ getClassApplicationLinks: mocks.inventory, getLinkCompositionOptions: mocks.options }));
vi.mock("@/lib/reservations/queries", () => ({ listReservationsByClassSchedule: mocks.adminReservations, listOperationalReservationsByClassSchedule: mocks.managerReservations, listTeacherReservationsByClassSchedule: mocks.teacherReservations }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ issueApplicationLink: vi.fn(), stopApplicationLink: vi.fn(), upgradeLegacyApplicationLink: vi.fn() }));
vi.mock("@/app/(admin)/classes/_components/class-participant-list", () => ({ ClassParticipantList: () => null }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const { default: ClassDetailPage } = await import("@/app/(admin)/classes/[id]/page");
const readiness = { issuance: "NONE", classIntake: "READY", guideReady: false, consentReady: false, environment: "Preview", publicAccessAllowed: false, accessRestriction: "PREVIEW" };
const view = { classScheduleId: "class-1", className: "테스트 프로그램", timeLabel: "일시", applicationPrice: 987654, canIssue: true, environment: "Preview", publicAccessAllowed: false, scopes: [], unissuedReadiness: readiness };
const detail = { id: "class-1", program: { id: "program-1", name: "테스트 프로그램" }, startsAt: new Date("2099-01-01T01:00:00Z"), endsAt: new Date("2099-01-01T02:00:00Z"), status: "SCHEDULED", applicationPrice: 987654, teachers: [], capacity: 8 };
const render = async () => renderToStaticMarkup(await ClassDetailPage({ params: Promise.resolve({ id: "class-1" }) }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "ADMIN" }); mocks.detail.mockResolvedValue(detail); mocks.inventory.mockResolvedValue(view); mocks.options.mockResolvedValue([]);
  mocks.adminReservations.mockResolvedValue([]); mocks.managerReservations.mockResolvedValue([]); mocks.teacherReservations.mockResolvedValue([]);
});

describe("ClassDetailPage inventory boundary", () => {
  it.each(["MANAGER", "TEACHER"])("does not query or serialize application information for %s", async (role) => {
    mocks.principal.mockResolvedValue({ role, teacherId: "teacher-1" });
    const html = await render();
    expect(mocks.inventory).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.adminReservations).not.toHaveBeenCalled();
    expect(html).not.toContain("987654"); expect(html).not.toContain("application-link-card"); expect(html).not.toContain("reservation-applications"); expect(html).not.toContain("신청");
    expect(role === "MANAGER" ? mocks.managerReservations : mocks.teacherReservations).toHaveBeenCalledTimes(1);
  });
  it("places the ADMIN link card after basic info and before safety/participants with no-link diagnostic issues", async () => {
    const html = await render();
    expect(mocks.inventory).toHaveBeenCalledWith("class-1");
    expect(html.indexOf("기본 정보")).toBeLessThan(html.indexOf("application-link-card"));
    expect(html.indexOf("application-link-card")).toBeLessThan(html.indexOf("보험 및 안전 정보"));
    expect(html).toContain("입금 안내 설정 필요"); expect(html).toContain("동의 문구 준비 필요"); expect(html).toContain("현재 환경 일반 공개 접근");
    expect(html).toContain("신청 목록 보기 · 전체 클래스"); expect(html).toContain('href="/reservation-applications"'); expect(html).not.toContain("reservation-applications?classScheduleId=");
  });
  it("retains basic class info and explicit retry on inventory failure without a false no-link or issue action", async () => {
    mocks.inventory.mockRejectedValueOnce(new Error("private DB failure"));
    const html = await render();
    expect(html).toContain("기본 정보"); expect(html).toContain("링크 정보를 불러오지 못했습니다"); expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("미발급"); expect(html).not.toContain(">링크 발급<"); expect(html).not.toContain("private DB failure");
  });
});
