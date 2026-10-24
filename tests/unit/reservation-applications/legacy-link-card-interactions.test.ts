import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClassApplicationLinksView } from "@/lib/reservation-applications/link-queries";

// Component-handler unit harness: effects/state are driven explicitly, without claiming browser coverage.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], work: [] as Promise<unknown>[] }));
const mocks = vi.hoisted(() => ({ issue: vi.fn(), stop: vi.fn(), upgrade: vi.fn(), refresh: vi.fn(), reload: vi.fn(), copy: vi.fn(), share: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useTransition: () => [false, (callback: () => unknown) => { hooks.work.push(Promise.resolve(callback())); }],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(admin)/classes/actions", () => ({ saveApplicationPrice: vi.fn() }));
vi.mock("@/app/(admin)/classes/link-projection-actions", () => ({ readClassLinkProjection: vi.fn() }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ issueApplicationLink: mocks.issue, stopApplicationLink: mocks.stop, upgradeLegacyApplicationLink: mocks.upgrade, issueClassApplicationLink: vi.fn() }));
const { ApplicationLinkCard } = await import("@/app/(admin)/classes/_components/application-link-card");
const { CopyControl } = await import("@/components/application-ux/copy-control");
const { FormFeedback } = await import("@/components/application-ux/form-feedback");
const { LinkImpactConfirmation } = await import("@/app/(admin)/classes/_components/link-impact-confirmation");
const { IssuedLinkControls } = await import("@/app/(admin)/classes/_components/multi-class-link-composer");

type Props = { children?: React.ReactNode; onClick?: () => unknown; onConfirm?: () => unknown; onFocus?: (event: { currentTarget: { select: () => void } }) => void; value?: string; readOnly?: boolean; disabled?: boolean; notice?: string; error?: string; failureMessage?: string };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement<Props>(node) ? text(node.props.children) : "";
}
function button(tree: React.ReactNode, label: string) {
  const found = elements(tree).find((node) => node.props.onClick && text(node.props.children) === label);
  expect(found, label).toBeDefined();
  return found!;
}
const revision = "a".repeat(64);
function view(token = "old", nextRevision = revision): ClassApplicationLinksView {
  const readiness = { issuance: "ACTIVE" as const, classIntake: "READY" as const, guideReady: false, consentReady: false, environment: "로컬" as const, publicAccessAllowed: false, accessRestriction: null };
  return { classScheduleId: "class-1", className: "합성 프로그램", timeLabel: "합성 일시", applicationPrice: null, canIssue: true, revision: nextRevision,
    environment: "로컬", publicAccessAllowed: false, unissuedReadiness: readiness,
    scopes: [{ id: "class:class-1", label: "이 클래스 전용", groupId: null, scopeActive: true, currentClassMember: true, activeForCurrentClass: true, upgraded: false, members: [{ id: "class-1", label: "합성 프로그램" }], readiness,
      links: [{ id: "legacy", isActive: true, issuedAtLabel: "합성 시각", issuedByName: "합성 관리자", rawPath: `/apply/${token}` }] }] };
}
function render(data: ClassApplicationLinksView | null = view()) {
  hooks.cursor = 0; hooks.effects = [];
  const tree = ApplicationLinkCard({ classScheduleId: "class-1", view: data, options: [] });
  hooks.effects.forEach((effect) => effect());
  return tree;
}
async function reissue() {
  button(render(), "기존 주소 무효화 후 재발급").props.onClick!();
  elements(render()).find((node) => node.type === LinkImpactConfirmation)!.props.onConfirm!();
  await Promise.all(hooks.work.splice(0));
}
beforeEach(() => {
  vi.resetAllMocks(); hooks.values = []; hooks.cursor = 0; hooks.work = []; hooks.effects = [];
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000", reload: mocks.reload }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.copy }, share: mocks.share });
  mocks.issue.mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  [undefined, "복사하지 못했습니다. 직접 선택해서 복사해 주세요."],
  ["복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.", "복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요."],
])("uses scoped copy failure guidance %s, retaining manual selection and successful retry", async (failureMessage, expected) => {
  const value = "http://localhost:3000/apply/synthetic";
  const copy = () => { hooks.cursor = 0; return CopyControl({ value, failureMessage }); };
  copy(); hooks.effects.forEach((effect) => effect());
  mocks.copy.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
  await button(copy(), "링크 복사").props.onClick!();
  const denied = copy();
  expect(elements(denied).find((node) => node.type === FormFeedback)?.props.error).toBe(expected);
  const address = elements(denied).find((node) => node.type === "textarea")!;
  expect(address.props.value).toBe(value); expect(address.props.readOnly).toBe(true);
  const select = vi.fn(); address.props.onFocus!({ currentTarget: { select } }); expect(select).toHaveBeenCalledOnce();
  await button(copy(), "링크 복사").props.onClick!();
  expect(mocks.copy).toHaveBeenLastCalledWith(value);
  expect(elements(copy()).find((node) => node.type === FormFeedback)?.props.error).toBeUndefined();
  expect(elements(copy()).find((node) => node.type === FormFeedback)?.props.notice).toBe("신청 링크를 복사했습니다.");
});

it("scopes class-card legacy guidance and forwards issued-link guidance while group defaults stay unset", () => {
  render();
  const legacy = elements(render()).find((node) => node.type === CopyControl)!;
  expect(legacy.props.failureMessage).toBe("복사하지 못했습니다. 아래 주소를 길게 눌러 직접 복사해 주세요.");
  hooks.values = []; hooks.cursor = 0;
  const issued = IssuedLinkControls({ url: "http://localhost:3000/apply/synthetic", copyFailureMessage: legacy.props.failureMessage });
  expect(elements(issued).find((node) => node.type === CopyControl)?.props.failureMessage).toBe(legacy.props.failureMessage);
  hooks.cursor = 0;
  expect(elements(IssuedLinkControls({ url: "http://localhost:3000/apply/synthetic" })).find((node) => node.type === CopyControl)?.props.failureMessage).toBeUndefined();
});

it("hides stale addresses after empty reissue success until refreshed, then copies and shares the recovered URL", async () => {
  await reissue();
  expect(mocks.issue).toHaveBeenCalledWith("class-1", revision);
  const waiting = render();
  expect(elements(waiting).filter((node) => node.type === CopyControl)).toHaveLength(0);
  expect(text(waiting)).not.toContain("주소는 발급할 때만 확인");
  expect(elements(waiting).find((node) => node.type === FormFeedback)?.props.notice).toContain("새 주소는 클래스 상세에서 다시 확인");
  button(waiting, "현재 링크 다시 불러오기").props.onClick!();
  expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.reload).toHaveBeenCalledTimes(1);
  const refreshed = render(view("new", "b".repeat(64)));
  const control = elements(refreshed).find((node) => node.type === CopyControl)!;
  expect(control.props.value).toBe("http://localhost:3000/apply/new");
  expect(text(refreshed)).not.toContain("현재 링크 상태와 주소를 다시 확인해야");
  await button(refreshed, "공유하기").props.onClick!();
  expect(mocks.share).toHaveBeenCalledWith({ title: "예약 신청 링크", url: control.props.value });
  // Exercise the actual shared copy handler with its own hook state.
  hooks.values = []; hooks.cursor = 0; hooks.effects = [];
  CopyControl({ value: control.props.value! }); hooks.effects.forEach((effect) => effect());
  hooks.cursor = 0; const copyTree = CopyControl({ value: control.props.value! });
  expect(button(copyTree, "링크 복사").props.disabled).toBe(false);
  await button(copyTree, "링크 복사").props.onClick!();
  expect(mocks.copy).toHaveBeenCalledWith("http://localhost:3000/apply/new");
});

