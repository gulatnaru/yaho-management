import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";

// This drives real component handlers with isolated hook slots, not a DOM/browser.
// The S5B oracle deliberately remains red if absence is presented as save failure.
const hooks = vi.hoisted(() => ({ slots: new Map<string, unknown[]>(), name: "", cursor: 0, context: null as unknown }));
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), lookup: vi.fn(), deposit: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slots = hooks.slots.get(hooks.name)!; const index = hooks.cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const slots = hooks.slots.get(hooks.name)!; const index = hooks.cursor++;
    if (!(index in slots)) slots[index] = { current: initial }; return slots[index];
  },
  useContext: () => hooks.context, useCallback: (callback: unknown) => callback, useEffect: () => undefined,
}));
vi.mock("@/app/(admin)/reservation-applications/actions", () => ({
  refreshApplicationWorkflow: mocks.refresh, lookupWorkflowReceipt: mocks.lookup, recordApplicationDeposit: mocks.deposit,
  resolveApplicationWorkflow: vi.fn(), refreshApplicationReturns: vi.fn(), refreshApplicationReturn: vi.fn(),
}));
vi.mock("@/app/(admin)/reservation-applications/submissions/[id]/confirmation-form", () => ({ SubmissionConfirmationForm: () => null }));
vi.mock("@/app/(admin)/reservation-applications/_components/application-review-focus", () => ({ ApplicationReviewFocus: () => null }));
import { WorkflowController, type WorkflowCoordinator } from "@/app/(admin)/reservation-applications/submissions/[id]/workflow-controller";
import { BankTransactionForm } from "@/app/(admin)/reservation-applications/submissions/[id]/deposit-form";

type Props = { children?: React.ReactNode; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => unknown;
  "data-testid"?: string; role?: string; ref?: { current: unknown } };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return React.isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
}
function content(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(content).join("");
  return React.isValidElement<Props>(node) ? content(node.props.children) : "";
}
function render<T>(name: string, callback: () => T): T {
  hooks.name = name; hooks.cursor = 0;
  if (!hooks.slots.has(name)) hooks.slots.set(name, []);
  return callback();
}
let detail: ApplicationWorkflowDetail;
function draw() { return render("controller", () => WorkflowController({ initialDetail: detail, context: {} })); }
function coordinator() { return draw().props.value as WorkflowCoordinator; }
function bank() {
  hooks.context = coordinator();
  return render("bank", () => BankTransactionForm({ kind: "deposit", targetId: "c11-fresh-context", save: mocks.deposit }));
}
function button(tree: React.ReactNode, label: string) {
  const node = elements(tree).find((row) => row.props.onClick && content(row) === label);
  expect(node).toBeDefined(); return node!;
}
function status() { return elements(draw()).find((row) => row.props["data-testid"] === "workflow-status")!; }
const NativeFormData = globalThis.FormData;
class SyntheticFormData extends NativeFormData {
  constructor(form?: { values: Record<string, string> }) {
    super(); if (form) for (const [name, value] of Object.entries(form.values)) this.set(name, value);
  }
}
beforeEach(() => {
  vi.resetAllMocks(); hooks.slots.clear(); hooks.context = null;
  vi.stubGlobal("React", React); vi.stubGlobal("FormData", SyntheticFormData);
  detail = { id: "c11-fresh-context", submittedAt: new Date("2026-01-01"), guardianName: "Synthetic Guardian", personalDataPurgedAt: null,
    applications: [], deposits: [], returnObligations: [], ledger: { state: "available", Q: 100_000, D: 0, P: 0, A: 0, R: 0, T: 0 } } as unknown as ApplicationWorkflowDetail;
  mocks.refresh.mockResolvedValue(detail);
});
afterEach(() => vi.unstubAllGlobals());

describe("C11 S5B no false claim oracle and S4 follow-up blocking", () => {
  it("S5B fresh-context read-only missing receipt shows absence without claiming the original save failed or rolled back", async () => {
    // No prior save or unresolved attempt exists in this fresh controller.
    mocks.lookup.mockResolvedValue({ status: "failure", code: "not-found", error: "저장 기록이 없습니다. 같은 거래 식별자와 입력으로만 다시 시도하세요." });
    elements(bank()).find((row) => row.props.onChange)!.props.onChange!({ target: { value: "c11-original-unknown-key-0001" } });
    await button(bank(), "기존 거래 조회 준비").props.onClick!();
    elements(bank()).find((row) => row.type === "form")!.props.ref!.current = {
      values: { amount: "10000", payerName: "Synthetic Payer", depositedAt: "2026-01-01T09:30" },
    };
    await button(bank(), "저장 결과 조회").props.onClick!();
    for (let index = 0; index < 50; index++) await Promise.resolve();
    expect(mocks.lookup).toHaveBeenCalledWith("deposit", "c11-fresh-context", "c11-original-unknown-key-0001", expect.any(FormData));
    expect(mocks.deposit).not.toHaveBeenCalled(); expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(content(status())).toContain("저장 기록이 없습니다.");
    expect(content(status())).not.toMatch(/처리 실패|저장 실패|롤백/);
  });
  it.each(["missing", "exception"])("S4 duplicate rejection with %s follow-up read keeps the workflow blocked", async (mode) => {
    if (mode === "missing") mocks.refresh.mockResolvedValue(null);
    else mocks.refresh.mockRejectedValue(new Error("SYNTHETIC_REFRESH_FAILURE"));
    const reject = vi.fn().mockResolvedValue({ status: "failure", code: "suspected-duplicate-deposit", error: "일치 후보 1건: c11-original-deposit" });
    await coordinator().run(reject, "deposit", "c11-rejected-attempt");
    expect(coordinator().blocked).toBe(true); expect(coordinator().busy).toBe(false);
    expect(content(status())).toContain("갱신 실패"); expect(status().props.role).toBe("alert");
    expect(content(draw())).toContain("최신 원장 금액을 표시할 수 없습니다."); expect(reject).toHaveBeenCalledTimes(1);
    expect(mocks.deposit).not.toHaveBeenCalled();
  });
});
