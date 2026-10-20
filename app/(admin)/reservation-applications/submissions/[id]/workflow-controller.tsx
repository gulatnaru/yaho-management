"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";
import type { ApplicationSearchParams } from "@/lib/reservation-applications/navigation";
import { familyReturnHref } from "@/lib/reservation-applications/navigation";
import { formatKstDateTime, formatKstDateTimeRange } from "@/lib/classes/datetime";
import { APPLICATION_STATUS_LABEL, GUARDIAN_RELATIONSHIP_LABEL } from "@/lib/reservation-applications/constants";
import { refreshApplicationWorkflow, type WorkflowActionResult } from "../../actions";
import { ApplicationReviewCard, ApplicationRelatedRecords } from "../../_components/application-review-card";
import { ApplicationReviewFocus } from "../../_components/application-review-focus";
import { ApplicationResolveForm } from "../../_components/application-resolve-form";
import { ApplicationReturnCard } from "../../_components/application-return-card";
import { LedgerSummary } from "../../_components/ledger-summary";
import { DepositForm } from "./deposit-form";
import { SubmissionConfirmationForm } from "./confirmation-form";

/** A deadline only freezes the attempt; the underlying request can still commit.
 * Recovery must query the same identity before an explicit same-key replay. */
export async function awaitWorkflowResult(task: () => Promise<WorkflowActionResult>, timeoutMs = 25000): Promise<WorkflowActionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task(), new Promise<WorkflowActionResult>((resolve) => {
      timer = setTimeout(() => resolve({ status: "result-unknown", error: "응답 확인 시간이 초과되었습니다. 기존 거래의 저장 결과를 먼저 조회해주세요." }), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
export async function awaitWorkflowRead<T>(task: () => Promise<T>, timeoutMs = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("WORKFLOW_READ_TIMEOUT")), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
export type WorkflowOperation = "deposit" | "return" | "REJECTED" | "CANCELLED" | "confirmation";
export function workflowReceiptPresent(detail: ApplicationWorkflowDetail, result: WorkflowActionResult, operation: WorkflowOperation) {
  if (result.submissionId !== detail.id) return false;
  if (operation === "confirmation") return Boolean(result.applicationIds?.length) && result.applicationIds!.every((id) => {
    const row = detail.applications.find((item) => item.id === id);
    return row?.status === "CONFIRMED" && row.reservation && row.paymentMapping && row.reservation.paymentItem
      && row.paymentMapping.paymentItem.id === row.reservation.paymentItem.id
      && row.paymentMapping.paymentItem.paymentId === row.reservation.paymentItem.paymentId
      && row.paymentMapping.paymentItem.paidAmount === row.quotedAmount
      && (!result.reservationIds || result.reservationIds.includes(row.reservation.id))
      && (!result.paymentId || row.reservation.paymentItem.paymentId === result.paymentId);
  });
  if (!result.receiptId) return false;
  if (operation === "deposit") return detail.deposits.some((row) => row.id === result.receiptId);
  if (operation === "return") return detail.returnObligations.some((row) => row.returns.some((record) => record.id === result.receiptId));
  return detail.applications.some((row) => row.id === result.receiptId && row.status === operation);
}
export type WorkflowCoordinator = {
  submissionId: string;
  busy: boolean;
  blocked: boolean;
  run: (task: () => Promise<WorkflowActionResult>, operation: WorkflowOperation, attemptId: string, confirmation?: Pick<WorkflowActionResult, "submissionId" | "applicationIds">) => Promise<WorkflowActionResult>;
};
export const WorkflowContext = createContext<WorkflowCoordinator | null>(null);
export function useWorkflowCoordinator() { return useContext(WorkflowContext); }

export function WorkflowController({ initialDetail, context }: { initialDetail: ApplicationWorkflowDetail; context: ApplicationSearchParams }) {
  const [detail, setDetail] = useState(initialDetail);
  const [freshness, setFreshness] = useState<"current" | "failure" | "pending" | "result-unknown" | "refresh-failure">("current");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const verifiedInitial = useRef(initialDetail);
  const latestInitial = useRef(initialDetail);
  latestInitial.current = initialDetail;
  const unresolved = useRef<string | null>(null);
  const confirmationAttempt = useRef<WorkflowActionResult | null>(null);
  const expected = useRef<{ result: WorkflowActionResult; operation: WorkflowOperation } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await awaitWorkflowRead(() => refreshApplicationWorkflow(latestInitial.current.id));
      if (unresolved.current && confirmationAttempt.current && next && next.ledger.state === "available") {
        if (workflowReceiptPresent(next, confirmationAttempt.current, "confirmation")) {
          unresolved.current = null; confirmationAttempt.current = null;
        } else {
          setFreshness("result-unknown");
          setMessage("예약 확정 결과가 아직 확인되지 않았습니다. 진행 중인 원래 요청이 완료될 수 있으므로 재확정하지 말고 실제 예약·결제 연결을 다시 조회해주세요.");
          return false;
        }
      }
      if (unresolved.current || !next || next.ledger.state !== "available" || (expected.current && !workflowReceiptPresent(next, expected.current.result, expected.current.operation))) throw new Error("unverified");
      verifiedInitial.current = latestInitial.current; setDetail(next); setFreshness("current"); expected.current = null;
      return true;
    } catch { setFreshness("refresh-failure"); return false; }
  }, []);
  useEffect(() => {
    if (verifiedInitial.current === initialDetail || active.current) return;
    active.current = true; setBusy(true); setFreshness("pending");
    void refresh().finally(() => { active.current = false; setBusy(false); });
  }, [initialDetail, refresh]);
  const run: WorkflowCoordinator["run"] = async (task, operation, attemptId, confirmation) => {
    if (unresolved.current && unresolved.current !== attemptId) return { status: "failure", error: "불명확한 원래 거래 결과를 먼저 확인해주세요." };
    if (active.current) return { status: "failure", error: "다른 처리를 확인 중입니다." };
    active.current = true; setBusy(true); setFreshness("pending");
    try {
      if (operation === "confirmation") confirmationAttempt.current = confirmation ? { ...confirmation, status: "result-unknown" } : null;
      const result = { ...confirmation, ...await awaitWorkflowResult(task) };
      if (operation === "confirmation" && result.status === "result-unknown") confirmationAttempt.current = result;
      if (result.status === "result-unknown") { unresolved.current = attemptId; setFreshness("result-unknown"); setMessage(result.error ?? "결과 불명확 · 저장 결과를 조회해주세요."); return result; }
      if (result.status === "success") { unresolved.current = null; confirmationAttempt.current = null; expected.current = { result, operation }; }
      if (result.code === "not-found" && unresolved.current) {
        setFreshness("result-unknown"); setMessage("저장 기록을 아직 찾지 못했습니다. 원래 거래 식별자와 입력으로 명시적으로 재시도할 수 있습니다.");
        return result;
      }
      const verified = await refresh();
      if (verified && result.status === "failure") setFreshness("failure");
      setMessage(!verified ? "갱신 실패 · 저장 여부와 최신 원장을 확인할 때까지 후속 처리를 차단합니다." : result.status === "success" ? "저장 결과와 최신 서버 원장을 확인했습니다." : result.error ?? "처리 실패 · 입력을 확인해주세요.");
      return { ...result, verified };
    } catch {
      unresolved.current = attemptId; setFreshness("result-unknown"); setMessage("결과 불명확 · 금융 요청을 반복하지 말고 저장 결과를 조회해주세요.");
      return { status: "result-unknown", error: "결과 불명확 · 저장 결과를 먼저 조회해주세요." };
    } finally {
      // An RSC refresh can arrive during the save/read chain. It cannot leave the
      // preserved confirmation form attached to an older current projection.
      if (verifiedInitial.current !== latestInitial.current && !unresolved.current) await refresh();
      active.current = false; setBusy(false);
    }
  };
  const pending = detail.applications.filter((row) => row.status === "SUBMITTED" && !row.isPurged && row.childName && row.childBirthDate);
  const current = (freshness === "current" || freshness === "failure") && detail.ledger.state === "available" && verifiedInitial.current === initialDetail;
  return <WorkflowContext.Provider value={{ submissionId: detail.id, busy, blocked: !current, run }}><section className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <header className="space-y-3 rounded-lg border bg-white p-4" data-testid="family-detail-summary"><h1 className="text-2xl font-bold">가족 신청 상세</h1><h2 className="text-xl font-semibold">{detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianName ?? "개인정보 파기됨"}</h2><p className="text-sm">제출 ID {detail.id} · 접수 {formatKstDateTime(detail.submittedAt)} · 아이 {detail.applications.length}명</p><p className="font-medium">다음 할 일: {current ? detail.ledger.state === "available" && detail.ledger.R > 0 ? "반환 내역을 확인해주세요." : "신청을 검토하고 실제 은행 거래를 기록해주세요." : "최신 서버 상태를 다시 확인해주세요."}</p><p className="text-sm">보호자 신고 입금자명: {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.declaredPayerName ?? "기록 없음"} · 입금 알림: {detail.depositNotifiedAt ? formatKstDateTime(detail.depositNotifiedAt) : "없음"}</p><p className="text-sm">보호자 연락처: {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianPhone ?? "기록 없음"} · 관계: {detail.personalDataPurgedAt ? "개인정보 파기됨" : detail.guardianRelationship ? GUARDIAN_RELATIONSHIP_LABEL[detail.guardianRelationship] : "기록 없음"}</p><p className="text-sm">{current ? "서버에서 확인한 상태" : "이전 조회 상태 · 최신 여부 미확인"}: {Object.entries(APPLICATION_STATUS_LABEL).map(([status, label]) => `${label} ${detail.applications.filter((row) => row.status === status).length}명`).join(" · ")}</p></header>
    <div role={freshness === "refresh-failure" || freshness === "result-unknown" || freshness === "failure" ? "alert" : "status"} aria-live="polite" data-testid="workflow-status" className="space-y-2 rounded border p-3"><p>{freshness === "pending" ? "저장·서버 원장 확인 중…" : freshness === "result-unknown" ? "결과 불명확" : freshness === "refresh-failure" ? "갱신 실패" : freshness === "failure" ? "처리 실패 · 서버 원장 확인됨" : current ? "서버 원장 확인됨" : "원장 검증 필요"}</p>{message ? <p>{message}</p> : null}{!current ? <><p>이전 금액·처리 상태는 최신 값으로 사용할 수 없습니다. 후속 처리와 예약 확정이 차단됩니다.</p><button className="min-h-11 rounded border px-3" disabled={busy} type="button" onClick={async () => { if (active.current) return; active.current = true; setBusy(true); const ok = await refresh(); if (ok) setMessage("최신 서버 상태를 다시 확인했습니다."); else if (!confirmationAttempt.current) setMessage("갱신 실패 · 다시 확인해주세요."); active.current = false; setBusy(false); }}>최신 서버 상태 다시 조회</button></> : null}</div>
    {detail.invalidApplicationFocus ? <p role="status">요청한 아이 위치를 확인할 수 없어 이 가족의 전체 신청을 표시합니다.</p> : null}<ApplicationReviewFocus applicationId={detail.focusedApplicationId} />
    <section className="space-y-4" data-testid="family-review" aria-labelledby="review-title"><h2 id="review-title" className="text-xl font-semibold">1. 신청·동의·아이 연결 검토</h2><nav aria-label="아이별 신청 검토 이동" className="flex flex-wrap gap-2">{detail.applications.map((item) => <a key={item.id} className="inline-flex min-h-11 items-center rounded border px-3 underline" href={`#application-${item.id}`}>{item.childName ?? "개인정보 파기됨"}</a>)}</nav>{detail.applications.map((item) => <div key={item.id} className="space-y-3"><ApplicationReviewCard application={item} context={context} />{item.status === "SUBMITTED" && !item.isPurged ? <fieldset className="grid min-w-0 gap-4 rounded border p-4 md:grid-cols-2"><legend className="px-2">{item.childName} 신청 처리</legend><ApplicationResolveForm applicationId={item.id} childName={item.childName ?? "아이"} kind="REJECTED" familyWorkflow /><ApplicationResolveForm applicationId={item.id} childName={item.childName ?? "아이"} kind="CANCELLED" familyWorkflow /></fieldset> : null}</div>)}</section>
    <section className="space-y-4" aria-labelledby="ledger-title" data-testid="family-ledger"><h2 id="ledger-title" className="text-xl font-semibold">2. 실제 입금·반환 원장</h2>{current ? <LedgerSummary detail={detail} showReturns={false} /> : <p data-testid="detail-ledger" role="alert">최신 원장 금액을 표시할 수 없습니다. 이전 잔액을 현재 잔액으로 사용하지 마세요.</p>}<div className="space-y-3 rounded border p-4"><h3 className="font-semibold">실제 은행 입금</h3><p className="text-sm">신고 입금자명과 은행의 실제 입금자명이 달라도 자동 반려·취소·확정되지 않습니다.</p><DepositForm submissionId={detail.id} /></div>{detail.returnObligations.map((item) => <ApplicationReturnCard key={item.id} initialObligation={item} verified={current} purged={Boolean(detail.personalDataPurgedAt)} />)}</section>
    {pending.length ? <section className="space-y-3" aria-labelledby="confirmation-title" data-testid="family-confirmation"><h2 id="confirmation-title" className="text-xl font-semibold">3. 선택 일괄 확정</h2><fieldset disabled={!current || busy} className="min-w-0"><SubmissionConfirmationForm submissionId={detail.id} availableAmount={detail.ledger.state === "available" ? detail.ledger.A : null} applications={pending.map((row) => ({ id: row.id, childName: row.childName, quotedAmount: row.quotedAmount, candidates: row.confirmationCandidates, classLabel: `${row.classSchedule.program.name} · ${formatKstDateTimeRange(row.classSchedule.startsAt, row.classSchedule.endsAt)}`, classRevision: JSON.stringify([row.classScheduleId, row.classSchedule.status, row.classSchedule.startsAt, row.classSchedule.endsAt, row.classSchedule.capacity, row.classSchedule._count?.reservations]) }))} /></fieldset>{!current ? <p role="alert">최신 서버 원장을 다시 확인한 뒤 예약을 확정할 수 있습니다.</p> : null}</section> : null}
    <ApplicationRelatedRecords applications={detail.applications} /><footer className="flex flex-col gap-2 text-sm"><Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/returns">전체 반환 대상 보기</Link><Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/retention">개인정보 보관·파기 관리</Link><Link className="inline-flex min-h-11 items-center underline" href={familyReturnHref("submission", detail.id, context)}>신청 목록으로</Link></footer>
  </section></WorkflowContext.Provider>;
}
