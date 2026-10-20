import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }));
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), run: vi.fn(), workflow: { busy: false, blocked: false } }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === "function" ? initial() : initial; return [hooks.values[i], (value: unknown) => { hooks.values[i] = typeof value === "function" ? value(hooks.values[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useMemo: (callback: () => unknown) => callback(),
  useEffect: (callback: () => unknown) => { hooks.effects.push(callback); },
}));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({ confirmApplicationSubmission: mocks.confirm }));
vi.mock("@/app/(admin)/reservation-applications/submissions/[id]/workflow-controller", () => ({ useWorkflowCoordinator: () => ({ ...mocks.workflow, run: mocks.run }) }));
import { selectedConfirmationAmounts, SubmissionConfirmationForm } from "@/app/(admin)/reservation-applications/submissions/[id]/confirmation-form";
const applications = [
  { id: "a1", childName: "첫째", quotedAmount: 40000, classLabel: "첫 클래스", classRevision: "v1", candidates: [{ id: "child1", label: "기존 첫째", isRequested: true }] },
  { id: "a2", childName: "둘째", quotedAmount: 60000, classLabel: "둘째 클래스", classRevision: "v1", candidates: [] },
];
type Props = { children?: React.ReactNode; disabled?: boolean; checked?: boolean; value?: string; type?: string; onChange?: (event: { target: { value: string; checked: boolean } }) => void; onClick?: () => unknown; onSubmit?: (event: { preventDefault: () => void }) => void; "data-testid"?: string };
function nodes(tree: React.ReactNode): React.ReactElement<Props>[] { return Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children)] : []; }
function text(tree: React.ReactNode): string { return typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Props>(tree) ? text(tree.props.children) : ""; }
let props: Parameters<typeof SubmissionConfirmationForm>[0];
function render() { hooks.cursor = 0; const result = SubmissionConfirmationForm(props); const effects = hooks.effects.splice(0); effects.forEach((effect) => effect()); return result; }
function card(id: string) { return nodes(render()).find((row) => row.props["data-testid"] === `confirmation-${id}`)!; }
function select(id: string, checked = true) { nodes(card(id)).find((row) => row.props.type === "checkbox")!.props.onChange!({ target: { checked, value: "" } }); }
function choose(id: string, value: string) { nodes(card(id)).find((row) => row.props.onChange && row.props.type !== "checkbox" && row.type !== "textarea")!.props.onChange!({ target: { value, checked: false } }); }
function memo(id: string, value: string) { nodes(card(id)).find((row) => row.type === "textarea")!.props.onChange!({ target: { value, checked: false } }); }
function button(label: string) { return nodes(render()).find((row) => text(row.props.children) === label && (row.props.type === "submit" || row.props.onClick))!; }
async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
async function submit() { render().props.onSubmit({ preventDefault: vi.fn() }); await flush(); }
function sent() { return JSON.parse((mocks.confirm.mock.calls.at(-1)![0] as FormData).get("payload") as string); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("React", React); hooks.values = []; hooks.effects = []; props = { submissionId: "s1", applications, availableAmount: 100000 };
  mocks.workflow.busy = false; mocks.workflow.blocked = false;
  mocks.run.mockImplementation((task) => task()); mocks.confirm.mockResolvedValue({ status: "success", submissionId: "s1", applicationIds: ["a1"], reservationIds: ["r1"], paymentId: "p1" });
});
describe("explicit confirmation selection and isolated drafts", () => {
  it("starts empty, never defaults to requested Child or NEW, and requires explicit per-child choice", async () => {
    expect(button("선택한 아이 0명 예약 확정").props.disabled).toBe(true);
    expect(text(render())).toContain("확정할 아이를 선택해 주세요");
    select("a1"); expect(button("선택한 아이 1명 예약 확정").props.disabled).toBe(true);
    await submit(); expect(mocks.confirm).not.toHaveBeenCalled();
    choose("a1", "child1"); expect(button("선택한 아이 1명 예약 확정").props.disabled).toBe(false);
  });
  it("submits only checked targets with their own memo, preserves sibling drafts and source text is absent", async () => {
    memo("a1", "첫째 검토 메모"); memo("a2", "둘째 미선택 초안"); choose("a2", "NEW"); select("a1"); choose("a1", "child1"); await submit();
    expect(sent().choices).toEqual([{ applicationId: "a1", childId: "child1", memo: "첫째 검토 메모" }]);
    props = { ...props, applications: [applications[1]!] }; render(); render();
    expect(nodes(card("a2")).find((row) => row.type === "textarea")!.props.value).toBe("둘째 미선택 초안");
    expect(button("선택한 아이 0명 예약 확정").props.disabled).toBe(true);
  });
  it("recomputes S and B with A, never D/held or returned funds; unknown quotes/balance block", () => {
    expect(selectedConfirmationAmounts(applications, { a1: true }, 40000)).toEqual({ count: 1, total: 40000, available: 40000, shortfall: 0 });
    expect(selectedConfirmationAmounts(applications, { a1: true, a2: true }, 40000).shortfall).toBe(60000);
    expect(selectedConfirmationAmounts([{ ...applications[0]!, quotedAmount: null }], { a1: true }, 40000).total).toBeNull();
    select("a1"); choose("a1", "NEW"); props.availableAmount = null; render(); render(); expect(button("선택한 아이 1명 예약 확정").props.disabled).toBe(true);
  });
  it("full selection still requires independent NEW/existing choices; deselection instantly removes its amount", async () => {
    select("a1"); select("a2"); choose("a1", "child1"); await submit(); expect(mocks.confirm).not.toHaveBeenCalled();
    choose("a2", "NEW"); expect(text(nodes(render()).find((row) => row.props["data-testid"] === "confirmation-amounts"))).toContain("100,000원");
    select("a2", false); expect(text(nodes(render()).find((row) => row.props["data-testid"] === "confirmation-amounts"))).toContain("40,000원");
  });
  it("prevents double dispatch and retains all drafts on failure", async () => {
    let finish!: (value: unknown) => void; mocks.confirm.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    select("a1"); choose("a1", "NEW"); memo("a1", "실패 보존"); await submit(); await submit(); expect(mocks.confirm).toHaveBeenCalledTimes(1);
    finish({ status: "failure", error: "클래스 상태 변경" }); await flush(); expect(nodes(card("a1")).find((row) => row.type === "textarea")!.props.value).toBe("실패 보존");
  });
  it("response loss freezes writes and tells the operator to query, never re-confirms", async () => {
    mocks.run.mockResolvedValue({ status: "result-unknown", error: "응답 유실" }); select("a1"); choose("a1", "NEW"); await submit(); await submit();
    expect(mocks.run).toHaveBeenCalledTimes(1); expect(text(render())).toContain("예약 확정을 반복하지 마세요");
  });
  it("uses exactly one overbooking primary action, target details, and invalidates on choice change", async () => {
    mocks.confirm.mockResolvedValueOnce({ status: "failure", overbookingConfirmation: { applicationId: "a1", classScheduleId: "c1", childChoice: "NEW", selectionFingerprint: '[["a1","NEW"]]', capacity: 8, reservedCount: 8, overByAfterCreate: 1 } });
    select("a1"); choose("a1", "NEW"); await submit();
    expect(nodes(render()).filter((row) => row.props.type === "submit")).toHaveLength(0); expect(text(render())).toContain("현재 예약 8명");
    const approve = button("초과 예약을 확인하고 선택한 아이 1명 예약 확정"); expect(approve).toBeDefined();
    choose("a1", "child1"); expect(button("선택한 아이 1명 예약 확정")).toBeDefined();
    await submit(); expect(sent().choices[0].confirmOverbooking).toBeUndefined();
  });
  it("transient processing hides A but preserves warning approvals through a normal unchanged refresh", async () => {
    let finish!: (value: unknown) => void; mocks.confirm.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    select("a1"); choose("a1", "NEW"); await submit(); mocks.workflow.busy = true; mocks.workflow.blocked = true;
    expect(text(nodes(render()).find((row) => row.props["data-testid"] === "confirmation-amounts"))).toContain("검증 필요");
    finish({ status: "failure", overbookingConfirmation: { applicationId: "a1", classScheduleId: "c1", childChoice: "NEW", selectionFingerprint: '[["a1","NEW"]]', capacity: 8, reservedCount: 8, overByAfterCreate: 1 } });
    await flush(); mocks.workflow.busy = false; mocks.workflow.blocked = false; render();
    expect(button("초과 예약을 확인하고 선택한 아이 1명 예약 확정").props.disabled).toBe(false); expect(text(render())).not.toContain("서버 금액·신청·클래스 정보가 변경");
  });
  it("does not discard selected drafts when action committed but authoritative refresh failed", async () => {
    mocks.run.mockResolvedValue({ status: "success", verified: false }); select("a1"); choose("a1", "NEW"); memo("a1", "확인 전 초안"); await submit();
    expect(nodes(card("a1")).find((row) => row.props.type === "checkbox")!.props.checked).toBe(true); expect(nodes(card("a1")).find((row) => row.type === "textarea")!.props.value).toBe("확인 전 초안");
  });
  it("requires explicit re-review after ledger/class change and preserves memo", () => {
    select("a1"); choose("a1", "NEW"); memo("a1", "보존 초안"); props = { ...props, availableAmount: 40000, applications: [{ ...applications[0]!, classRevision: "capacity-changed" }, applications[1]!] }; render();
    expect(button("선택한 아이 1명 예약 확정").props.disabled).toBe(true); button("최신 선택 내용 다시 검토함").props.onClick!();
    expect(button("선택한 아이 1명 예약 확정").props.disabled).toBe(false); expect(nodes(card("a1")).find((row) => row.type === "textarea")!.props.value).toBe("보존 초안");
  });
});
