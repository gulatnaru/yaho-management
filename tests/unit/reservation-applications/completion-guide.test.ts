import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(public)/apply/complete/completion-actions", () => ({
  createCompanionInvitation: vi.fn(), notifyApplicationDeposit: vi.fn(), revokeCompanionInvitation: vi.fn(),
}));

import { CompletionGuide } from "@/app/(public)/apply/complete/completion-guide";
import { CopyControl } from "@/components/application-ux/copy-control";

const props = {
  bankName: "synthetic-bank", accountNumber: "000-001-002", accountHolder: "synthetic-holder", payerName: "synthetic-payer",
  applications: [{ id: "first", childName: "synthetic-child-one", quotedAmount: 22000 }, { id: "second", childName: "synthetic-child-two", quotedAmount: 13500 }],
};

describe("completion guide initial server render", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());
  it.each(["synthetic-payer", null])("keeps every action disabled before hydration (payer %s)", (payerName) => {
    const html = renderToStaticMarkup(React.createElement(CompletionGuide, { ...props, payerName }));
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(payerName ? 5 : 4);
    expect(buttons.every((button) => /\bdisabled=""/.test(button))).toBe(true);
    for (const label of ["계좌번호 복사", "입금액 복사", "입금했어요", "초대 링크 만들기"]) expect(html).toContain(label);
    expect(html).not.toContain('role="status"');
  });
  it("shows stored child quotes and their total before bank guidance, next actions, and secondary invitation", () => {
    const html = renderToStaticMarkup(React.createElement(CompletionGuide, props));
    for (const value of ["synthetic-child-one", "22,000원", "synthetic-child-two", "13,500원", "35,500원", "synthetic-payer"]) expect(html).toContain(value);
    expect(html).toContain("<span>송금할 총액</span><strong>35,500원</strong>");
    expect(html).not.toContain("총 입금액");
    expect(html.indexOf("신청 금액")).toBeLessThan(html.indexOf("무통장 입금 안내"));
    expect(html.indexOf("무통장 입금 안내")).toBeLessThan(html.indexOf("다음 순서"));
    expect(html.indexOf("다음 순서")).toBeLessThan(html.indexOf("친구 보호자 초대"));
    expect(html).toContain("안내된 금액 송금 → 입금했어요 → 운영자 실제 입금 확인 → 예약 확정");
    expect(html).toContain("송금을 마친 뒤 눌러주세요. 운영자에게 알림을 남기며 실제 입금 확인이나 예약 확정을 대신하지 않습니다.");
    expect(html).toContain("초대받은 보호자는 본인의 정보를 직접 입력하고 필요한 동의를 진행합니다.");
    expect(html).toContain("복사 값은 쉼표와 원 표시가 없는 숫자입니다.");
    expect(html).toContain('aria-label="입금액 복사 값 (숫자만)"');
    expect(html).toContain('>35500</textarea>');
    expect(html).not.toContain("4단계");
  });
  it("shows a previously recorded notification as success without inviting another click", () => {
    const html = renderToStaticMarkup(React.createElement(CompletionGuide, { ...props, initiallyNotified: true }));
    expect(html).toContain("입금 알림을 보냈습니다. 운영자 확인을 기다려주세요.");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<button[^>]*>입금했어요<\/button>/);
  });
  it("keeps shared ADMIN link defaults compatible and its exact value selectable before hydration", () => {
    const html = renderToStaticMarkup(React.createElement(CopyControl, { value: "https://example.test/apply/synthetic" }));
    expect(html).toContain('aria-label="신청 링크 주소"'); expect(html).toContain("링크 복사");
    expect(html).toContain('readOnly=""'); expect(html).toContain("https://example.test/apply/synthetic</textarea>");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
