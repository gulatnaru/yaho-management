import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupApplicationForm } from "@/app/(public)/apply/group/[token]/group-application-form";
import { ConsentReviewStep } from "@/app/(public)/apply/_components/consent-review-step";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { createChildDraft, emptyConfirmations } from "@/lib/reservation-applications/application-draft";
const classes = [{ id: "synthetic-class", label: "합성 클래스", applicationPrice: 40000 }];
function renderConsents(errors: Record<string, string> = {}) {
  return renderToStaticMarkup(React.createElement(ConsentReviewStep, { drafts: [createChildDraft("stable", "synthetic-class")], classes, items: APPLICATION_CONSENT_CONTENT.items, version: APPLICATION_CONSENT_CONTENT.version, required: emptyConfirmations(), errors, updateRequired: vi.fn(), updateOptional: vi.fn() }));
}
describe("group application shared wizard and required-consent feedback", () => {
  beforeEach(() => vi.stubGlobal("React", React)); afterEach(() => vi.unstubAllGlobals());
  it("starts at class selection with exactly three input stages and no intermediate submit button", () => {
    const html = renderToStaticMarkup(React.createElement(GroupApplicationForm, { action: async () => ({}), classes }));
    expect(html).toContain("3단계 중 1단계"); expect(html).toContain("보호자·자녀 정보"); expect(html).toContain("동의·최종 확인");
    expect(html).toContain("40,000원"); expect(html).not.toContain('type="submit"'); expect(html).not.toContain('name="guardianName"');
  });
  it("requires four separate unchecked confirmations and keeps two photo choices optional", () => {
    const html = renderConsents();
    const inputs = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(([input]) => input);
    expect(inputs).toHaveLength(6); expect(inputs.map((input) => input.includes('required=""'))).toEqual([true, true, true, true, false, false]);
    expect(inputs.every((input) => !input.includes('checked=""'))).toBe(true);
    expect(html).not.toContain("전체 동의"); expect(html).toContain("적용 대상:");
    for (const item of APPLICATION_CONSENT_CONTENT.items) for (const line of item.body) expect(html).toContain(line.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  });
  it("attaches allowlisted required errors to each shared checkbox and ignores out-of-current-scope child errors", () => {
    const html = renderConsents({ "children.0.privacyConsent": "필수 항목을 확인해 주세요.", "children.1.refundTerms": "다른 아이 오류" });
    expect(html).toContain('aria-describedby="application-privacyConsent-error"'); expect(html).toContain('id="application-privacyConsent-error">필수 항목을 확인해 주세요.');
    expect(html).not.toContain("다른 아이 오류"); expect(html).not.toContain("application-refundTerms-error");
  });
});
