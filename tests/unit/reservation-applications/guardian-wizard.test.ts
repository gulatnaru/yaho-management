import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationWizardProps } from "@/app/(public)/apply/_components/application-wizard";
import type { ChildDraft, RequiredConfirmation } from "@/lib/reservation-applications/application-draft";
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }));
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), navigate: vi.fn(), focus: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? initial() : initial; return [hooks.slots[i], (next: unknown) => { hooks.slots[i] = typeof next === "function" ? next(hooks.slots[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }; return hooks.slots[i]; },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock("react-dom", () => ({ flushSync: (callback: () => void) => callback() }));
vi.mock("@/lib/reservation-applications/complete-navigation", () => ({ openApplicationCompletePage: mocks.navigate }));
import { ApplicationWizard } from "@/app/(public)/apply/_components/application-wizard";
import { ChildDraftCard } from "@/app/(public)/apply/_components/child-draft-card";
import { ConsentReviewStep } from "@/app/(public)/apply/_components/consent-review-step";
import { PublicClassCard } from "@/app/(public)/apply/_components/public-class-card";
import { StepIndicator } from "@/app/(public)/apply/_components/step-indicator";

type Props = { children?: React.ReactNode; onClick?: () => unknown; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; onKeyDown?: (event: { key: string; target: unknown; preventDefault: () => void }) => void; value?: unknown; id?: string; disabled?: boolean; ref?: { current: unknown } };
function elements(node: React.ReactNode): React.ReactElement<Props>[] { return Array.isArray(node) ? node.flatMap(elements) : React.isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : []; }
function text(node: React.ReactNode): string { return typeof node === "string" ? node : typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : React.isValidElement<Props>(node) ? text(node.props.children) : ""; }
function findButton(tree: React.ReactNode, label: string) { const result = elements(tree).find((node) => node.props.onClick && text(node.props.children) === label); expect(result, label).toBeDefined(); return result!; }
const NativeFormData = FormData;
class FormStub extends NativeFormData { constructor(form?: object) { super(); if (form) this.set("website", ""); } }
let props: ApplicationWizardProps;
const prices = [{ classScheduleId: "c1", amount: 60000 }, { classScheduleId: "c2", amount: 40000 }];
const proof = (amount = 60000) => ({ proof: `proof-${amount}`, prices: [{ classScheduleId: "c1", amount }] });
function render() { hooks.cursor = 0; const tree = ApplicationWizard(props); const form = elements(tree).find((node) => node.type === "form"); if (form?.props.ref) form.props.ref.current = { reset: vi.fn() }; return tree; }
function step() { return (elements(render()).find((node) => node.type === StepIndicator) as React.ReactElement<{ step: number }>).props.step; }
async function click(label: string) { findButton(render(), label).props.onClick!(); await flush(); }
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
function field(id: string, value: string) { elements(render()).find((node) => node.props.id === `application-${id}`)!.props.onChange!({ target: { value } }); }
function cards() { return elements(render()).filter((node) => node.type === ChildDraftCard) as unknown as React.ReactElement<Parameters<typeof ChildDraftCard>[0]>[]; }
function consent() { return (elements(render()).find((node) => node.type === ConsentReviewStep) as unknown as React.ReactElement<Parameters<typeof ConsentReviewStep>[0]>).props; }
function updateChild(index: number, key: keyof ChildDraft, value: string | boolean) { cards()[index]!.props.update(key, value); }
function fillChild(index = 0) { updateChild(index, "childName", `합성 자녀 ${index}`); updateChild(index, "childBirthDate", "2020-01-01"); }
async function review() { await click("다음"); field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); if (!props.legacy) field("declaredPayerName", "합성 입금자"); fillChild(); await click("다음"); }
function agree() { for (const key of ["programTerms", "privacyConsent", "legalGuardianConfirmation", "refundTerms"] as RequiredConfirmation[]) consent().updateRequired(key, true); }
function selectedClasses() { return elements(render()).filter((node) => node.type === PublicClassCard) as unknown as React.ReactElement<Parameters<typeof PublicClassCard>[0]>[]; }

beforeEach(() => { hooks.slots = []; hooks.effects = []; vi.clearAllMocks(); vi.stubGlobal("React", React); vi.stubGlobal("FormData", FormStub); vi.stubGlobal("HTMLTextAreaElement", class Textarea {}); vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback()); vi.stubGlobal("document", { getElementById: mocks.focus.mockReturnValue({ focus: vi.fn() }) }); vi.stubGlobal("fetch", mocks.fetch); vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { reload: vi.fn() } });
  props = { action: vi.fn().mockResolvedValue({ submitted: true }), recheck: vi.fn().mockResolvedValue({ priceReview: proof() }), classes: [{ id: "c1", label: "합성 클래스", applicationPrice: 60000 }] };
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ guardian: null, children: [] }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("guardian three-step handlers (isolated hooks; browser focus is not simulated)", () => {
  it("uses three steps and next/back/Enter/form-submit never save", async () => {
    expect(step()).toBe(1); await click("다음"); expect(step()).toBe(2); await click("이전"); expect(step()).toBe(1);
    elements(render()).find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() });
    expect(props.action).not.toHaveBeenCalled(); expect(props.recheck).not.toHaveBeenCalled();
  });
  it("Enter is prevented on text inputs, checkboxes and action buttons, while textarea newlines remain available", async () => {
    await review(); agree();
    const onKey = elements(render()).find((node) => node.type === "form")!.props.onKeyDown!;
    for (const target of [{ type: "text" }, { type: "checkbox" }, { type: "button" }]) {
      const preventDefault = vi.fn(); onKey({ key: "Enter", target, preventDefault }); expect(preventDefault).toHaveBeenCalledOnce();
    }
    const preventDefault = vi.fn(); onKey({ key: "Enter", target: new HTMLTextAreaElement(), preventDefault }); expect(preventDefault).not.toHaveBeenCalled();
    expect(props.action).not.toHaveBeenCalled();
  });
  it("pagehide erases PII and disables the form before a BFCache restore", async () => {
    render(); hooks.effects[1]!(); await review(); agree();
    const listener = vi.mocked(window.addEventListener).mock.calls.find(([event]) => event === "pagehide")![1] as () => void;
    listener(); expect(text(render())).toBe("현재 신청을 받지 않는 링크입니다.");
    expect(JSON.stringify(hooks.slots)).not.toContain("합성 보호자"); expect(JSON.stringify(hooks.slots)).not.toContain("합성 자녀");
    const restore = vi.mocked(window.addEventListener).mock.calls.find(([event]) => event === "pageshow")![1] as unknown as (event: { persisted: boolean }) => void;
    restore({ persisted: true }); expect(window.location.reload).not.toHaveBeenCalled(); expect(text(render())).toBe("현재 신청을 받지 않는 링크입니다."); expect(props.action).not.toHaveBeenCalled();
  });
  it("single-class legacy stays amount-free and one child without modern rechecks", async () => {
    props.legacy = true; props.classes[0]!.applicationPrice = null;
    await review(); expect(step()).toBe(3); expect(props.recheck).not.toHaveBeenCalled(); expect(text(render())).not.toContain("예상 총 참가비");
    await click("이전"); expect(cards()).toHaveLength(1); expect(text(render())).not.toContain("내 자녀 추가");
  });
  it("validates fields separately before server review and opens/focuses error child", async () => {
    await click("다음"); cards()[0]!.props.toggle(); await click("다음");
    expect(cards()[0]!.props.expanded).toBe(true); expect(text(render())).toContain("2단계 자녀 1"); expect(text(render())).toContain("보호자 이름을 입력해 주세요.");
    expect(props.action).not.toHaveBeenCalled(); expect(props.recheck).not.toHaveBeenCalled(); expect(mocks.focus).toHaveBeenCalledWith("application-guardianName");
  });
  it("rejects future birthdate and preserves valid guardian input", async () => {
    await click("다음"); field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자"); fillChild(); updateChild(0, "childBirthDate", "2999-01-01"); await click("다음");
    expect(text(render())).toContain("미래 날짜"); expect(cards()[0]!.props.child.childBirthDate).toBe("2999-01-01");
    expect(elements(render()).find((node) => node.props.id === "application-guardianName")!.props.value).toBe("합성 보호자");
  });
  it("middle removal keeps stable IDs, independent optional consent, and max/min bounds", async () => {
    await click("다음"); fillChild(); await click("내 자녀 추가"); await click("내 자녀 추가"); updateChild(2, "childName", "셋째 합성"); updateChild(2, "photoShareConsent", true);
    cards()[1]!.props.remove(); expect(cards().map((card) => card.props.child.draftId)).toEqual(["child-1", "child-3"]); expect(cards()[1]!.props.child).toMatchObject({ childName: "셋째 합성", photoShareConsent: true });
    for (let i = 0; i < 8; i++) await click("내 자녀 추가"); expect(cards()).toHaveLength(10); expect(findButton(render(), "내 자녀 추가").props.disabled).toBe(true);
  });
  it("candidate removal empties affected child class and never reassigns it", async () => {
    props.classes.push({ id: "c2", label: "다른 합성 클래스", applicationPrice: 40000 });
    selectedClasses()[0]!.props.onChange(); selectedClasses()[1]!.props.onChange(); await click("다음"); updateChild(0, "classScheduleId", "c1"); await click("이전"); selectedClasses()[0]!.props.onChange(); await click("다음");
    expect(cards()[0]!.props.child.classScheduleId).toBe(""); expect(cards()[0]!.props.classes.map((item) => item.id)).toEqual(["c2"]);
  });
  it("common confirmations reset after adding a child, preserving the first child's optional choices", async () => {
    await review(); agree(); consent().updateOptional("child-1", "photoShareConsent", true); await click("이전"); await click("내 자녀 추가"); fillChild(1); await click("다음");
    expect(Object.values(consent().required)).toEqual([false, false, false, false]); expect(consent().drafts[0]!.photoShareConsent).toBe(true); expect(consent().drafts[1]!.photoShareConsent).toBe(false);
  });
  it("only final submit saves all children and duplicate click/Enter is blocked while pending", async () => {
    let resolve!: (value: { submitted: true }) => void; props.action = vi.fn(() => new Promise<{ submitted: true }>((done) => { resolve = done; }));
    await review(); agree(); expect(props.action).not.toHaveBeenCalled(); const button = findButton(render(), "신청서 제출"); button.props.onClick!(); button.props.onClick!(); await flush(); expect(props.action).toHaveBeenCalledTimes(1);
    resolve({ submitted: true }); await flush(); expect(mocks.navigate).toHaveBeenCalledTimes(1); expect(text(render())).toBe("완료 화면으로 이동 중…");
    button.props.onClick!(); await flush(); expect(props.action).toHaveBeenCalledTimes(1);
  });
  it("optional non-consent submits normally; shared required flags are saved independently for each child", async () => {
    await review(); agree(); await click("신청서 제출"); const sent = JSON.parse(String((props.action as ReturnType<typeof vi.fn>).mock.calls[0]![1].get("payload")));
    expect(sent).toMatchObject({ reviewedPriceProof: "proof-60000", children: [expect.objectContaining({ privacyConsent: true, photoShareConsent: false, photoMarketingConsent: false })] }); expect(sent.children[0]).not.toHaveProperty("draftId");
  });
  it("missing required consent blocks and focuses the common field", async () => {
    await review(); await click("신청서 제출"); expect(props.action).not.toHaveBeenCalled(); expect(mocks.focus).toHaveBeenCalledWith("application-programTerms");
  });
  it("first price change during review preserves all fields and requires confirmation then an explicit submit", async () => {
    props.recheck = vi.fn().mockResolvedValue({ priceReview: proof(65000) }); await review(); expect(step()).toBe(3); agree(); consent().updateOptional("child-1", "photoShareConsent", true);
    expect(text(render())).toContain("60,000원 → 65,000원"); await click("신청서 제출"); expect(props.action).not.toHaveBeenCalled(); await click("변경 금액 확인"); expect(props.action).not.toHaveBeenCalled(); expect(consent().drafts[0]).toMatchObject({ childName: "합성 자녀 0", photoShareConsent: true }); await click("신청서 제출"); expect(props.action).toHaveBeenCalledTimes(1);
  });
  it("keeps step 2 pending until an asynchronous price re-query finishes, then requires exact revised price/total approval", async () => {
    props.classes.push({ id: "c2", label: "합성 클래스2", applicationPrice: 40000 });
    let finish!: (value: { priceReview: { proof: string; prices: typeof prices } }) => void;
    props.recheck = vi.fn(() => new Promise<{ priceReview: { proof: string; prices: typeof prices } }>((resolve) => { finish = resolve; }));
    selectedClasses()[0]!.props.onChange(); selectedClasses()[1]!.props.onChange(); await click("다음");
    field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자");
    fillChild(); updateChild(0, "classScheduleId", "c1"); updateChild(0, "photoShareConsent", true);
    await click("내 자녀 추가"); fillChild(1); updateChild(1, "classScheduleId", "c2");
    const before = structuredClone(cards().map((card) => card.props.child));
    await click("다음"); expect(step()).toBe(2);
    expect(elements(render()).find((node) => node.type === "fieldset")!.props.disabled).toBe(true);
    expect(text(render())).toContain("예상 총 참가비 100,000원");
    expect(props.recheck).toHaveBeenCalledWith({ classScheduleIds: ["c1", "c2"], reviewedPriceProof: undefined });
    finish({ priceReview: { proof: "fresh-65000", prices: [{ classScheduleId: "c1", amount: 65000 }, { classScheduleId: "c2", amount: 40000 }] } });
    await flush(); expect(step()).toBe(3);
    expect(elements(render()).find((node) => node.type === "fieldset")!.props.disabled).toBeFalsy();
    expect(text(render())).toContain("60,000원 → 65,000원"); expect(text(render())).toContain("가족 예상 합계 100,000원 → 105,000원");
    expect(consent().drafts).toEqual(before); expect(findButton(render(), "신청서 제출").props.disabled).toBe(true);
    await click("변경 금액 확인");
    expect(text(render())).toContain("예상 총 참가비 105,000원"); expect(consent().drafts).toEqual(before); expect(props.action).not.toHaveBeenCalled();
  });
  it("second submit-time price change also blocks, preserving guardian/child/optional inputs until explicit resubmit", async () => {
    props.action = vi.fn().mockResolvedValueOnce({ priceChanged: true, priceReview: proof(65000), error: "금액 변경" }).mockResolvedValueOnce({ priceChanged: true, priceReview: proof(70000), error: "금액 재변경" }).mockResolvedValue({ submitted: true });
    await review(); agree(); consent().updateOptional("child-1", "photoMarketingConsent", true); await click("신청서 제출");
    expect(text(render())).toContain("60,000원 → 65,000원"); await click("변경 금액 확인"); expect(props.action).toHaveBeenCalledTimes(1); await click("신청서 제출"); expect(text(render())).toContain("65,000원 → 70,000원"); expect(consent().drafts[0]!.photoMarketingConsent).toBe(true); await click("변경 금액 확인"); await click("신청서 제출"); expect(mocks.navigate).toHaveBeenCalledOnce();
  });
  it("expired unchanged review preserves the whole family draft and optional consents until explicit reconfirmation and resubmit", async () => {
    props.action = vi.fn().mockResolvedValueOnce({ priceReviewExpired: true, priceReview: { ...proof(), proof: "same-operation-renewed" }, fieldErrors: { reviewedPriceProof: "최신 참가비 확인" } }).mockResolvedValue({ submitted: true });
    await click("다음"); field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자"); fillChild(); updateChild(0, "requestNote", "첫째 요청"); updateChild(0, "photoShareConsent", true);
    await click("내 자녀 추가"); fillChild(1); updateChild(1, "photoMarketingConsent", true); await click("다음"); agree();
    const before = structuredClone(consent().drafts), confirmations = structuredClone(consent().required);
    await click("신청서 제출"); expect(step()).toBe(3);
    expect(text(render())).toContain("참가비 확인 시간이 만료되었습니다."); expect(text(render())).toContain("입력 내용은 유지됩니다."); expect(text(render())).toContain("가족 예상 합계 120,000원 → 120,000원");
    expect(consent().drafts).toEqual(before); expect(consent().required).toEqual(confirmations);
    expect(text(render())).toContain("합성 보호자 · 010-0000-0000"); expect(text(render())).toContain("합성 입금자");
    await click("신청서 제출"); expect(props.action).toHaveBeenCalledTimes(1);
    await click("최신 금액 다시 확인"); expect(props.action).toHaveBeenCalledTimes(1); expect(consent().drafts).toEqual(before);
    await click("신청서 제출"); expect(props.action).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(String(vi.mocked(props.action).mock.calls[1]![1].get("payload")));
    expect(sent).toMatchObject({ reviewedPriceProof: "same-operation-renewed", children: [expect.objectContaining({ classScheduleId: "c1", requestNote: "첫째 요청", photoShareConsent: true, photoMarketingConsent: false }), expect.objectContaining({ classScheduleId: "c1", photoShareConsent: false, photoMarketingConsent: true })] });
  });
  it("returning from details with expired unchanged prices still requires confirmation and carries the old operation proof", async () => {
    props.recheck = vi.fn().mockResolvedValueOnce({ priceReview: proof() }).mockResolvedValue({ priceReviewExpired: true, priceReview: { ...proof(), proof: "renewed" } });
    await review(); agree(); consent().updateOptional("child-1", "photoShareConsent", true); await click("이전"); await click("다음");
    expect(props.recheck).toHaveBeenLastCalledWith({ classScheduleIds: ["c1"], reviewedPriceProof: "proof-60000" });
    expect(text(render())).toContain("참가비 확인 시간이 만료되었습니다."); expect(consent().drafts[0]!.photoShareConsent).toBe(true);
    await click("신청서 제출"); expect(props.action).not.toHaveBeenCalled(); await click("최신 금액 다시 확인"); expect(props.action).not.toHaveBeenCalled();
    await click("신청서 제출"); expect(props.action).toHaveBeenCalledOnce();
  });
  it("expiry recovery shows every affected class before/after and the child-weighted new family total", async () => {
    props.classes.push({ id: "c2", label: "합성 클래스2", applicationPrice: 40000 });
    const original = { proof: "original", prices };
    props.recheck = vi.fn().mockResolvedValue({ priceReview: original });
    props.action = vi.fn().mockResolvedValue({ priceReviewExpired: true, priceReview: { proof: "renewed", prices: [{ classScheduleId: "c1", amount: 65000 }, { classScheduleId: "c2", amount: 45000 }] } });
    selectedClasses()[0]!.props.onChange(); selectedClasses()[1]!.props.onChange(); await click("다음");
    field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자"); fillChild(); updateChild(0, "classScheduleId", "c1");
    await click("내 자녀 추가"); fillChild(1); updateChild(1, "classScheduleId", "c1"); await click("내 자녀 추가"); fillChild(2); updateChild(2, "classScheduleId", "c2"); await click("다음"); agree();
    await click("신청서 제출"); expect(text(render())).toContain("60,000원 → 65,000원"); expect(text(render())).toContain("40,000원 → 45,000원"); expect(text(render())).toContain("가족 예상 합계 160,000원 → 175,000원");
    await click("최신 금액 다시 확인"); expect(text(render())).toContain("예상 총 참가비 175,000원"); expect(props.action).toHaveBeenCalledOnce();
  });
  it("a saved-operation response during expired recheck preserves the draft and blocks resubmission for result checking", async () => {
    await review(); agree(); consent().updateOptional("child-1", "photoShareConsent", true);
    props.recheck = vi.fn().mockResolvedValue({ resultUnknown: true, error: "이미 접수된 신청일 수 있습니다." });
    await click("이전"); await click("다음");
    expect(text(render())).toContain("신청서를 자동으로 다시 보내지 않습니다."); expect(props.action).not.toHaveBeenCalled();
    expect(cards()[0]!.props.child).toMatchObject({ childName: "합성 자녀 0", photoShareConsent: true });
    expect(elements(render()).find((node) => node.type === "fieldset")!.props.disabled).toBe(true);
    await click("신청 결과 확인"); expect(mocks.navigate).toHaveBeenCalledOnce(); expect(props.action).not.toHaveBeenCalled();
  });
  it("a revoked link after expired review still closes the form and removes private inputs and visible prices", async () => {
    props.action = vi.fn().mockResolvedValueOnce({ priceReviewExpired: true, priceReview: proof(65000) }).mockResolvedValue({ closed: true });
    await review(); agree(); await click("신청서 제출"); await click("최신 금액 다시 확인"); await click("신청서 제출");
    expect(text(render())).toBe("현재 신청을 받지 않는 링크입니다."); expect(JSON.stringify(hooks.slots)).not.toContain("합성 보호자"); expect(JSON.stringify(hooks.slots)).not.toContain("합성 자녀 0");
  });
  it("lost response never auto-resubmits, and the active submit form is blocked", async () => {
    props.action = vi.fn().mockRejectedValue(new Error("synthetic transport loss")); await review(); agree(); await click("신청서 제출"); await click("신청서 제출");
    expect(props.action).toHaveBeenCalledOnce(); expect(text(render())).toContain("자동으로 다시 보내지 않습니다"); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("server errors on an earlier step open the corresponding child without clearing valid fields", async () => {
    props.action = vi.fn().mockResolvedValue({ fieldErrors: { "children.0.childBirthDate": "생년월일 확인" } }); await review(); agree(); await click("신청서 제출");
    expect(text(render())).toContain("2단계 자녀 1 (합성 자녀 0)"); expect(step()).toBe(2); expect(cards()[0]!.props.expanded).toBe(true); expect(cards()[0]!.props.child.childName).toBe("합성 자녀 0"); expect(mocks.focus).toHaveBeenCalledWith("application-child-1-childBirthDate");
  });
  it("closed/revoked response wipes the draft and exposes neither input nor prices", async () => {
    props.recheck = vi.fn().mockResolvedValue({ closed: true }); await review(); expect(text(render())).toBe("현재 신청을 받지 않는 링크입니다."); expect(JSON.stringify(hooks.slots)).not.toContain("합성 보호자"); expect(JSON.stringify(hooks.slots)).not.toContain("합성 자녀 0");
  });
  it("late repeat profile cannot overwrite a guardian's relationship edit", async () => {
    let complete!: (value: unknown) => void; mocks.fetch.mockReturnValue(new Promise((resolve) => { complete = resolve; })); render(); const effect = hooks.effects[0]!; effect(); await click("다음"); field("guardianRelationship", "FATHER");
    complete({ ok: true, json: async () => ({ guardian: { guardianName: "합성 기존 보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" }, children: [] }) }); await flush();
    expect(elements(render()).find((node) => node.props.id === "application-guardianRelationship")!.props.value).toBe("FATHER"); expect(elements(render()).find((node) => node.props.id === "application-guardianName")!.props.value).toBe("");
  });
  it("failed repeat lookup is never described as no registered children", async () => {
    mocks.fetch.mockRejectedValue(new Error("lookup failed")); render(); hooks.effects[0]!(); await flush(); await click("다음"); expect(text(render())).toContain("등록된 자녀가 없는 것으로 확인된 것은 아닙니다");
  });
  it("uses only fetched own-child identities, keeps profiles readonly via the card, and allows switching to new", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ guardian: null, children: [{ id: "owned", name: "합성 기존 아이", birthDate: "2020-01-01", gender: "FEMALE" }] }) }); render(); hooks.effects[0]!(); await flush(); await click("다음"); cards()[0]!.props.chooseRepeat("owned"); expect(cards()[0]!.props.child).toMatchObject({ requestedChildId: "owned", childName: "합성 기존 아이" }); cards()[0]!.props.chooseRepeat(""); expect(cards()[0]!.props.child).toMatchObject({ requestedChildId: undefined, childName: "" });
  });
  it("calculates a changed family total using actual repeated assignments", async () => {
    props.classes.push({ id: "c2", label: "합성 클래스2", applicationPrice: 40000 }); props.recheck = vi.fn().mockResolvedValue({ priceReview: { proof: "review", prices } }); selectedClasses()[0]!.props.onChange(); selectedClasses()[1]!.props.onChange(); await click("다음"); field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자"); fillChild(); updateChild(0, "classScheduleId", "c1"); await click("내 자녀 추가"); fillChild(1); updateChild(1, "classScheduleId", "c1"); expect(text(render())).toContain("예상 총 참가비 120,000원"); expect(text(render())).not.toContain("예상 총 참가비 100,000원");
  });
  it("price review shows both the changed class fee and the 100000 to 105000 family total", async () => {
    props.classes.push({ id: "c2", label: "합성 클래스2", applicationPrice: 40000 });
    props.recheck = vi.fn().mockResolvedValue({ priceReview: { proof: "changed", prices: [{ classScheduleId: "c1", amount: 65000 }, { classScheduleId: "c2", amount: 40000 }] } });
    selectedClasses()[0]!.props.onChange(); selectedClasses()[1]!.props.onChange(); await click("다음");
    field("guardianName", "합성 보호자"); field("guardianPhone", "010-0000-0000"); field("declaredPayerName", "합성 입금자"); fillChild(); updateChild(0, "classScheduleId", "c1");
    await click("내 자녀 추가"); fillChild(1); updateChild(1, "classScheduleId", "c2"); await click("다음");
    expect(text(render())).toContain("60,000원 → 65,000원"); expect(text(render())).toContain("가족 예상 합계 100,000원 → 105,000원");
    await click("신청서 제출"); expect(props.action).not.toHaveBeenCalled(); await click("변경 금액 확인"); expect(props.action).not.toHaveBeenCalled();
  });
  it("removing a child resets common confirmations while the survivor retains optional choices", async () => {
    await review(); agree(); consent().updateOptional("child-1", "photoMarketingConsent", true); await click("이전"); await click("내 자녀 추가"); fillChild(1); await click("다음"); agree();
    await click("이전"); cards()[1]!.props.remove(); await click("다음");
    expect(Object.values(consent().required)).toEqual([false, false, false, false]); expect(consent().drafts[0]!.photoMarketingConsent).toBe(true);
  });

});
