import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import type { WorkflowActionResult } from "@/app/(admin)/reservation-applications/actions";

// Drive real component handlers and isolated hook slots; this is not a browser renderer.
const hooks = vi.hoisted(() => ({ instances: new Map<string, unknown[]>(), name: "", cursor: 0, context: null as unknown, effects: [] as (() => unknown)[] }));
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), lookup: vi.fn(), deposit: vi.fn(), resolve: vi.fn(), returns: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const values = hooks.instances.get(hooks.name)!; const i = hooks.cursor++;
    if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial;
    return [values[i], (next: unknown) => { values[i] = typeof next === "function" ? next(values[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const values = hooks.instances.get(hooks.name)!; const i = hooks.cursor++;
    if (!(i in values)) values[i] = { current: initial }; return values[i];
  },
  useContext: () => hooks.context,
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({
  refreshApplicationWorkflow: mocks.refresh, lookupWorkflowReceipt: mocks.lookup, recordApplicationDeposit: mocks.deposit,
  resolveApplicationWorkflow: mocks.resolve, refreshApplicationReturns: mocks.returns, refreshApplicationReturn: vi.fn(),
}));
vi.mock("@/app/(admin)/reservation-applications/submissions/[id]/confirmation-form", () => ({ SubmissionConfirmationForm: () => null }));
vi.mock("@/app/(admin)/reservation-applications/_components/application-review-focus", () => ({ ApplicationReviewFocus: () => null }));
import { awaitWorkflowRead, awaitWorkflowResult, WorkflowController, workflowReceiptPresent, type WorkflowCoordinator } from "@/app/(admin)/reservation-applications/submissions/[id]/workflow-controller";
import { BankTransactionForm } from "@/app/(admin)/reservation-applications/submissions/[id]/deposit-form";
import { ApplicationResolveForm } from "@/app/(admin)/reservation-applications/_components/application-resolve-form";
import { ApplicationReturnsWorkbench } from "@/app/(admin)/reservation-applications/_components/application-return-card";
import { SubmissionConfirmationForm } from "@/app/(admin)/reservation-applications/submissions/[id]/confirmation-form";

type Props = { children?: React.ReactNode; onClick?: () => unknown; onSubmit?: (event: { preventDefault: () => void }) => unknown; onChange?: (event: { target: { value: string } }) => unknown; value?: unknown; disabled?: boolean; readOnly?: boolean; name?: string; "data-testid"?: string; ref?: { current: unknown } };
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
  const node = elements(tree).find((row) => row.props.onClick && text(row.props.children) === label);
  expect(node, label).toBeDefined(); return node!;
}
function render<T>(name: string, callback: () => T): T {
  hooks.name = name; hooks.cursor = 0;
  if (!hooks.instances.has(name)) hooks.instances.set(name, []);
  return callback();
}
function detail(): ApplicationWorkflowDetail {
  return { id: "s1", personalDataPurgedAt: null, submittedAt: new Date(), guardianName: "합성 보호자", applications: [], deposits: [], returnObligations: [], ledger: { state: "available", Q: 100000, D: 0, P: 0, R: 0, T: 0, A: 0 } } as unknown as ApplicationWorkflowDetail;
}
let initial: ApplicationWorkflowDetail;
function controller(data = initial) { return render("controller", () => WorkflowController({ initialDetail: data, context: {} })); }
function coordinator() { return controller().props.value as WorkflowCoordinator; }
const success: WorkflowActionResult = { status: "success", receiptId: "deposit-1", submissionId: "s1" };
const values = () => ({ amount: "30000", payerName: "실제 합성 입금자", depositedAt: "2026-01-01T09:30" });
const NativeFormData = globalThis.FormData;
class FormStub extends NativeFormData {
  constructor(form?: { values: Record<string, string> }) { super(); if (form) for (const [key, value] of Object.entries(form.values)) this.set(key, value); }
}
async function flush() { for (let n = 0; n < 25; n++) await Promise.resolve(); }
function bank(name = "bank", options: Partial<Parameters<typeof BankTransactionForm>[0]> = {}) {
  return render(name, () => BankTransactionForm({ kind: "deposit", targetId: "s1", save: mocks.deposit, ...options }));
}
function attachForm(tree: React.ReactNode, fields = values()) {
  const form = { values: fields, reset: vi.fn() };
  elements(tree).find((row) => row.type === "form")!.props.ref!.current = form; return form;
}
async function submit(tree: React.ReactNode) { elements(tree).find((row) => row.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() }); await flush(); }
const getKey = (tree: React.ReactNode) => elements(tree).find((row) => row.props.name === "idempotencyKey")!.props.value;
beforeEach(() => {
  vi.resetAllMocks(); hooks.instances.clear(); hooks.context = null; hooks.effects = []; initial = detail();
  vi.stubGlobal("React", React); vi.stubGlobal("FormData", FormStub); vi.stubGlobal("window", { confirm: () => true });
  mocks.lookup.mockResolvedValue({ status: "failure", code: "not-found" }); mocks.deposit.mockResolvedValue(success);
  mocks.refresh.mockResolvedValue({ ...initial, deposits: [{ id: "deposit-1" }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("same-page authoritative workflow", () => {
  it.each([
    { requestedChildId: "requested-child", requestedChildPurgedAt: null, requestedChildPurged: false },
    { requestedChildId: null, requestedChildPurgedAt: new Date("2026-01-01T00:00:00Z"), requestedChildPurged: true },
  ])("passes requested Child binding and purge metadata to confirmation UI: %s", ({ requestedChildId, requestedChildPurgedAt, requestedChildPurged }) => {
    const candidates = [{ id: "requested-child", label: "지정한 아이", isRequested: true }];
    initial.applications = [{ id: "a1", status: "SUBMITTED", childName: "합성 아이", childBirthDate: new Date(), quotedAmount: 40000, requestedChildId, requestedChildPurgedAt, classSchedule: { id: "c1", program: { name: "합성 클래스" }, capacity: 8, _count: { reservations: 0 } }, confirmationCandidates: candidates }] as unknown as ApplicationWorkflowDetail["applications"];
    const confirmation = elements(controller()).find((row) => row.type === SubmissionConfirmationForm) as React.ReactElement<Parameters<typeof SubmissionConfirmationForm>[0]>;
    expect(confirmation.props.applications[0]).toMatchObject({ id: "a1", requestedChildId, requestedChildPurged, candidates });
  });
  it("accepts success only after an authoritative matching receipt and valid ledger", async () => {
    await coordinator().run(async () => success, "deposit", "key-1");
    expect(mocks.refresh).toHaveBeenCalledWith("s1"); expect(coordinator().blocked).toBe(false);
    expect(text(controller())).toContain("저장 결과와 최신 서버 원장을 확인했습니다");
    expect(workflowReceiptPresent(initial, success, "deposit")).toBe(false);
    expect(workflowReceiptPresent({ ...initial, deposits: [{ id: "deposit-1" }] } as ApplicationWorkflowDetail, { ...success, submissionId: "foreign" }, "deposit")).toBe(false);
  });
  it("retains a previous success message during the next save and read, so that message alone is not completion", async () => {
    await coordinator().run(async () => success, "deposit", "key-1");
    let finishSave!: (value: WorkflowActionResult) => void;
    let finishRead!: (value: ApplicationWorkflowDetail) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const pending = coordinator().run(() => new Promise((resolve) => { finishSave = resolve; }), "confirmation", "key-2", { submissionId: "s1", applicationIds: ["a1"] });
    const status = () => elements(controller()).find((node) => node.props["data-testid"] === "workflow-status")!;
    expect(text(status())).toContain("저장 결과와 최신 서버 원장을 확인했습니다");
    expect(text(status().props.children && elements(status())[1])).toBe("저장·서버 원장 확인 중…");
    expect(coordinator().busy).toBe(true); expect(coordinator().blocked).toBe(true);
    const receipt = { id: "r1", paymentItem: { id: "pi1", paymentId: "p1" } };
    const row = { id: "a1", status: "CONFIRMED", quotedAmount: 40000, reservation: receipt, paymentMapping: { paymentItem: { id: "pi1", paymentId: "p1", paidAmount: 40000 } } };
    finishSave({ status: "success", submissionId: "s1", applicationIds: ["a1"], reservationIds: ["r1"], paymentId: "p1" });
    await flush();
    expect(text(status())).toContain("저장·서버 원장 확인 중…"); expect(coordinator().busy).toBe(true);
    finishRead({ ...initial, applications: [row] } as unknown as ApplicationWorkflowDetail);
    await pending;
    expect(text(elements(status())[1])).toBe("서버 원장 확인됨");
    expect(coordinator().busy).toBe(false); expect(coordinator().blocked).toBe(false);
  });
  it.each([null, { ...detail(), ledger: { state: "unavailable" } }, detail()])("blocks stale confirmation and all writes after absent/invalid/unobserved refresh: %s", async (next) => {
    initial.applications = [{ id: "a1", status: "SUBMITTED", childName: "합성 아이", childBirthDate: new Date(), quotedAmount: 40000, classSchedule: { id: "c1", program: { name: "합성 클래스" }, capacity: 8, _count: { reservations: 0 } }, confirmationCandidates: [] }] as unknown as ApplicationWorkflowDetail["applications"];
    mocks.refresh.mockResolvedValue(next);
    await coordinator().run(async () => success, "deposit", "key-1");
    expect(coordinator().blocked).toBe(true); expect(text(controller())).toContain("갱신 실패");
    const confirmationSection = elements(controller()).find((row) => row.props["data-testid"] === "family-confirmation");
    expect(confirmationSection).toBeDefined();
    const confirmation = elements(confirmationSection).find((row) => row.type === "fieldset");
    expect(confirmation).toBeDefined(); expect(confirmation!.props.disabled).toBe(true);
    expect(text(controller())).not.toContain("D = A + P + R + T");
  });
  it("recovers a saved receipt after refresh failure without re-executing the financial request", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("SYNTHETIC_READ_FAILURE")); const save = vi.fn().mockResolvedValue(success);
    await coordinator().run(save, "deposit", "key-1"); expect(coordinator().blocked).toBe(true);
    await button(controller(), "최신 서버 상태 다시 조회").props.onClick!();
    expect(coordinator().blocked).toBe(false); expect(save).toHaveBeenCalledTimes(1);
  });
  it("distinguishes definitive failure, unknown transport and refresh failure; never automatically replays", async () => {
    const failed = { status: "failure" as const, error: "잘못된 입력" };
    await coordinator().run(async () => failed, "deposit", "key-1");
    expect(coordinator().blocked).toBe(false); expect(text(controller())).toContain("잘못된 입력");
    const task = vi.fn().mockRejectedValue(new Error("SYNTHETIC_LOST_RESPONSE"));
    expect((await coordinator().run(task, "deposit", "key-1")).status).toBe("result-unknown");
    expect(text(controller())).toContain("결과 불명확"); expect(task).toHaveBeenCalledTimes(1);
    const other = vi.fn(); await coordinator().run(other, "return", "key-2"); expect(other).not.toHaveBeenCalled();
    await coordinator().run(async () => ({ status: "failure", code: "not-found" }), "deposit", "key-1");
    expect(coordinator().blocked).toBe(true); expect(text(controller())).toContain("명시적으로 재시도");
    await coordinator().run(async () => success, "deposit", "key-1"); expect(coordinator().blocked).toBe(false);
  });
  it("bounds an unavailable authoritative read instead of leaving the workflow busy forever", async () => {
    vi.useFakeTimers(); const pending = awaitWorkflowRead(() => new Promise(() => {}), 20);
    const assertion = expect(pending).rejects.toThrow("WORKFLOW_READ_TIMEOUT"); await vi.advanceTimersByTimeAsync(20); await assertion;
  });
  it("freezes a timed-out attempt even when the original request may still commit", async () => {
    vi.useFakeTimers(); const request = vi.fn(() => new Promise<WorkflowActionResult>(() => {}));
    const pending = awaitWorkflowResult(request, 20); await vi.advanceTimersByTimeAsync(20);
    expect((await pending).status).toBe("result-unknown"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("an RSC projection arriving during save is followed by automatic authoritative read", async () => {
    let finish!: (value: WorkflowActionResult) => void;
    const request = coordinator().run(() => new Promise((resolve) => { finish = resolve; }), "deposit", "key-1");
    const changed = { ...initial }; controller(changed); hooks.effects.pop()!();
    finish(success); await request;
    expect((controller(changed).props.value as WorkflowCoordinator).blocked).toBe(false);
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("prevents concurrent clicks and invalidates currentness after new server props arrive", async () => {
    let finish!: (value: WorkflowActionResult) => void;
    const pending = coordinator().run(() => new Promise((resolve) => { finish = resolve; }), "deposit", "key-1");
    const other = vi.fn(); await coordinator().run(other, "deposit", "key-1"); expect(other).not.toHaveBeenCalled();
    finish(success); await pending;
    const changed = { ...initial };
    expect((controller(changed).props.value as WorkflowCoordinator).blocked).toBe(true);
    hooks.effects.pop()!(); await flush();
    expect((controller(changed).props.value as WorkflowCoordinator).blocked).toBe(false);
  });
});

describe("bank attempt identity and recovery", () => {
  it("issues a key only on explicit start, preserves it across validation/save failure, and rotates only on new start", async () => {
    expect(getKey(bank())).toBe(""); await button(bank(), "새 입금 거래 시작").props.onClick!();
    const key = getKey(bank()); expect(key).toMatch(/^[a-f0-9-]{36}$/);
    const form = attachForm(bank(), { ...values(), amount: "0" }); await submit(bank());
    expect(mocks.lookup).not.toHaveBeenCalled(); expect(getKey(bank())).toBe(key);
    form.values.amount = "30000"; mocks.deposit.mockResolvedValueOnce({ status: "failure", error: "검증 거절" }); await submit(bank());
    expect(getKey(bank())).toBe(key); expect(form.reset).not.toHaveBeenCalled(); expect(form.values.payerName).toBe("실제 합성 입금자");
    expect(elements(bank()).find((row) => row.props.name === "amount")!.props.readOnly).toBe(false);
    await submit(bank()); expect(mocks.deposit.mock.calls[1]![0].get("idempotencyKey")).toBe(key);
    expect(getKey(bank())).toBe(key); await button(bank(), "새 입금 거래 시작").props.onClick!(); expect(getKey(bank())).not.toBe(key);
  });
  it("freezes dispatched bank fields through delayed response loss and recovers the original payload", async () => {
    await button(bank(), "새 입금 거래 시작").props.onClick!();
    const key = getKey(bank()); attachForm(bank());
    let finish!: (result: WorkflowActionResult) => void;
    mocks.deposit.mockImplementationOnce(() => new Promise<WorkflowActionResult>((resolve) => { finish = resolve; }));
    await submit(bank());
    for (const name of ["amount", "payerName", "depositedAt"]) {
      expect(elements(bank()).find((row) => row.props.name === name)!.props.readOnly).toBe(true);
    }
    const original = mocks.deposit.mock.calls[0]![0] as FormData;
    expect(original.get("amount")).toBe("30000"); expect(getKey(bank())).toBe(key);
    finish({ status: "result-unknown" }); await flush();
    expect(elements(bank()).find((row) => row.props.name === "amount")!.props.readOnly).toBe(true);
    mocks.lookup.mockResolvedValueOnce(success);
    await button(bank(), "저장 결과 조회").props.onClick!(); await flush();
    expect(mocks.lookup).toHaveBeenLastCalledWith("deposit", "s1", key, original);
    expect(mocks.deposit).toHaveBeenCalledTimes(1); expect(getKey(bank())).toBe(key);
  });
  it("keeps bank fields read-only while the saved receipt awaits authoritative refresh", async () => {
    let finish!: (verified: boolean) => void;
    const verify = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const draw = () => bank("bank", { verify });
    await button(draw(), "새 입금 거래 시작").props.onClick!(); attachForm(draw()); await submit(draw());
    expect(verify).toHaveBeenCalledWith(success);
    expect(elements(draw()).find((row) => row.props.name === "amount")!.props.readOnly).toBe(true);
    finish(false); await flush();
    expect(elements(draw()).find((row) => row.props.name === "amount")!.props.readOnly).toBe(true);
    expect(text(draw())).toContain("갱신 실패");
  });
  it("preserves editable bank values under a shared pending lock, including return fields", async () => {
    hooks.context = { submissionId: "s1", blocked: false, busy: true };
    for (const kind of ["deposit", "return"] as const) {
      const tree = bank(kind, { kind });
      for (const name of kind === "deposit" ? ["amount", "payerName", "depositedAt"] : ["amount", "reason", "returnedAt"]) {
        expect(elements(tree).find((row) => row.props.name === name)!.props.readOnly).toBe(true);
      }
    }
  });
  it("freezes original payload after response loss; recovery looks up before same-key explicit retry", async () => {
    await button(bank(), "새 입금 거래 시작").props.onClick!(); const key = getKey(bank()); attachForm(bank());
    mocks.deposit.mockRejectedValueOnce(new TypeError("SYNTHETIC_NETWORK_LOSS")); await submit(bank());
    expect(elements(bank()).filter((row) => row.props.name === "amount")[0]!.props.readOnly).toBe(true);
    expect(text(bank())).not.toContain("새 입금 거래 시작"); expect(getKey(bank())).toBe(key);
    await button(bank(), "저장 결과 조회").props.onClick!(); await flush(); expect(mocks.deposit).toHaveBeenCalledTimes(1);
    await button(bank(), "동일 거래 식별자로 다시 기록").props.onClick!(); await flush();
    expect(mocks.deposit).toHaveBeenCalledTimes(2); expect(mocks.deposit.mock.calls[0]![0]).toBe(mocks.deposit.mock.calls[1]![0]);
  });
  it("recovers a transaction from another browser using its original key and payload, without saving", async () => {
    const tree = bank(); const recover = elements(tree).find((row) => row.props.onChange)!;
    recover.props.onChange!({ target: { value: "existing-other-browser-key" } });
    await button(bank(), "기존 거래 조회 준비").props.onClick!(); attachForm(bank()); mocks.lookup.mockResolvedValue(success);
    await button(bank(), "저장 결과 조회").props.onClick!(); await flush();
    expect(mocks.lookup).toHaveBeenCalledWith("deposit", "s1", "existing-other-browser-key", expect.any(FormData)); expect(mocks.deposit).not.toHaveBeenCalled();
  });
  it("retains key and locks a saved return after refresh failure; receipt re-read can recover", async () => {
    const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const options = { verify }; const draw = () => bank("bank", options);
    await button(draw(), "새 입금 거래 시작").props.onClick!(); attachForm(draw()); await submit(draw());
    const key = getKey(draw()); expect(text(draw())).toContain("갱신 실패"); expect(button(draw(), "새 입금 거래 시작").props.disabled).toBe(true);
    mocks.lookup.mockResolvedValue(success); await button(draw(), "저장 결과 조회").props.onClick!(); await flush();
    expect(getKey(draw())).toBe(key); expect(mocks.deposit).toHaveBeenCalledTimes(1); expect(button(draw(), "새 입금 거래 시작").props.disabled).toBe(false);
  });
});

function resolution(applicationId: string, kind: "REJECTED" | "CANCELLED" = "REJECTED") {
  return render(applicationId + kind, () => {
    const wrapper = ApplicationResolveForm({ applicationId, kind, childName: applicationId, familyWorkflow: true });
    return (wrapper.type as (props: unknown) => React.ReactElement)(wrapper.props);
  });
}
describe("independent child resolution drafts", () => {
  it("freezes a dispatched reason through response loss and recovers with the original child/action reason", async () => {
    const run = vi.fn(async (task: () => Promise<WorkflowActionResult>) => task());
    const workflow = { submissionId: "s1", blocked: false, busy: false, run }; hooks.context = workflow;
    const reasonField = (id: string, kind: "REJECTED" | "CANCELLED" = "REJECTED") => elements(resolution(id, kind)).find((row) => row.props.onChange)!;
    reasonField("a1").props.onChange!({ target: { value: "원래 반려 사유" } });
    reasonField("a2").props.onChange!({ target: { value: "형제 초안" } });
    reasonField("a1", "CANCELLED").props.onChange!({ target: { value: "취소 초안" } });
    const staleChange = reasonField("a1").props.onChange!;
    let finish!: (result: WorkflowActionResult) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise<WorkflowActionResult>((resolve) => { finish = resolve; }));
    await submit(resolution("a1"));
    expect(reasonField("a1").props.readOnly).toBe(true);
    staleChange({ target: { value: "전송 후 다른 사유" } });
    expect(reasonField("a1").props.value).toBe("원래 반려 사유");
    workflow.busy = true;
    expect(reasonField("a2").props.readOnly).toBe(true); expect(reasonField("a2").props.value).toBe("형제 초안");
    expect(reasonField("a1", "CANCELLED").props.readOnly).toBe(true); expect(reasonField("a1", "CANCELLED").props.value).toBe("취소 초안");
    workflow.busy = false;
    finish({ status: "result-unknown" }); await flush();
    expect(reasonField("a1").props.readOnly).toBe(true);
    mocks.refresh.mockResolvedValue({ ...initial, applications: [{ id: "a1", status: "REJECTED", resolutionNote: "원래 반려 사유" }] });
    await button(resolution("a1"), "처리 결과 조회").props.onClick!(); await flush();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect((mocks.resolve.mock.calls[0]![2] as FormData).get("resolutionNote")).toBe("원래 반려 사유");
    expect(text(resolution("a1"))).not.toContain("처리 결과 조회");
    expect(reasonField("a2").props.value).toBe("형제 초안"); expect(reasonField("a1", "CANCELLED").props.value).toBe("취소 초안");
  });
  it("requires separate reasons and preserves both siblings and action drafts on failure", async () => {
    hooks.context = { submissionId: "s1", blocked: false, busy: false, run: vi.fn().mockResolvedValue({ status: "failure", error: "처리 거절" }) };
    await submit(resolution("a1")); expect((hooks.context as WorkflowCoordinator).run).not.toHaveBeenCalled();
    const edit = (id: string, kind: "REJECTED" | "CANCELLED", note: string) => elements(resolution(id, kind)).find((row) => row.props.onChange)!.props.onChange!({ target: { value: note } });
    edit("a1", "REJECTED", "첫째 반려 초안"); edit("a2", "REJECTED", "둘째 반려 초안"); edit("a1", "CANCELLED", "보호자 취소 초안");
    await submit(resolution("a1"));
    expect(elements(resolution("a1")).find((row) => row.props.onChange)!.props.value).toBe("첫째 반려 초안");
    expect(elements(resolution("a2")).find((row) => row.props.onChange)!.props.value).toBe("둘째 반려 초안");
    expect(elements(resolution("a1", "CANCELLED")).find((row) => row.props.onChange)!.props.value).toBe("보호자 취소 초안");
    const editable = elements(resolution("a1")).find((row) => row.props.onChange)!;
    expect(editable.props.readOnly).toBe(false); editable.props.onChange!({ target: { value: "거절 후 수정 사유" } });
    expect(elements(resolution("a1")).find((row) => row.props.onChange)!.props.value).toBe("거절 후 수정 사유");
  });
  it("recovers resolution without a transport receipt using the known family id", async () => {
    const run = vi.fn(async (task: () => Promise<WorkflowActionResult>) => task()); hooks.context = { submissionId: "s1", blocked: false, busy: false, run };
    mocks.resolve.mockResolvedValue({ status: "result-unknown" });
    elements(resolution("a1")).find((row) => row.props.onChange)!.props.onChange!({ target: { value: "필수 사유" } }); await submit(resolution("a1"));
    mocks.refresh.mockResolvedValue({ ...initial, applications: [{ id: "a1", status: "REJECTED", resolutionNote: "필수 사유" }] });
    await button(resolution("a1"), "처리 결과 조회").props.onClick!(); await flush();
    expect(mocks.refresh).toHaveBeenCalledWith("s1"); expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("a whole-workbench unknown return freezes every other obligation", async () => {
    const draw = () => render("workbench", () => ApplicationReturnsWorkbench({ initialObligations: [] }));
    const gate = () => draw().props.value as WorkflowCoordinator;
    await gate().run(async () => ({ status: "result-unknown" }), "return", "return:one:key");
    const other = vi.fn(); await gate().run(other, "return", "return:two:key"); expect(other).not.toHaveBeenCalled(); expect(gate().blocked).toBe(true);
    mocks.returns.mockResolvedValue([{ ledgerVerified: true, submissionId: "s1", returns: [{ id: "return-1" }] }]);
    await gate().run(async () => ({ status: "success", submissionId: "s1", receiptId: "return-1" }), "return", "return:one:key");
    expect(gate().blocked).toBe(false);
  });
});

function confirmedDetail(): ApplicationWorkflowDetail {
  return { ...initial, applications: [{ id: "a1", status: "CONFIRMED", childName: "합성 아이", quotedAmount: 40000, reservation: { id: "r1", paymentItem: { id: "pi1", paymentId: "p1" } }, paymentMapping: { id: "m1", paymentItem: { id: "pi1", paymentId: "p1", paidAmount: 40000 } } }] } as unknown as ApplicationWorkflowDetail;
}
describe("confirmation read-after-write and uncertain outcome coordination", () => {
  it("verifies actual matching Reservation/PaymentItem/Mapping rather than action success alone", async () => {
    const result: WorkflowActionResult = { status: "success", submissionId: "s1", applicationIds: ["a1"], reservationIds: ["r1"], paymentId: "p1" };
    expect(workflowReceiptPresent(confirmedDetail(), result, "confirmation")).toBe(true);
    const wrong = confirmedDetail(); wrong.applications[0]!.paymentMapping!.paymentItem.id = "another-item";
    expect(workflowReceiptPresent(wrong, result, "confirmation")).toBe(false);
    mocks.refresh.mockResolvedValue(confirmedDetail()); expect((await coordinator().run(async () => result, "confirmation", "confirmation-1")).verified).toBe(true); expect(coordinator().blocked).toBe(false);
  });
  it("known committed confirmation with failed authoritative refresh retains a distinct blocked refresh-failure", async () => {
    const result: WorkflowActionResult = { status: "success", submissionId: "s1", applicationIds: ["a1"], reservationIds: ["r1"], paymentId: "p1" };
    mocks.refresh.mockResolvedValue(null); expect((await coordinator().run(async () => result, "confirmation", "confirmation-1")).verified).toBe(false);
    expect(coordinator().blocked).toBe(true); expect(text(controller())).toContain("갱신 실패");
    mocks.refresh.mockResolvedValue(confirmedDetail()); await button(controller(), "최신 서버 상태 다시 조회").props.onClick!(); expect(coordinator().blocked).toBe(false);
  });
  it("lost confirmation response remains unknown while original request might run, then recovers solely by matching links", async () => {
    const task = vi.fn().mockResolvedValue({ status: "result-unknown" });
    await coordinator().run(task, "confirmation", "confirmation-1", { submissionId: "s1", applicationIds: ["a1"] });
    mocks.refresh.mockResolvedValue(initial); await button(controller(), "최신 서버 상태 다시 조회").props.onClick!(); expect(coordinator().blocked).toBe(true); expect(text(controller())).toContain("원래 요청이 완료될 수 있으므로 재확정하지 말고");
    const other = vi.fn(); await coordinator().run(other, "deposit", "another-attempt"); expect(other).not.toHaveBeenCalled();
    mocks.refresh.mockResolvedValue(confirmedDetail()); await button(controller(), "최신 서버 상태 다시 조회").props.onClick!(); expect(coordinator().blocked).toBe(false); expect(task).toHaveBeenCalledTimes(1);
  });
});