it("explains class-detail recovery after response loss and read failure, keeps frozen retry, then shows the recovered address", async () => {
  mocks.issue.mockRejectedValueOnce(new TypeError("SYNTHETIC_LOST_RESPONSE"));
  await reissue();
  const unresolved = render();
  expect(elements(unresolved).find((node) => node.type === FormFeedback)?.props.error).toContain("재발급된 주소는 클래스 상세에서 다시 확인");
  expect(elements(unresolved).some((node) => node.type === CopyControl)).toBe(false);
  expect(button(unresolved, "기존 주소 무효화 후 재발급").props.disabled).toBe(true);
  const failedRead = render(null);
  expect(text(failedRead)).toContain("재발급된 주소는 클래스 상세에서 다시 확인");
  button(failedRead, "다시 불러오기").props.onClick!();
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  const refreshed = render(view("new", "b".repeat(64)));
  expect(elements(refreshed).find((node) => node.type === CopyControl)?.props.value).toBe("http://localhost:3000/apply/new");
  mocks.issue.mockResolvedValueOnce({ error: "링크 상태가 변경되었습니다. 다시 불러와 현재 주소를 확인해 주세요." });
  button(refreshed, "같은 기존 링크 작업 결과 확인").props.onClick!();
  await Promise.all(hooks.work.splice(0));
  expect(mocks.issue.mock.calls).toEqual([["class-1", revision], ["class-1", revision]]);
  expect(elements(render(view("new", "b".repeat(64)))).find((node) => node.type === CopyControl)?.props.value).toBe("http://localhost:3000/apply/new");
});

