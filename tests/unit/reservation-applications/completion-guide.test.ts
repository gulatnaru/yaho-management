import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(public)/apply/complete/completion-actions", () => ({
  createCompanionInvitation: vi.fn(), notifyApplicationDeposit: vi.fn(), revokeCompanionInvitation: vi.fn(),
}));

import { CompletionGuide } from "@/app/(public)/apply/complete/completion-guide";

describe("completion guide initial server render", () => {
  // This Vitest configuration emits classic JSX; Next supplies its own runtime.
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());
  it.each(["synthetic-payer", null])("keeps every client action disabled until the client is ready (payer %s)", (payerName) => {
    const html = renderToStaticMarkup(React.createElement(CompletionGuide, {
      bankName: "synthetic-bank", accountNumber: "000000", accountHolder: "synthetic-holder", payerName,
      applications: [{ id: "synthetic-application", childName: "synthetic-child", quotedAmount: 22000 }],
    }));
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(5);
    expect(buttons.every((button) => /\bdisabled=""/.test(button))).toBe(true);
    for (const label of ["계좌번호 복사", "금액 복사", "입금자명 복사", "입금했어요", "동행 초대 링크 만들기"]) expect(html).toContain(label);
    expect(html).toContain("22,000원");
    expect(html).toContain("synthetic-bank");
    expect(html).not.toContain('role="status"');
  });
});
