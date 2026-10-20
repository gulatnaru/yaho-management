import * as React from "react";
vi.mock("@/app/(admin)/classes/actions", () => ({ saveApplicationPrice: vi.fn() }));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassApplicationLinksView } from "@/lib/reservation-applications/link-queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ issueApplicationLink: vi.fn(), stopApplicationLink: vi.fn(), upgradeLegacyApplicationLink: vi.fn() }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const { ApplicationLinkCard } = await import("@/app/(admin)/classes/_components/application-link-card");
const readiness = { issuance: "ACTIVE" as const, classIntake: "READY" as const, guideReady: true, consentReady: true, environment: "Preview" as const, publicAccessAllowed: false, accessRestriction: "PREVIEW" as const };
const view: ClassApplicationLinksView = {
  classScheduleId: "class-1", className: "프로그램", timeLabel: "한국 시간", applicationPrice: null,
  canIssue: true, environment: "Preview", publicAccessAllowed: false, unissuedReadiness: { ...readiness, issuance: "NONE" },
  scopes: [{ id: "group:one", label: "이 클래스 전용", groupId: "one", scopeActive: true, currentClassMember: true, activeForCurrentClass: true, upgraded: false, members: [{ id: "class-1", label: "프로그램" }], links: [{ id: "hashed", isActive: true, issuedAtLabel: "발급 시각", issuedByName: "발급자", rawPath: null }], readiness }],
};
const render = (data: ClassApplicationLinksView | null = view) => renderToStaticMarkup(createElement(ApplicationLinkCard, { view: data, classScheduleId: "class-1" }));

describe("truthful ADMIN link card", () => {
  it("keeps hash-only active issuance distinct from missing issuance and never renders fake URL actions", () => {
    const html = render();
    expect(html).toContain("링크 활성"); expect(html).toContain("주소는 발급할 때만 확인");
    expect(html).not.toContain("미발급"); expect(html).not.toContain("링크 복사"); expect(html).not.toContain("target=\"_blank\"");
    expect(html).toContain("고급 설정 펼치기"); expect(html).toContain("<details>"); expect(html).not.toContain("<details open");
    expect(html).toContain("발급자"); expect(html).toContain("발급 시각");
  });
  it("shows stop and Preview restriction at the same time without suggesting Production is open", () => {
    const html = render({ ...view, scopes: [{ ...view.scopes[0]!, scopeActive: false, activeForCurrentClass: false, readiness: { ...readiness, issuance: "STOPPED" } }] });
    expect(html).toContain("링크 비활성 · 접수 중지"); expect(html).toContain("일반 보호자 신청을 받지 않습니다"); expect(html).toContain("운영 환경의 접수 상태는 여기서 확인할 수 없습니다");
  });
  it("keeps failures separate from no-link and shows no issue action on read failure", () => {
    const html = render(null);
    expect(html).toContain("링크 정보를 불러오지 못했습니다"); expect(html).toContain("다시 불러오기"); expect(html).not.toContain("미발급"); expect(html).not.toContain("링크 발급");
  });
  it("keeps an excluded active group in collapsed history and out of top status, warnings and actions", () => {
    const excluded = { ...view.scopes[0]!, label: "기존 주소를 전환한 링크" as const, currentClassMember: false, activeForCurrentClass: false, upgraded: true, members: [{ id: "class-2", label: "다른 클래스" }], readiness: { ...readiness, guideReady: false, consentReady: false } };
    const html = render({ ...view, scopes: [excluded] });
    const top = html.split("<details>")[0]!;
    expect(top).toContain("이 클래스에 해당하는 링크 없음");
    expect(top).not.toContain("링크 활성"); expect(top).not.toContain("접수 중지");
    expect(top).not.toContain("다른 클래스"); expect(top).not.toContain("발급할 때만 확인");
    expect(top).not.toContain("링크 복사"); expect(top).not.toContain("공유하기");
    expect(html).toContain("현재 링크 대상에서 제외된 클래스");
    expect(html).toContain("그룹 활성 · 현재 클래스 제외"); expect(html).toContain("링크 기록 활성");
    expect(html).toContain("발급자"); expect(html).not.toContain("<details open");
  });
  it("ignores excluded-scope diagnostics when an included active scope exists", () => {
    const excluded = { ...view.scopes[0]!, id: "group:excluded", currentClassMember: false, activeForCurrentClass: false, scopeActive: false, readiness: { ...readiness, issuance: "STOPPED" as const, guideReady: false, consentReady: false } };
    const top = render({ ...view, scopes: [excluded, view.scopes[0]!] }).split("<details>")[0]!;
    expect(top).toContain("링크 상태: 링크 활성");
    expect(top).not.toContain("신규 신청을 중지"); expect(top).not.toContain("입금 안내 설정 필요"); expect(top).not.toContain("동의 문구 준비 필요");
  });
  it("shows no-link settings/consent issues and independent diagnostics", () => {
    const html = render({ ...view, scopes: [], unissuedReadiness: { ...view.unissuedReadiness, guideReady: false, consentReady: false } });
    expect(html).toContain("미발급"); expect(html).toContain("입금 안내 설정 필요"); expect(html).toContain("동의 문구 준비 필요"); expect(html).toContain("현재 환경 일반 공개 접근");
  });
  it("keeps existing application navigation for cancelled classes", () => {
    const html = render({ ...view, canIssue: false, scopes: [{ ...view.scopes[0]!, readiness: { ...readiness, classIntake: "CANCELLED" } }] });
    expect(html).toContain("클래스 상태로 신규 접수 불가"); expect(html).toContain("신청 목록 보기 · 전체 클래스"); expect(html).toContain('href="/reservation-applications"'); expect(html).toContain("reservation-applications?classScheduleId=class-1"); expect(html).not.toContain(">링크 발급<");
  });
});

it("offers legacy reissue separately from upgrade with no modern price/settings gate", () => {
  const html = render({ ...view, revision: "a".repeat(64), applicationPrice: null, scopes: [{ ...view.scopes[0]!, id: "class:class-1", groupId: null, links: [{ ...view.scopes[0]!.links[0]!, rawPath: "/apply/old" }], readiness: { ...readiness, guideReady: false, consentReady: false } }] });
  expect(html).toContain("기존 주소 무효화 후 재발급"); expect(html).toContain("기존 주소를 유지하고 새 방식으로 전환");
  const reissue = html.match(/<button[^>]*>기존 주소 무효화 후 재발급<\/button>/)?.[0];
  expect(reissue).toBeDefined(); expect(reissue).not.toContain(' disabled=""');
});