it("hides an old address on a returned error that may follow commit and restores the current address on reload", async () => {
  mocks.issue.mockResolvedValueOnce({ error: "기존 링크와 클래스 상태를 확인한 뒤 다시 불러와 주세요." });
  await reissue();
  const failed = render();
  expect(elements(failed).some((node) => node.type === CopyControl)).toBe(false);
  expect(button(failed, "기존 주소 무효화 후 재발급").props.disabled).toBe(true);
  button(failed, "현재 링크 다시 불러오기").props.onClick!();
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  hooks.values = []; // Full document reload remounts, independent of the failed response.
  render(view("committed-new", "b".repeat(64)));
  expect(elements(render(view("committed-new", "b".repeat(64)))).find((node) => node.type === CopyControl)?.props.value).toBe("http://localhost:3000/apply/committed-new");
});

it("recovers the still-valid old address on full reload if the lost request never committed", async () => {
  mocks.issue.mockRejectedValueOnce(new TypeError("SYNTHETIC_PRE_COMMIT_LOSS"));
  await reissue();
  expect(elements(render()).some((node) => node.type === CopyControl)).toBe(false);
  button(render(), "현재 링크 다시 불러오기").props.onClick!();
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  hooks.values = []; // Authoritative detail reload reads the same revision and token.
  render();
  expect(elements(render()).find((node) => node.type === CopyControl)?.props.value).toBe("http://localhost:3000/apply/old");
  expect(button(render(), "기존 주소 무효화 후 재발급").props.disabled).toBe(false);
});

it("does not promise plaintext address recovery after an upgrade loses its response", async () => {
  mocks.upgrade.mockRejectedValueOnce(new TypeError("SYNTHETIC_UPGRADE_LOSS"));
  button(render(), "기존 주소를 유지하고 새 방식으로 전환").props.onClick!();
  elements(render()).find((node) => node.type === LinkImpactConfirmation)!.props.onConfirm!();
  await Promise.all(hooks.work.splice(0));
  const unresolved = render();
  expect(elements(unresolved).find((node) => node.type === FormFeedback)?.props.error).not.toContain("재발급된 주소는 클래스 상세에서 다시 확인");
  expect(text(unresolved)).not.toContain("재발급된 주소는 클래스 상세에서 다시 확인");
  expect(elements(unresolved).some((node) => node.type === CopyControl)).toBe(false);
});
