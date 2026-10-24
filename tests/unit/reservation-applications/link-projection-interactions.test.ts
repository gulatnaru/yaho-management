import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClassApplicationLinksView, LinkCompositionOption } from "@/lib/reservation-applications/link-queries";
import type { ClassLinkOperation, ClassLinkReceipt } from "@/server/reservation-applications/groups";

// Handler/state harness deliberately holds server props fixed. This reproduces
// the success/receipt projection gap without pretending to reproduce a browser's Flight abort.
type TransitionState = { active: boolean; routePending: boolean };
const hooks = vi.hoisted(() => ({ frames: {} as Record<string, unknown[]>, frame: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], work: [] as Promise<unknown>[], transitions: [] as TransitionState[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), issue: vi.fn(), classRead: vi.fn(), groupRead: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const frame = hooks.frame, index = hooks.cursor++;
    if (!(index in frame)) frame[index] = initial;
    return [frame[index], (next: unknown) => { frame[index] = typeof next === "function" ? next(frame[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.frame)) hooks.frame[index] = { current: initial };
    return hooks.frame[index];
  },
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => unknown, dependencies: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.frame[index] as unknown[] | undefined;
    if (!previous || dependencies.some((value, position) => value !== previous[position])) { hooks.effects.push(effect); hooks.frame[index] = dependencies; }
  },
  useTransition: () => {
    const index = hooks.cursor++;
    if (!(index in hooks.frame)) {
      const state = { active: false, routePending: false };
      hooks.frame[index] = state; hooks.transitions.push(state);
    }
    const state = hooks.frame[index] as TransitionState;
    return [state.active || state.routePending, (callback: () => unknown) => {
      state.active = true;
      hooks.work.push(Promise.resolve(callback()).finally(() => { state.active = false; }));
    }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(admin)/classes/actions", () => ({ saveApplicationPrice: mocks.save }));
vi.mock("@/app/(admin)/classes/link-projection-actions", () => ({ readClassLinkProjection: mocks.classRead, readGroupLinkProjection: mocks.groupRead }));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ issueClassApplicationLink: mocks.issue, issueApplicationLink: vi.fn(), stopApplicationLink: vi.fn(), upgradeLegacyApplicationLink: vi.fn() }));
const { ApplicationLinkCard } = await import("@/app/(admin)/classes/_components/application-link-card");
const { ApplicationPriceForm } = await import("@/app/(admin)/classes/_components/application-price-form");
const { MultiClassLinkComposer, IssuedLinkControls } = await import("@/app/(admin)/classes/_components/multi-class-link-composer");
const { GroupCreateForm } = await import("@/app/(admin)/reservation-applications/groups/group-create-form");
const { FormFeedback } = await import("@/components/application-ux/form-feedback");
const { Input } = await import("@/components/ui/input");
const { ApplicationStatusFilter } = await import("@/app/(admin)/reservation-applications/_components/application-status-filter");
const { GroupLinkButton } = await import("@/app/(admin)/reservation-applications/groups/group-link-button");
const { LinkImpactConfirmation } = await import("@/app/(admin)/classes/_components/link-impact-confirmation");
const { parseFamilyFilters, familyListHref } = await import("@/lib/reservation-applications/navigation");

type Props = { children?: React.ReactNode; disabled?: boolean; onConfirm?: () => void; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void; onSaved?: () => Promise<void>; onIssued?: (receipt: ClassLinkReceipt) => Promise<void>; price?: number | null; revision?: string; options?: LinkCompositionOption[]; error?: string; notice?: string; url?: string; href?: string };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement<Props>(node) ? text(node.props.children) : "";
}
function render<T>(key: string, component: () => T, commit = true): T {
  hooks.frame = hooks.frames[key] ??= []; hooks.cursor = 0; hooks.effects = [];
  const previous = hooks.frame.slice();
  const tree = component();
  if (commit) hooks.effects.forEach((effect) => effect());
  else hooks.frame.splice(0, hooks.frame.length, ...previous);
  return tree;
}
const revision = "2026-10-20T00:00:00.000Z";
const options: LinkCompositionOption[] = [{ id: "class", label: "합성 클래스", applicationPrice: 20000, eligible: true, revision: "old-link-revision" }];
const readiness = { issuance: "NONE" as const, classIntake: "READY" as const, guideReady: true, consentReady: true, environment: "로컬" as const, publicAccessAllowed: false, accessRestriction: null };
function view(price: number | null = 20000): ClassApplicationLinksView {
  return { classScheduleId: "class", className: "합성 클래스", timeLabel: "합성 시각", applicationPrice: price, priceRevision: revision, revision: "old-link-revision", canIssue: true, environment: "로컬", publicAccessAllowed: false, unissuedReadiness: readiness, scopes: [] };
}
function issuedView(active = true, member = true): ClassApplicationLinksView {
  return { ...view(), scopes: [{ id: "group:group", groupId: "group", label: "이 클래스 전용", scopeActive: active, currentClassMember: member, activeForCurrentClass: active && member, upgraded: false, members: [{ id: "class", label: "합성 클래스" }], links: [{ id: "link", isActive: active, rawPath: null, issuedAtLabel: "합성 시각", issuedByName: "합성 관리자" }], readiness }] };
}
const receipt: ClassLinkReceipt = { groupId: "group", linkId: "link", token: "synthetic-memory-only", replayed: false, active: true };
function card(data: ClassApplicationLinksView | null, available = options) { return render("card", () => ApplicationLinkCard({ view: data, classScheduleId: "class", options: available })); }
function formFrom(tree: React.ReactNode) {
  const props = elements(tree).find((node) => node.type === ApplicationPriceForm)!.props;
  return () => render("price", () => ApplicationPriceForm({ classScheduleId: "class", price: props.price!, revision: props.revision!, disabled: false, onSaved: props.onSaved! }));
}
async function submit(tree: React.ReactNode) {
  elements(tree).find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() });
  await Promise.all(hooks.work.splice(0));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); hooks.frames = {}; hooks.work = []; hooks.transitions = [];
  vi.stubGlobal("React", React); vi.stubGlobal("window", { location: { origin: "http://localhost:3000" }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // Next router.refresh returns void. Model its route work separately from the
  // action promise: a controlled noncommitting refresh keeps its transition pending.
  mocks.refresh.mockImplementation(() => { hooks.transitions.filter((state) => state.active).forEach((state) => { state.routePending = true; }); });
  mocks.save.mockResolvedValue({ revision: "2026-10-20T00:00:00.001Z" });
  mocks.issue.mockResolvedValue(receipt);
});
afterEach(() => vi.unstubAllGlobals());

