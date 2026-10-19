import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupSubmissionState } from "@/app/(public)/apply/group/[token]/actions";

const actionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useActionState: actionState,
}));

import { GroupApplicationForm } from "@/app/(public)/apply/group/[token]/group-application-form";

function render(state: GroupSubmissionState = {}) {
  actionState.mockReturnValue([state, vi.fn(), false]);
  return renderToStaticMarkup(React.createElement(GroupApplicationForm, {
    action: async () => ({}), classes: [{ id: "synthetic-class", label: "합성 클래스" }],
  }));
}

describe("group application required-consent feedback", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());

  it("requires the four mandatory consents and keeps photo choices optional", () => {
    const html = render();
    const inputs = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(([input]) => input);
    expect(inputs).toHaveLength(6);
    expect(inputs.map((input) => input.includes('required=""'))).toEqual([true, true, true, false, false, true]);
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("renders each server consent message beside its associated invalid checkbox", () => {
    const errors = {
      programTerms: "프로그램 안전 및 이용사항을 확인해주세요",
      privacyConsent: "개인정보 수집·이용에 동의해주세요",
      legalGuardianConfirmation: "법정대리인 확인에 동의해주세요",
      refundTerms: "취소 및 환불규정을 확인해주세요",
    };
    const html = render({ error: "아이별 필수 확인·동의 항목을 확인해주세요.", consentErrors: { 0: errors } });
    for (const [key, message] of Object.entries(errors)) {
      const id = `application-child-0-${key}-error`;
      expect(html).toContain(`aria-describedby="${id}" aria-invalid="true"`);
      expect(html).toContain(`id="${id}">${message}</p>`);
    }
    expect(html).toContain('role="alert">아이별 필수 확인·동의 항목을 확인해주세요.');
  });

  it("does not attach a second child's errors to the first child's controls", () => {
    const html = render({ consentErrors: { 1: { privacyConsent: "개인정보 수집·이용에 동의해주세요" } } });
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain("application-child-0-privacyConsent-error");
  });
});
