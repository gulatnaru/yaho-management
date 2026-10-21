import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Handler harness follows the existing link/workflow unit tests; browser behavior has separate E2E coverage.
const hooks = vi.hoisted(() => ({ instances: new Map<string, unknown[]>(), name: "", cursor: 0, effects: [] as (() => unknown)[] }));
const mocks = vi.hoisted(() => ({ create: vi.fn(), notify: vi.fn(), cancel: vi.fn(), copy: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const values = hooks.instances.get(hooks.name)!; const index = hooks.cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], (next: unknown) => { values[index] = next; }];
  },
  useRef: (initial: unknown) => {
    const values = hooks.instances.get(hooks.name)!; const index = hooks.cursor++;
    if (!(index in values)) values[index] = { current: initial }; return values[index];
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock("@/app/(public)/apply/complete/completion-actions", () => ({ createCompanionInvitation: mocks.create, notifyApplicationDeposit: mocks.notify, revokeCompanionInvitation: mocks.cancel }));
import { CompletionGuide } from "@/app/(public)/apply/complete/completion-guide";
import { CopyControl } from "@/components/application-ux/copy-control";
import { FormFeedback } from "@/components/application-ux/form-feedback";

type Props = { children?: React.ReactNode; onClick?: () => Promise<void>; onFocus?: (event: { currentTarget: { select: () => void } }) => void; disabled?: boolean; value?: string; readOnly?: boolean; notice?: string; error?: string };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return React.isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement<Props>(node) ? text(node.props.children) : "";
}
function button(tree: React.ReactNode, label: string) {
  const found = elements(tree).find((element) => element.props.onClick && text(element.props.children) === label);
  expect(found, label).toBeDefined(); return found!;
}
function render<T>(name: string, callback: () => T, effects = true): T {
  hooks.name = name; hooks.cursor = 0; hooks.effects = [];
  if (!hooks.instances.has(name)) hooks.instances.set(name, []);
  const tree = callback(); if (effects) hooks.effects.forEach((effect) => effect()); return tree;
}
const props = { bankName: "합성은행", accountNumber: "000-111-222", accountHolder: "합성예금주", payerName: "보호자가 입력한 합성 입금자", applications: [{ id: "a1", childName: "합성아이", quotedAmount: 12345 }, { id: "a2", childName: "합성아이둘", quotedAmount: 23456 }] };
function guide(initiallyNotified = false) { return render("guide", () => CompletionGuide({ ...props, initiallyNotified })); }
function copyControls(tree: React.ReactNode) { return elements(tree).filter((element) => element.type === CopyControl) as React.ReactElement<Parameters<typeof CopyControl>[0]>[]; }
function feedback(tree: React.ReactNode) { return elements(tree).filter((element) => element.type === FormFeedback).map((element) => element.props); }
async function createInvite() { guide(); await button(guide(), "초대 링크 만들기").props.onClick!(); return guide(); }