it.each([25000, 65000])("displays saved %i and fresh price/link/composition revisions while route props never commit", async (amount) => {
  const original = view(amount === 25000 ? null : 60000);
  const fresh = { ...view(amount), priceRevision: "2026-10-20T00:00:00.001Z", revision: "fresh-link" };
  const freshOptions = [{ ...options[0]!, applicationPrice: amount, revision: "fresh-link" }];
  mocks.classRead.mockResolvedValue({ view: fresh, options: freshOptions });
  const price = formFrom(card(original));
  elements(price()).find((node) => node.type === Input)!.props.onChange!({ target: { value: String(amount) } });
  await submit(price());
  const updated = card(original);
  expect(text(updated)).toContain(`참가비: ${amount.toLocaleString("ko-KR")}원`);
  expect(elements(updated).find((node) => node.type === ApplicationPriceForm)?.props).toMatchObject({ price: amount, revision: fresh.priceRevision });
  expect(elements(updated).find((node) => node.type === MultiClassLinkComposer)?.props.options).toEqual(freshOptions);
  expect(elements(price()).find((node) => node.type === FormFeedback)?.props.notice).toBe("신청금액을 저장했습니다.");
  expect(mocks.save).toHaveBeenCalledWith({ classScheduleId: "class", revision, applicationPrice: amount });
  expect(mocks.classRead).toHaveBeenCalledWith("class"); expect(mocks.refresh).not.toHaveBeenCalled();
});
it("retains saved notice on projection failure and never retries the committed write", async () => {
  const original = view(); mocks.classRead.mockRejectedValueOnce(new Error("SYNTHETIC_READ_FAILED"));
  const price = formFrom(card(original)); await submit(price());
  expect(elements(price()).find((node) => node.type === FormFeedback)?.props.notice).toBe("신청금액을 저장했습니다.");
  expect(elements(card(original)).find((node) => node.type === FormFeedback)?.props.error).toContain("현재 표시를 갱신하지 못했습니다");
  expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.classRead).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
});

