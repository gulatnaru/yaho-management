"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { confirmApplicationSubmission, type SubmissionConfirmationActionResult } from "../../actions";
import { useWorkflowCoordinator } from "./workflow-controller";

type ApplicationChoice = { id: string; childName: string | null; quotedAmount: number | null; classLabel?: string; classRevision?: string; candidates: Array<{ id: string; label: string; isRequested: boolean }> };
type Binding = NonNullable<SubmissionConfirmationActionResult["overbookingConfirmation"]>;
/** Unknown quotes and unverified balances never become zero. Only current selectable IDs count. */
export function selectedConfirmationAmounts(applications: readonly ApplicationChoice[], selected: Record<string, boolean>, available: number | null) {
  const targets = applications.filter((row) => selected[row.id]);
  const valid = targets.every((row) => row.quotedAmount !== null && Number.isSafeInteger(row.quotedAmount) && row.quotedAmount > 0);
  const total = valid ? targets.reduce((sum, row) => sum + row.quotedAmount!, 0) : null;
  return { count: targets.length, total, available, shortfall: total !== null && available !== null ? Math.max(0, total - available) : null };
}
export function SubmissionConfirmationForm({ submissionId, applications, availableAmount = null }: { submissionId: string; applications: ApplicationChoice[]; availableAmount?: number | null }) {
  const workflow = useWorkflowCoordinator();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [state, setState] = useState<SubmissionConfirmationActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const dispatched = useRef(false);
  const latest = JSON.stringify([availableAmount, applications.map((row) => [row.id, row.quotedAmount, row.classRevision, row.candidates.map((child) => child.id)])]);
  const reviewed = useRef(latest);
  useEffect(() => {
    if (reviewed.current === latest) return;
    reviewed.current = latest;
    setBindings({}); setState(null);
    if (applications.some((row) => selected[row.id])) setReviewRequired(true);
  }, [latest, applications, selected]);
  const targets = applications.filter((row) => selected[row.id]);
  // Keep the authoritative projection fingerprint stable during a pending read.
  // Its balance is hidden while blocked; transient loading is not a changed ledger.
  const spendableAmount = workflow?.blocked ? null : availableAmount;
  const amounts = selectedConfirmationAmounts(applications, selected, spendableAmount);
  const selectionFingerprint = JSON.stringify(targets.map((row) => [row.id, choices[row.id]]).sort(([left], [right]) => left.localeCompare(right)));
  const explicitChoices = targets.every((row) => choices[row.id] === "NEW" || row.candidates.some((candidate) => candidate.id === choices[row.id]));
  const frozen = pending || Boolean(workflow?.busy || workflow?.blocked) || state?.status === "result-unknown";
  const ready = !frozen && !reviewRequired && amounts.count > 0 && amounts.shortfall === 0 && explicitChoices;
  const warning = state?.overbookingConfirmation && state.overbookingConfirmation.selectionFingerprint === selectionFingerprint && choices[state.overbookingConfirmation.applicationId] === state.overbookingConfirmation.childChoice ? state.overbookingConfirmation : undefined;
  const warningTarget = applications.find((row) => row.id === warning?.applicationId);
  const payload = useMemo(() => ({ submissionId, choices: applications.filter((row) => selected[row.id]).map((row) => ({ applicationId: row.id, ...(choices[row.id] === "NEW" ? { newChild: true } : { childId: choices[row.id] }), memo: memos[row.id] ?? "", ...(bindings[row.id] ? { confirmOverbooking: true, overbookingConfirmation: bindings[row.id] } : {}) })) }), [applications, bindings, choices, memos, selected, submissionId]);
  const resetApproval = () => { setBindings({}); setState(null); };
  async function submit(approved?: Binding) {
    if (!ready || dispatched.current || !workflow) return;
    dispatched.current = true; setPending(true);
    const sent = approved ? { ...payload, choices: payload.choices.map((choice) => choice.applicationId === approved.applicationId ? { ...choice, confirmOverbooking: true, overbookingConfirmation: approved } : choice) } : payload;
    if (approved) setBindings((current) => ({ ...current, [approved.applicationId]: approved }));
    const form = new FormData(); form.set("payload", JSON.stringify(sent));
    let response: SubmissionConfirmationActionResult | undefined;
    const result = await workflow.run(async () => { response = await confirmApplicationSubmission(form); return response; }, "confirmation", `confirmation:${submissionId}:${crypto.randomUUID()}`, { submissionId, applicationIds: sent.choices.map((row) => row.applicationId) });
    setState(response && result.status !== "result-unknown" ? response : result);
    // Committed children disappear only when the coordinator verifies mappings and ledger.
    // A transport loss never submits again; the controller's read button reconciles it.
    if (result.status === "success" && result.verified !== false) setSelected((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !sent.choices.some((row) => row.applicationId === id))));
    dispatched.current = false; setPending(false);
  }
  const money = (value: number | null) => value === null ? "검증 필요" : `${value.toLocaleString("ko-KR")}원`;
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!warning) void submit(); }} data-testid="confirmation-selection-form">
    {applications.map((application) => <fieldset className="min-w-0 space-y-3 rounded border p-3" disabled={frozen} key={application.id} data-testid={`confirmation-${application.id}`}>
      <legend className="px-1">{application.childName ?? "아이"} · {application.classLabel}</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={selected[application.id] ?? false} onChange={(event) => { setSelected((current) => ({ ...current, [application.id]: event.target.checked })); resetApproval(); }} type="checkbox" />{application.childName ?? "아이"} 예약 확정 선택 · {money(application.quotedAmount)}</label>
      <label className="block space-y-1 text-sm"><span>{application.childName ?? "아이"} 확정 대상</span><Select aria-label={`${application.childName ?? "아이"} 확정 대상`} disabled={!selected[application.id]} onChange={(event) => { setChoices((current) => ({ ...current, [application.id]: event.target.value })); resetApproval(); }} value={choices[application.id] ?? ""}><option value="">기존 아이 연결 또는 새 아이 등록을 선택해주세요</option><option value="NEW">새 아이로 등록</option>{application.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}{candidate.isRequested ? " · 보호자 요청 (참고)" : ""}</option>)}</Select></label>
      <label className="block space-y-1 text-sm"><span>{application.childName ?? "아이"} 예약 운영 메모 초안</span><textarea className="min-h-24 w-full rounded border p-2" maxLength={1000} value={memos[application.id] ?? ""} onChange={(event) => { setMemos((current) => ({ ...current, [application.id]: event.target.value })); resetApproval(); }} /></label>
      <p className="text-xs text-slate-600">아직 예약에 반영되지 않은 아이별 초안입니다. 보호자 요청 원문은 유지됩니다. 건강·알레르기 등 민감정보는 메모에 옮기지 말고 기존 안전정보 관리 절차를 따르세요.</p>
    </fieldset>)}
    <dl className="grid grid-cols-2 gap-2 rounded border p-3 text-sm" aria-live="polite" data-testid="confirmation-amounts"><dt>선택한 아이</dt><dd>{amounts.count}명</dd><dt>선택 청구액 S</dt><dd>{money(amounts.total)}</dd><dt>최신 서버 가용액 A</dt><dd>{money(spendableAmount)}</dd><dt>부족액 B</dt><dd>{money(amounts.shortfall)}</dd></dl>
    {amounts.count === 0 ? <p role="status">확정할 아이를 선택해 주세요.</p> : !explicitChoices ? <p role="status">선택한 아이마다 기존 아이 연결 또는 새 아이 등록을 명시적으로 선택해 주세요.</p> : null}
    {amounts.shortfall !== null && amounts.shortfall > 0 ? <p role="alert">예약 확정에 {money(amounts.shortfall)}이 부족합니다.</p> : null}
    {amounts.total === null || spendableAmount === null ? <p role="alert">청구액과 최신 서버 원장 검증 전에는 확정할 수 없습니다.</p> : null}
    {reviewRequired ? <div role="alert"><p>서버 금액·신청·클래스 정보가 변경되었습니다. 선택과 아이 연결을 다시 검토해주세요.</p><Button disabled={frozen} onClick={() => { setReviewRequired(false); resetApproval(); }} type="button">최신 선택 내용 다시 검토함</Button></div> : null}
    {warning ? <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm" role="alert"><p>{warningTarget?.childName} · {warningTarget?.classLabel}: 정원 {warning.capacity}명, 현재 예약 {warning.reservedCount}명. 이 아이 확정 후 {warning.overByAfterCreate}명 초과합니다. 전체 선택 {amounts.count}명은 함께 처리됩니다.</p><Button disabled={!ready} onClick={() => void submit(warning)} type="button">초과 예약을 확인하고 선택한 아이 {amounts.count}명 예약 확정</Button></div> : <Button disabled={!ready} type="submit">{pending ? `선택한 아이 ${amounts.count}명 예약 확정 중…` : `선택한 아이 ${amounts.count}명 예약 확정`}</Button>}
    {state?.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    {state?.status === "result-unknown" ? <p role="alert">예약 확정을 반복하지 마세요. 위의 최신 서버 상태 다시 조회로 실제 예약·결제 연결을 확인해주세요.</p> : null}
    <p className="text-xs text-slate-600">가용액이 충분해도 아이 소유·활성·파기 상태, 중복 예약, 동의, 클래스와 정원을 저장 직전 서버에서 다시 검증합니다.</p>
  </form>;
}