beforeEach(() => {
  vi.resetAllMocks(); hooks.instances.clear(); hooks.effects = [];
  vi.stubGlobal("React", React); vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.copy } });
  mocks.create.mockResolvedValue({ url: "/apply/companion/synthetic" }); mocks.notify.mockResolvedValue({ notified: true }); mocks.cancel.mockResolvedValue({ revoked: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("completion shared copy controls", () => {
  it("copies each exact target and announces its specific success without issuing or submitting anything", async () => {
    const tree = await createInvite();
    const expected = [
      ["계좌번호 복사", props.accountNumber, "계좌번호를 복사했습니다."],
      ["입금자명 복사", props.payerName, "입금자명을 복사했습니다."],
      ["입금액 복사", "35801", "입금액을 복사했습니다."],
      ["초대 링크 복사", "http://localhost:3000/apply/companion/synthetic", "초대 링크를 복사했습니다."],
    ];
    for (const [label, value, notice] of expected) {
      const control = copyControls(tree).find((element) => element.props.buttonLabel === label)!;
      const draw = () => render(label!, () => CopyControl(control.props));
      expect(button(draw(), label!).props.disabled).toBe(true);
      expect(button(draw(), label!).props.disabled).toBe(false);
      expect(control.props.value).toBe(value);
      await button(draw(), label!).props.onClick!();
      expect(mocks.copy).toHaveBeenLastCalledWith(value);
      expect(feedback(draw())).toContainEqual(expect.objectContaining({ notice, error: undefined }));
    }
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each(["denied", "unsupported", "failed"])("provides a selectable readonly value and failure announcement for %s clipboard", async (kind) => {
    if (kind === "unsupported") vi.stubGlobal("navigator", {});
    else mocks.copy.mockRejectedValue(new Error("private synthetic detail must not appear"));
    const draw = () => render("copy", () => CopyControl({ value: "000-111", buttonLabel: "복사" }));
    draw(); await button(draw(), "복사").props.onClick!();
    const failed = draw();
    expect(feedback(failed)).toContainEqual({ error: "복사하지 못했습니다. 직접 선택해서 복사해 주세요.", notice: undefined });
    const field = elements(failed).find((element) => element.type === "textarea")!;
    expect(field.props.readOnly).toBe(true); expect(field.props.value).toBe("000-111");
    const select = vi.fn(); field.props.onFocus!({ currentTarget: { select } }); expect(select).toHaveBeenCalledTimes(1);
    expect(feedback(failed).some((item) => item.notice)).toBe(false);
  });
  it("clears a previous success when a later clipboard attempt fails", async () => {
    const draw = () => render("copy", () => CopyControl({ value: "1" }));
    draw(); await button(draw(), "링크 복사").props.onClick!();
    mocks.copy.mockRejectedValue(new Error("denied")); await button(draw(), "링크 복사").props.onClick!();
    expect(feedback(draw())[0]).toEqual({ notice: undefined, error: "복사하지 못했습니다. 직접 선택해서 복사해 주세요." });
  });
});

describe("completion notification presentation", () => {
  it("locks repeated clicks before rendering and keeps recorded success idempotent", async () => {
    let settle!: (value: { notified: boolean }) => void;
    mocks.notify.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    guide(); const click = button(guide(), "입금했어요").props.onClick!;
    const request = click(); await click();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(button(guide(), "입금 알림 처리 중...").props.disabled).toBe(true);
    expect(feedback(guide())).toContainEqual(expect.objectContaining({ notice: "입금 알림을 처리하고 있습니다." }));
    settle({ notified: true }); await request; await click();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(feedback(guide())).toContainEqual({ notice: "입금 알림을 보냈습니다. 운영자 확인을 기다려주세요." });
    expect(elements(guide()).some((element) => text(element.props.children) === "입금했어요" && element.props.onClick)).toBe(false);
  });
  it("keeps a previously recorded notification successful and does not call the action", () => {
    const tree = guide(true);
    expect(feedback(tree)).toContainEqual({ notice: "입금 알림을 보냈습니다. 운영자 확인을 기다려주세요." });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("shows a safe explicit refusal and permits retry only through the existing action", async () => {
    mocks.notify.mockResolvedValueOnce({ notified: false }); guide();
    await button(guide(), "입금했어요").props.onClick!();
    expect(feedback(guide())).toContainEqual(expect.objectContaining({ error: "현재 신청에서는 입금 알림을 기록할 수 없습니다." }));
    await button(guide(), "입금했어요").props.onClick!();
    expect(feedback(guide())).toContainEqual({ notice: "입금 알림을 보냈습니다. 운영자 확인을 기다려주세요." });
  });
  it("does not call an uncertain committed notification failed or expose exceptions", async () => {
    mocks.notify.mockRejectedValue(new Error("private database detail")); guide(); await button(guide(), "입금했어요").props.onClick!();
    expect(feedback(guide())).toContainEqual(expect.objectContaining({ error: "입금 알림 처리 결과를 확인하지 못했습니다. 새로고침하여 접수 여부를 확인해 주세요." }));
    expect(feedback(guide()).some((item) => item.notice?.includes("보냈습니다"))).toBe(false);
    expect(JSON.stringify(feedback(guide()))).not.toContain("private database");
  });
});

describe("completion invitations", () => {
  it("creates once despite double click, hides creation while holding the address, and only removes it after successful cancel", async () => {
    guide(); const click = button(guide(), "초대 링크 만들기").props.onClick!;
    const first = click(); await click(); await first; await click();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(feedback(guide())).toContainEqual(expect.objectContaining({ notice: "친구 보호자 초대 링크를 만들었습니다." }));
    expect(copyControls(guide()).at(-1)?.props.value).toBe("http://localhost:3000/apply/companion/synthetic");
    const cancel = button(guide(), "초대 취소").props.onClick!; const request = cancel(); await cancel(); await request;
    expect(mocks.cancel).toHaveBeenCalledTimes(1); expect(mocks.cancel).toHaveBeenCalledWith("/apply/companion/synthetic");
    expect(copyControls(guide())).toHaveLength(3);
    expect(feedback(guide())).toContainEqual(expect.objectContaining({ notice: "친구 보호자 초대 링크를 취소했습니다." }));
    expect(button(guide(), "초대 링크 만들기").props.disabled).toBe(false);
  });
  it("retains the link and permits retry after a confirmed cancel refusal", async () => {
    await createInvite();
    mocks.cancel.mockResolvedValue({ revoked: false });
    await button(guide(), "초대 취소").props.onClick!();
    expect(copyControls(guide()).at(-1)?.props.value).toContain("/apply/companion/synthetic");
    expect(feedback(guide())).toContainEqual({ error: "초대 링크 취소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", notice: undefined });
    expect(button(guide(), "초대 취소").props.disabled).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["thrown", "missing response", "unclear response"])("hides the invitation and warns against sharing after %s cancellation", async (outcome) => {
    await createInvite();
    if (outcome === "thrown") mocks.cancel.mockRejectedValue(new Error("private cancel detail"));
    else mocks.cancel.mockResolvedValue(outcome === "missing response" ? undefined : { revoked: "unknown" });
    await button(guide(), "초대 취소").props.onClick!();
    for (let rerender = 0; rerender < 2; rerender++) {
      const tree = guide();
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("취소 결과를 확인하기 전에는 기존 초대 주소를 다시 공유하지 마세요. 이미 취소됐을 수 있습니다.");
      expect(html).not.toContain("/apply/companion/synthetic");
      expect(html).not.toContain("초대 링크 복사");
      expect(html).not.toContain("초대 링크를 만들었습니다");
      expect(html).not.toContain("private cancel detail");
      expect(copyControls(tree)).toHaveLength(3);
      expect(button(tree, "초대 취소").props.disabled).toBe(false);
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertainty through cancel retries until confirmed success allows creating again", async () => {
    await createInvite();
    mocks.cancel.mockRejectedValueOnce(new Error("lost response"));
    await button(guide(), "초대 취소").props.onClick!();
    let settle!: (value: { revoked: boolean }) => void;
    mocks.cancel.mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
    const retry = button(guide(), "초대 취소").props.onClick!();
    const pending = renderToStaticMarkup(guide());
    expect(pending).toContain("기존 초대 주소를 다시 공유하지 마세요");
    expect(pending).not.toContain("/apply/companion/synthetic");
    expect(button(guide(), "초대 취소 중...").props.disabled).toBe(true);
    settle({ revoked: false }); await retry;
    expect(renderToStaticMarkup(guide())).toContain("기존 초대 주소를 다시 공유하지 마세요");
    expect(copyControls(guide())).toHaveLength(3);
    await button(guide(), "초대 취소").props.onClick!();
    expect(mocks.cancel).toHaveBeenCalledTimes(3);
    expect(feedback(guide())).toContainEqual({ error: undefined, notice: "친구 보호자 초대 링크를 취소했습니다." });
    expect(button(guide(), "초대 링크 만들기").props.disabled).toBe(false);
    await button(guide(), "초대 링크 만들기").props.onClick!();
    expect(copyControls(guide()).at(-1)?.props.value).toContain("/apply/companion/synthetic");
    expect(renderToStaticMarkup(guide())).not.toContain("기존 초대 주소를 다시 공유하지 마세요");
  });
  it("maps create refusal to safe shared feedback", async () => {
    mocks.create.mockResolvedValue({ error: "server detail" }); guide(); await button(guide(), "초대 링크 만들기").props.onClick!();
    expect(feedback(guide())).toContainEqual({ error: "초대 링크를 만들 수 없습니다. 잠시 후 다시 시도해 주세요.", notice: undefined });
    expect(copyControls(guide())).toHaveLength(3);
  });
  it("maps create exceptions to shared feedback and blocks issuing another invitation after unknown result", async () => {
    mocks.create.mockRejectedValue(new Error("private create detail")); guide();
    const click = button(guide(), "초대 링크 만들기").props.onClick!; await click(); await click();
    expect(feedback(guide())).toContainEqual({ error: "초대 링크 생성 결과를 확인하지 못했습니다. 운영자에게 문의해 주세요.", notice: undefined });
    expect(button(guide(), "초대 링크 만들기").props.disabled).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