it("ignores a late card read after newer server props and after a newer read", async () => {
  const original = view(), newer = view(70000), slow = deferred<{ view: ClassApplicationLinksView; options: LinkCompositionOption[] }>();
  mocks.classRead.mockReturnValueOnce(slow.promise);
  const first = elements(card(original)).find((node) => node.type === ApplicationPriceForm)!.props.onSaved!();
  card(newer); slow.resolve({ view: view(65000), options }); await first;
  expect(text(card(newer))).toContain("참가비: 70,000원");
  const slowAgain = deferred<{ view: ClassApplicationLinksView; options: LinkCompositionOption[] }>();
  mocks.classRead.mockReturnValueOnce(slowAgain.promise).mockResolvedValueOnce({ view: view(75000), options });
  const save = elements(card(newer)).find((node) => node.type === ApplicationPriceForm)!.props.onSaved!;
  const stale = save(); await save(); slowAgain.resolve({ view: view(72000), options }); await stale;
  expect(text(card(newer))).toContain("참가비: 75,000원");
});
it("does not invalidate a live card reconciliation during an abandoned server-prop render", async () => {
  const original = view(), slow = deferred<{ view: ClassApplicationLinksView; options: LinkCompositionOption[] }>();
  mocks.classRead.mockReturnValueOnce(slow.promise);
  const pending = elements(card(original)).find((node) => node.type === ApplicationPriceForm)!.props.onSaved!();
  // No layout effects commit. Refs are shared with the committed frame, as in React.
  render("card", () => ApplicationLinkCard({ view: view(70000), classScheduleId: "class", options }), false);
  slow.resolve({ view: view(65000), options }); await pending;
  expect(text(card(original))).toContain("참가비: 65,000원");
});

