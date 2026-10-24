"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatKstDateTime } from "@/lib/classes/datetime";
import type { ApplicationReturnView } from "@/lib/reservation-applications/return-queries";
import { refreshApplicationReturn, refreshApplicationReturns, type WorkflowActionResult } from "../actions";
import { ReturnForm } from "../returns/return-form";
import { awaitWorkflowRead, awaitWorkflowResult, WorkflowContext, useWorkflowCoordinator, type WorkflowCoordinator } from "../submissions/[id]/workflow-controller";

const labels = { REJECTED: "반려 신청 반환", CANCELLED: "취소 신청 반환", EXCESS: "초과 입금 반환" };
export function ApplicationReturnCard({ initialObligation, verified = true, purged = false }: { initialObligation: ApplicationReturnView; verified?: boolean; purged?: boolean }) {
  const workflow = useWorkflowCoordinator();
  const [local, setLocal] = useState(initialObligation);
  const [failed, setFailed] = useState(false);
  const item = workflow ? initialObligation : local;
  const valid = Number.isInteger(item.amount) && item.amount > 0 && Number.isInteger(item.returnedAmount) && item.returnedAmount >= 0 && item.returnedAmount <= item.amount && item.returns.reduce((sum, row) => sum + row.amount, 0) === item.returnedAmount;
  const current = verified && !failed && valid && Boolean(workflow || item.ledgerVerified) && Boolean(item.resolvedAt) === (item.returnedAmount === item.amount);
  const verify = async (result: WorkflowActionResult) => {
    try {
      const next = await awaitWorkflowRead(() => refreshApplicationReturn(item.id));
      if (!next || !next.ledgerVerified || next.submissionId !== result.submissionId || !next.returns.some((row) => row.id === result.receiptId)) throw new Error("unverified");
      setLocal(next); setFailed(false); return true;
    } catch { setFailed(true); return false; }
  };
  return <article id={`return-${item.id}`} tabIndex={-1} className="min-w-0 space-y-3 rounded border p-4 [overflow-wrap:anywhere]" data-testid={`return-obligation-${item.id}`}>
    <h3 className="font-semibold">{labels[item.kind]} · {item.id}</h3><p className="text-sm">대상 아이 신청: {item.applicationId ?? "가족 초과입금"}</p>
    {current ? <p>남은 반환 <span data-testid="return-obligation-remaining">{(item.amount - item.returnedAmount).toLocaleString("ko-KR")}원</span> · {item.resolvedAt ? "반환 완료" : "반환 처리 대기"}</p> : <p role="alert">갱신 실패 · 최신 반환 잔액을 표시할 수 없습니다.</p>}
    <Link href={`/reservation-applications/submissions/${item.submissionId}`} className="inline-flex min-h-11 items-center underline">가족 신청 상세</Link>
    <details className="rounded border p-3"><summary className="min-h-11 cursor-pointer py-2">반환 내역 펼치기 ({item.returns.length}건)</summary><ul className="space-y-3 text-sm">{item.returns.map((row) => <li key={row.id}>반환 기록 {row.id} · {row.amount.toLocaleString("ko-KR")}원 · 반환일시 {formatKstDateTime(row.returnedAt)} · 기록일시 {formatKstDateTime(row.createdAt)} · 사유 {purged ? "개인정보 파기됨" : row.reason ?? "기록 없음"} · 처리자 {row.processedBy.name ?? "기록 없음"}</li>)}</ul>{!item.returns.length ? <p>완료 반환 기록 없음</p> : null}</details>
    {/* Keep a saved form mounted after completion so its receipt/key remain available. */}
    <ReturnForm obligationId={item.id} remaining={item.amount - item.returnedAmount} amount={item.amount} returnedAmount={item.returnedAmount} disabled={!current || Boolean(item.resolvedAt)} verify={verify} />
  </article>;
}

/** The workbench shares a single dispatch/recovery gate across obligations. Rows still
 * use the same ReturnObligation/ApplicationReturn projection as the family view. */
export function ApplicationReturnsWorkbench({ initialObligations }: { initialObligations: ApplicationReturnView[] }) {
  const [items, setItems] = useState(initialObligations);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const unresolved = useRef<string | null>(null);
  const expected = useRef<WorkflowActionResult | null>(null);
  const refresh = async () => {
    try {
      const next = await awaitWorkflowRead(() => refreshApplicationReturns());
      const receipt = expected.current;
      if (unresolved.current || !next || (receipt && !next.some((row) => row.ledgerVerified && row.submissionId === receipt.submissionId && row.returns.some((record) => record.id === receipt.receiptId)))) throw new Error("unverified");
      setItems(next); setBlocked(false); expected.current = null; return true;
    } catch { setBlocked(true); return false; }
  };
  const run: WorkflowCoordinator["run"] = async (task, _operation, attemptId) => {
    if (active.current || (unresolved.current && unresolved.current !== attemptId)) return { status: "failure", error: "확인 중인 기존 거래 결과를 먼저 조회해주세요." };
    active.current = true; setBusy(true); setBlocked(true);
    try {
      const result = await awaitWorkflowResult(task);
      if (result.status === "result-unknown") { unresolved.current = attemptId; setMessage("결과 불명확 · 기존 거래의 저장 결과를 먼저 조회해주세요."); return result; }
      if (result.status === "success") { unresolved.current = null; expected.current = result; }
      if (unresolved.current) { setMessage("저장 기록을 아직 찾지 못했습니다. 원래 식별자와 입력으로만 명시적으로 재시도하세요."); return result; }
      setMessage(await refresh() ? result.status === "success" ? "저장 결과와 최신 서버 반환 원장을 확인했습니다." : result.error ?? "입력값을 확인해주세요." : "갱신 실패 · 후속 반환 기록을 차단합니다.");
      return result;
    } catch { unresolved.current = attemptId; setMessage("결과 불명확 · 기존 거래의 저장 결과를 먼저 조회해주세요."); return { status: "result-unknown", error: "저장 결과를 먼저 조회해주세요." }; }
    finally { active.current = false; setBusy(false); }
  };
  return <WorkflowContext.Provider value={{ submissionId: "", busy, blocked, run }}><div className="space-y-4">
    {message ? <p role={blocked ? "alert" : "status"} aria-live="polite">{message}</p> : null}
    {blocked && !unresolved.current ? <button className="min-h-11 rounded border px-3" type="button" disabled={busy} onClick={async () => {
      if (active.current) return; active.current = true; setBusy(true);
      try { setMessage(await refresh() ? "최신 서버 반환 원장을 확인했습니다." : "갱신 실패 · 다시 조회해주세요."); }
      finally { active.current = false; setBusy(false); }
    }}>최신 반환 원장 다시 조회</button> : null}
    {items.map((item) => <ApplicationReturnCard key={item.id} initialObligation={item} verified={!blocked && Boolean(item.ledgerVerified)} />)}
  </div></WorkflowContext.Provider>;
}
