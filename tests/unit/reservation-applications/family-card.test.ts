import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyApplicationCard } from "@/app/(admin)/reservation-applications/_components/family-application-card";
import { applicationStateSummary } from "@/app/(admin)/reservation-applications/_components/application-state-summary";
import { parseFamilyFilters } from "@/lib/reservation-applications/navigation";
import type { FamilyApplication } from "@/lib/reservation-applications/family-queries";
beforeEach(() => vi.stubGlobal("React", React)); afterEach(() => vi.unstubAllGlobals());
const child = { id: "a1", childName: "아이", status: "SUBMITTED" as const, quotedAmount: 10000, depositConfirmedAt: null, classScheduleId: "c1", matchesFilter: true, isPossibleDuplicate: false, classSchedule: { startsAt: new Date("2026-10-25T01:00:00Z"), endsAt: new Date("2026-10-25T02:00:00Z"), program: { name: "프로그램" } } };
const family: FamilyApplication = { kind: "submission", id: "s1", guardianName: "보호자", children: [child, { ...child, id: "a2", status: "CONFIRMED", matchesFilter: false }], notificationReceived: true, legacyDepositConfirmed: null, deposit: { state: "available", depositedAmount: 0, hasOutstandingReturn: false } };
describe("minimal responsive family card", () => {
  it("does not turn guardian notification into a deposit or whole-family confirmation", () => {
    const state = applicationStateSummary(family); expect(state.processing).toContain("일부 확정 1/2명"); expect(state.deposit).toBe("알림 받음 · 은행 확인 기록 없음");
    expect(state.action).toBe("신청 내용과 실제 은행 입금을 확인해 주세요.");
  });
  it("keeps positive cumulative deposits factual while pending siblings need neutral review", () => {
    const state = applicationStateSummary({ ...family, deposit: { state: "available", depositedAmount: 30000, hasOutstandingReturn: false } });
    expect(state.processing).toContain("일부 확정 1/2명");
    expect(state.deposit).toBe("은행 확인 입금 누계 30,000원");
    expect(state.action).toBe("신청 내용과 실제 은행 입금을 확인해 주세요.");
  });
  it("preserves unavailable, outstanding return, legacy pending and completed guidance", () => {
    expect(applicationStateSummary({ ...family, deposit: { state: "unavailable" } }).action).toBe("입금 상태를 상세에서 다시 확인해 주세요.");
    expect(applicationStateSummary({ ...family, deposit: { state: "available", depositedAmount: 30000, hasOutstandingReturn: true } }).action).toBe("반환이 필요한 내역을 확인해 주세요.");
    expect(applicationStateSummary({ ...family, kind: "legacy", deposit: { state: "amount-unrecorded" } }).action).toBe("기존 신청 내용을 확인하고 처리해 주세요.");
    expect(applicationStateSummary({ ...family, children: [{ ...child, status: "CONFIRMED" }], deposit: { state: "available", depositedAmount: 30000, hasOutstandingReturn: false } }).action).toBe("아이별 처리 결과를 확인할 수 있습니다.");
  });
  it("renders one card tree with separate detail/expand controls and no financial controls or hidden PII", () => {
    const html = renderToStaticMarkup(createElement(FamilyApplicationCard, { family, filters: parseFamilyFilters({ classScheduleId: "c1", page: "2" }) }));
    expect(html.match(/<article/g)).toHaveLength(1); expect(html).toContain("<summary"); expect(html).not.toContain("<table"); expect(html).not.toContain("<details open");
    expect(html).toContain("신청 처리하기"); expect(html).toContain("classScheduleId=c1&amp;page=2"); expect(html).toContain("같은 제출의 자녀");
    expect(html).not.toMatch(/생년월일|요청사항|전화번호|입금 기록 저장|반환 이체|동의 원문|PaymentItem|미배정|예약에 쓸 수/);
    expect(html.indexOf("실제 은행 입금")).toBeLessThan(html.indexOf("보호자 보호자"));
  });
  it("shows duplicate warning for pending action while keeping detail navigation separate", () => {
    const html = renderToStaticMarkup(createElement(FamilyApplicationCard, { family: { ...family, children: [{ ...child, isPossibleDuplicate: true }] }, filters: parseFamilyFilters() }));
    expect(html).toContain("중복 가능"); expect(html).not.toContain("guardianPhone");
  });
  it("keeps ledger failures explicit and legacy null amount-unrecorded", () => {
    expect(applicationStateSummary({ ...family, deposit: { state: "unavailable" } }).deposit).toBe("입금 상태 조회 오류");
    const html = renderToStaticMarkup(createElement(FamilyApplicationCard, { family: { ...family, kind: "legacy", id: "a1", notificationReceived: null, children: [{ ...child, quotedAmount: null }], deposit: { state: "amount-unrecorded" } }, filters: parseFamilyFilters() }));
    expect(html).toContain("기존 방식 · 아이 1명 신청"); expect(html).toContain("금액 미기록"); expect(html).not.toContain("0원");
  });
});