it.each([[true, true, true], [false, true, false], [true, false, false]])("reconciles class receipt with authoritative active=%s/member=%s only", async (active, member, shown) => {
  const original = view(); mocks.classRead.mockResolvedValue({ view: issuedView(active, member), options });
  card(original);
  await elements(card(original)).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!(receipt);
  expect(elements(card(original)).some((node) => node.type === IssuedLinkControls)).toBe(shown);
  expect(mocks.refresh).not.toHaveBeenCalled();
  // A subsequent authoritative inactive projection invalidates the retained in-memory receipt.
  expect(elements(card(issuedView(false))).some((node) => node.type === IssuedLinkControls)).toBe(false);
});
it("reconciles single issuance without requiring a second route refresh", async () => {
  const original = view(); mocks.classRead.mockResolvedValue({ view: issuedView(), options });
  const tree = card(original);
  elements(tree).find((node) => node.props.onClick && text(node.props.children) === "신청 링크 발급")!.props.onClick!();
  await Promise.all(hooks.work.splice(0));
  expect(elements(card(original)).some((node) => node.type === IssuedLinkControls)).toBe(true);
  expect(mocks.issue).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it("awaits composer reconciliation and does not add a competing success route refresh", async () => {
  const onIssued = vi.fn(async () => undefined);
  await submit(render("composer", () => MultiClassLinkComposer({ currentClassId: "class", options, onIssued })));
  expect(onIssued).toHaveBeenCalledWith(receipt); expect(mocks.issue).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
});
function projectedGroup(active: boolean, version: string, linkId = "link"): ClassApplicationLinksView {
  const current = issuedView(active);
  return { ...current, revision: `class-${version}`, scopes: current.scopes.map((scope) => ({
    ...scope, revision: `group-${version}`,
    members: [{ id: "class", label: "합성 클래스", revision: `class-${version}` }, { id: "second", label: "다른 합성 클래스", revision: `second-${version}` }],
    links: [{ ...scope.links[0]!, id: linkId }],
    readiness: { ...readiness, issuance: active ? "ACTIVE" : "STOPPED" },
  })) };
}
function groupProps(tree: React.ReactNode) {
  return elements(tree).find((node) => node.type === GroupLinkButton)!.props as React.ComponentProps<typeof GroupLinkButton>;
}
function groupButton(props: React.ComponentProps<typeof GroupLinkButton>) { return render("group-button", () => GroupLinkButton(props)); }
function click(tree: React.ReactNode, label: string) { elements(tree).find((node) => node.props.onClick && text(node.props.children) === label)!.props.onClick!(); }
function confirm(tree: React.ReactNode) { elements(tree).find((node) => node.type === LinkImpactConfirmation)!.props.onConfirm!(); }

it.each([false, true])("keeps post-stop resume operable after issuance/projection with route commit=%s", async (commitRoute) => {
  const original = view();
  mocks.classRead.mockResolvedValueOnce({ view: projectedGroup(true, "issued"), options }).mockResolvedValueOnce({ view: projectedGroup(false, "stopped"), options });
  click(card(original), "신청 링크 발급"); await Promise.all(hooks.work.splice(0));
  expect(elements(card(original)).some((node) => node.type === IssuedLinkControls)).toBe(true);
  const activeProps = groupProps(card(original));
  click(groupButton(activeProps), "신청 접수 중지");
  mocks.issue.mockResolvedValueOnce({ groupId: "group", active: false, replayed: false });
  confirm(groupButton(activeProps)); await Promise.all(hooks.work.splice(0));
  const stopped = card(original), stoppedProps = groupProps(stopped);
  expect(text(stopped)).toContain("링크 비활성 · 접수 중지");
  expect(elements(stopped).some((node) => node.type === IssuedLinkControls)).toBe(false);
  expect(stoppedProps).toMatchObject({ revision: "group-stopped", revisions: { class: "class-stopped", second: "second-stopped" } });
  if (commitRoute) hooks.transitions.forEach((state) => { state.routePending = false; });
  const resume = elements(groupButton(stoppedProps)).find((node) => text(node.props.children) === "접수 재개 및 새 링크 발급")!;
  const transition = hooks.frames["group-button"]![0] as TransitionState;
  const operation = hooks.frames["group-button"]![5] as { current: unknown };
  const canOperate = Boolean(stoppedProps.revision && stoppedProps.members?.length && stoppedProps.members.every((member) => stoppedProps.revisions?.[member.id]));
  expect({ pending: transition.active || transition.routePending, canOperate, attempt: operation.current, disabled: resume.props.disabled }).toEqual({ pending: false, canOperate: true, attempt: undefined, disabled: false });

  mocks.classRead.mockResolvedValueOnce({ view: projectedGroup(true, "resumed", "resumed-link"), options });
  mocks.issue.mockResolvedValueOnce({ ...receipt, linkId: "resumed-link" });
  click(groupButton(stoppedProps), "접수 재개 및 새 링크 발급"); confirm(groupButton(stoppedProps));
  await Promise.all(hooks.work.splice(0));
  expect(mocks.issue.mock.calls[2]![0]).toMatchObject({ kind: "resume", groupRevision: "group-stopped", revisions: { class: "class-stopped", second: "second-stopped" }, classScheduleIds: ["class", "second"] });
  const resumedProps = groupProps(card(original));
  expect(elements(groupButton(resumedProps)).find((node) => text(node.props.children) === "링크 교체")?.props.disabled).toBe(false);
  expect(elements(card(original)).find((node) => node.type === IssuedLinkControls)?.props.url).toContain(receipt.token);

  mocks.classRead.mockResolvedValueOnce({ view: projectedGroup(true, "replaced", "replaced-link"), options });
  mocks.issue.mockResolvedValueOnce({ ...receipt, linkId: "replaced-link" });
  click(groupButton(resumedProps), "링크 교체"); confirm(groupButton(resumedProps));
  await Promise.all(hooks.work.splice(0));
  expect(mocks.issue.mock.calls[3]![0]).toMatchObject({ kind: "replace", groupRevision: "group-resumed", revisions: { class: "class-resumed", second: "second-resumed" } });
  expect(groupProps(card(original))).toMatchObject({ revision: "group-replaced", revisions: { class: "class-replaced", second: "second-replaced" } });
  const operations = mocks.issue.mock.calls.map(([operation]) => operation as ClassLinkOperation);
  expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(4);
  expect(mocks.classRead).toHaveBeenCalledTimes(4); expect(mocks.refresh).not.toHaveBeenCalled();
});
it("holds group controls pending until the authoritative post-stop revisions arrive", async () => {
  const original = projectedGroup(true, "issued"), slow = deferred<{ view: ClassApplicationLinksView; options: LinkCompositionOption[] }>();
  mocks.classRead.mockReturnValueOnce(slow.promise);
  mocks.issue.mockResolvedValueOnce({ groupId: "group", active: false, replayed: false });
  const activeProps = groupProps(card(original));
  click(groupButton(activeProps), "신청 접수 중지"); confirm(groupButton(activeProps));
  await Promise.resolve();
  expect(mocks.classRead).toHaveBeenCalledWith("class");
  expect(elements(groupButton(groupProps(card(original)))).find((node) => text(node.props.children) === "링크 교체")?.props.disabled).toBe(true);
  expect((hooks.frames["group-button"]![5] as { current: unknown }).current).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
  slow.resolve({ view: projectedGroup(false, "stopped"), options });
  await Promise.all(hooks.work.splice(0));
  const stoppedProps = groupProps(card(original));
  expect(stoppedProps).toMatchObject({ revision: "group-stopped", revisions: { class: "class-stopped", second: "second-stopped" } });
  expect(elements(groupButton(stoppedProps)).find((node) => text(node.props.children) === "접수 재개 및 새 링크 발급")?.props.disabled).toBe(false);
});
it("reports a post-stop projection failure without retrying the completed mutation", async () => {
  const original = projectedGroup(true, "issued"), props = groupProps(card(original));
  mocks.classRead.mockRejectedValueOnce(new Error("SYNTHETIC_READ_FAILED"));
  mocks.issue.mockResolvedValueOnce({ groupId: "group", active: false, replayed: false });
  click(groupButton(props), "신청 접수 중지"); confirm(groupButton(props));
  await Promise.all(hooks.work.splice(0));
  expect(elements(card(original)).find((node) => node.type === FormFeedback)?.props.error).toContain("현재 표시를 갱신하지 못했습니다");
  const finished = groupButton(groupProps(card(original)));
  expect(elements(finished).find((node) => node.type === FormFeedback)?.props.notice).toContain("신규 신청을 중지했습니다");
  expect(text(finished)).not.toContain("같은 작업 다시 시도");
  expect((hooks.frames["group-button"]![5] as { current: unknown }).current).toBeUndefined();
  expect(mocks.issue).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it.each(["lost-response", "action-error"])("keeps %s retry frozen across newer props without automatic reissue", async (failure) => {
  const props = groupProps(card(projectedGroup(true, "issued")));
  if (failure === "lost-response") mocks.issue.mockRejectedValueOnce(new Error("SYNTHETIC_LOST_RESPONSE"));
  else mocks.issue.mockResolvedValueOnce({ error: "SYNTHETIC_ACTION_ERROR" });
  click(groupButton(props), "신청 접수 중지"); confirm(groupButton(props));
  await Promise.all(hooks.work.splice(0));
  const firstRequest = mocks.issue.mock.calls[0]![0] as ClassLinkOperation;
  const newerProps = groupProps(card(projectedGroup(true, "newer")));
  const unresolved = groupButton(newerProps);
  expect(mocks.issue).toHaveBeenCalledOnce();
  expect(elements(unresolved).find((node) => text(node.props.children) === "링크 교체")?.props.disabled).toBe(true);
  expect((hooks.frames["group-button"]![5] as { current: unknown }).current).toBe(firstRequest);
  mocks.issue.mockResolvedValueOnce({ groupId: "group", active: false, replayed: true });
  mocks.classRead.mockResolvedValueOnce({ view: projectedGroup(false, "stopped"), options });
  click(unresolved, "같은 작업 다시 시도"); await Promise.all(hooks.work.splice(0));
  expect(mocks.issue.mock.calls[1]![0]).toBe(firstRequest);
  expect(firstRequest).toMatchObject({ kind: "stop", groupRevision: "group-issued", revisions: { class: "class-issued", second: "second-issued" } });
  expect(mocks.classRead).toHaveBeenCalledOnce(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it("retains conflict refresh and clears the conflicted attempt without reconciling a success", async () => {
  const props = groupProps(card(projectedGroup(true, "issued")));
  mocks.issue.mockResolvedValueOnce({ error: "SYNTHETIC_CONFLICT", conflict: true });
  click(groupButton(props), "신청 접수 중지"); confirm(groupButton(props)); await Promise.all(hooks.work.splice(0));
  expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.classRead).not.toHaveBeenCalled();
  expect((hooks.frames["group-button"]![5] as { current: unknown }).current).toBeUndefined();
  expect(elements(groupButton(props)).some((node) => node.type === LinkImpactConfirmation)).toBe(false);
  expect(elements(groupButton(props)).find((node) => node.type === FormFeedback)?.props.error).toBe("SYNTHETIC_CONFLICT");
});
it("retains the standalone success refresh when no authoritative callback is supplied", async () => {
  const props = { ...groupProps(card(projectedGroup(true, "issued"))), onIssued: undefined };
  mocks.issue.mockResolvedValueOnce({ groupId: "group", active: false, replayed: false });
  click(groupButton(props), "신청 접수 중지"); confirm(groupButton(props)); await Promise.all(hooks.work.splice(0));
  expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.classRead).not.toHaveBeenCalled();
  expect((hooks.frames["group-button"]![5] as { current: unknown }).current).toBeUndefined();
});
it.each([["group", ["link"], true], ["group", [], false], ["other-group", ["link"], false]])("checks exact group %s active IDs %s before exposing group receipt", async (groupId, ids, shown) => {
  const original: string[] = []; mocks.groupRead.mockResolvedValue({ groupId, activeLinkIds: ids, members: { class: { revision: "fresh-group-revision", applicationPrice: 25000, eligible: true } } });
  const group = () => render("group", () => GroupCreateForm({ classes: options, activeLinkIds: original }));
  await elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!(receipt);
  expect(elements(group()).some((node) => node.type === IssuedLinkControls)).toBe(shown);
  if (shown) expect(elements(group()).find((node) => node.type === MultiClassLinkComposer)?.props.options?.[0]?.revision).toBe("fresh-group-revision");
  expect(mocks.groupRead).toHaveBeenCalledWith("group");
  expect(elements(render("group", () => GroupCreateForm({ classes: options, activeLinkIds: [] }))).some((node) => node.type === IssuedLinkControls)).toBe(false);
});
it("keeps group token hidden on read failure and rejects a late read after newer inactive props", async () => {
  const original: string[] = []; mocks.groupRead.mockRejectedValueOnce(new Error("SYNTHETIC_READ_FAILED"));
  const group = (ids = original) => render("group", () => GroupCreateForm({ classes: options, activeLinkIds: ids }));
  await elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!(receipt);
  expect(elements(group()).some((node) => node.type === IssuedLinkControls)).toBe(false);
  expect(elements(group()).find((node) => node.type === FormFeedback)?.props.error).toContain("발급은 완료");
  const slow = deferred<{ groupId: string; activeLinkIds: string[] }>(); mocks.groupRead.mockReturnValueOnce(slow.promise);
  const pending = elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!(receipt);
  const newer: string[] = []; group(newer); slow.resolve({ groupId: "group", activeLinkIds: ["link"] }); await pending;
  expect(elements(group(newer)).some((node) => node.type === IssuedLinkControls)).toBe(false);
});
it("retains all group choices and accumulates fresh member revisions across intentional new issuances", async () => {
  const classes = Array.from({ length: 101 }, (_, index) => ({ ...options[0]!, id: `class-${index}`, revision: `old-${index}` }));
  const activeLinkIds: string[] = [];
  const group = () => render("group", () => GroupCreateForm({ classes, activeLinkIds }));
  mocks.groupRead.mockResolvedValueOnce({ groupId: "group", activeLinkIds: ["link"], members: { "class-0": { revision: "fresh-0", applicationPrice: 25000, eligible: true } } });
  await elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!(receipt);
  mocks.groupRead.mockResolvedValueOnce({ groupId: "group-2", activeLinkIds: ["link-2"], members: { "class-1": { revision: "fresh-1", applicationPrice: 65000, eligible: false } } });
  await elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!({ ...receipt, groupId: "group-2", linkId: "link-2" });
  const currentOptions = elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.options!;
  expect(currentOptions).toHaveLength(101);
  expect(currentOptions.slice(0, 3).map((row) => row.revision)).toEqual(["fresh-0", "fresh-1", "old-2"]);
  expect(currentOptions[1]).toMatchObject({ applicationPrice: 65000, eligible: false });
});
it("ignores an older group read that resolves after a newer receipt", async () => {
  const activeLinkIds: string[] = [];
  const group = () => render("group", () => GroupCreateForm({ classes: options, activeLinkIds }));
  const slow = deferred<{ groupId: string; activeLinkIds: string[]; members: Record<string, { revision: string }> }>();
  mocks.groupRead.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ groupId: "new-group", activeLinkIds: ["new-link"], members: { class: { revision: "new-revision" } } });
  const onIssued = elements(group()).find((node) => node.type === MultiClassLinkComposer)!.props.onIssued!;
  const first = onIssued(receipt);
  await onIssued({ ...receipt, groupId: "new-group", linkId: "new-link", token: "synthetic-new-memory-only" });
  slow.resolve({ groupId: "group", activeLinkIds: ["link"], members: { class: { revision: "stale-revision" } } }); await first;
  expect(elements(group()).find((node) => node.type === IssuedLinkControls)?.props.url).toContain("synthetic-new-memory-only");
  expect(elements(group()).find((node) => node.type === MultiClassLinkComposer)?.props.options?.[0]?.revision).toBe("new-revision");
});
it.each(["SUBMITTED", "all", "CONFIRMED"])("uses a native clear anchor preserving %s and every unrelated filter, resetting only class/page", (status) => {
  const filters = parseFamilyFilters({ status, classScheduleId: "class", page: 4, notification: "received", bankRecord: "recorded" });
  const tree = ApplicationStatusFilter({ filters });
  const clear = elements(tree).find((node) => text(node.props.children) === "클래스 필터 해제")!;
  expect(clear.type).toBe("a"); expect(clear.props.onClick).toBeUndefined();
  expect(clear.props.href).toBe(familyListHref({ ...filters, classScheduleId: undefined, page: 1 }));
  expect(clear.props.href).toContain("notification=received&bankRecord=recorded");
  expect(clear.props.href).not.toMatch(/classScheduleId|page=/);
});
