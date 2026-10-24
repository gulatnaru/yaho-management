"use client";

import { useRef, useState } from "react";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import { depositInputSchema, returnInputSchema } from "@/lib/reservation-applications/phase20-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lookupWorkflowReceipt, recordApplicationDeposit, type WorkflowActionResult } from "../../actions";
import { useWorkflowCoordinator } from "./workflow-controller";

type BankFormProps = {
  kind: "deposit" | "return";
  targetId: string;
  remaining?: number;
  observed?: { amount: number; returnedAmount: number };
  disabled?: boolean;
  save: (form: FormData) => Promise<WorkflowActionResult>;
  verify?: (result: WorkflowActionResult) => Promise<boolean>;
};

/** A financial attempt is immutable after dispatch. Recovery only reads; replay needs a
 * separate explicit click and uses the original FormData and key. No PII is persisted. */
export function BankTransactionForm({ kind, targetId, remaining, observed, disabled = false, save, verify }: BankFormProps) {
  const workflow = useWorkflowCoordinator();
  const [key, setKey] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [phase, setPhase] = useState<"new" | "editing" | "unknown" | "retry" | "saved">("new");
  const [result, setResult] = useState<WorkflowActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const active = useRef(false);
  const attempt = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const now = new Date();
  const dateField = kind === "deposit" ? "depositedAt" : "returnedAt";
  const prefix = `${kind}-${targetId}`;
  const blocked = disabled || workflow?.busy || (workflow?.blocked && phase !== "unknown" && phase !== "retry" && phase !== "saved");
  const frozen = busy || active.current || Boolean(workflow?.busy) || phase === "unknown" || phase === "retry" || phase === "saved";
  const run = async (task: () => Promise<WorkflowActionResult>) => {
    if (active.current) return;
    active.current = true; setBusy(true);
    try {
      const execute = async () => {
        const response = await task();
        if (!workflow && response.status === "success" && verify) {
          setRefreshFailed(!await verify(response));
        }
        return response;
      };
      const response = workflow ? await workflow.run(execute, kind, `${kind}:${targetId}:${key}`) : await execute();
      setResult(response);
      if (response.status === "success") setPhase("saved");
      else if (response.status === "result-unknown") setPhase("unknown");
      else if (response.code === "not-found") setPhase("retry");
      // A dispatched, definitively rejected transaction can be corrected under the same key.
      else if (phase !== "unknown") { setPhase("editing"); attempt.current = null; }
    } catch {
      setResult({ status: "result-unknown", error: "결과 불명확 · 저장 결과를 먼저 조회해주세요." }); setPhase("unknown");
    } finally { active.current = false; setBusy(false); }
  };
  const start = () => { setRecovering(false); setKey(crypto.randomUUID()); setPhase("editing"); setResult(null); setRefreshFailed(false); attempt.current = null; formRef.current?.reset(); };
  const payload = () => {
    const form = new FormData(formRef.current!);
    form.set("idempotencyKey", key);
    if (observed) { form.set("observedAmount", String(observed.amount)); form.set("observedReturnedAmount", String(observed.returnedAmount)); }
    return form;
  };
  const submit = async (form: FormData) => {
    const parsed = (kind === "deposit" ? depositInputSchema : returnInputSchema).safeParse(Object.fromEntries(form));
    if (!parsed.success) { setResult({ status: "failure", error: "입력값을 확인해주세요.", errors: parsed.error.flatten().fieldErrors }); return; }
    attempt.current ??= form;
    await run(async () => {
      const receipt = await lookupWorkflowReceipt(kind, targetId, key, attempt.current!);
      if (receipt.status === "success" || receipt.status === "result-unknown" || receipt.code !== "not-found") return receipt;
      return save(attempt.current!);
    });
  };
  const fields = kind === "deposit" ? [["amount", "실제 입금액", "number"], ["payerName", "실제 은행 입금자명", "text"], [dateField, "실제 입금일시 (KST)", "datetime-local"]] : [["amount", "실제 반환 금액", "number"], [dateField, "실제 반환일시 (KST)", "datetime-local"], ["reason", "반환 사유", "text"]];
  return <div className="min-w-0 space-y-3" data-testid={`${kind}-transaction-form`}>
    <p className="text-sm">{kind === "deposit" ? "은행에서 확인한 실제 거래 금액을 그대로 기록합니다. 예약·결제는 생성되지 않습니다." : "관리자가 은행에서 이미 이체한 내역을 기록합니다. 이 버튼은 송금하지 않습니다. 처리자는 로그인한 ADMIN으로 기록됩니다."}</p>
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); if (!recovering && !busy && !blocked && phase === "editing") void submit(payload()); }} className="grid min-w-0 gap-3 rounded border p-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="idempotencyKey" value={key} />
      {fields.map(([name, label, type]) => <div key={name} className="min-w-0"><Label htmlFor={`${prefix}-${name}`}>{label}</Label><Input id={`${prefix}-${name}`} name={name} type={type} readOnly={frozen} disabled={phase === "new"} required min={type === "number" ? 1 : undefined} max={type === "number" ? remaining : undefined} maxLength={name === "payerName" ? 50 : name === "reason" ? 500 : undefined} defaultValue={name === dateField ? `${formatKstDate(now)}T${formatKstTime(now)}` : undefined} aria-invalid={Boolean(result?.errors?.[name])} aria-describedby={result?.errors?.[name] ? `${prefix}-${name}-error` : undefined} />{result?.errors?.[name] ? <p id={`${prefix}-${name}-error`} role="alert" className="text-sm text-red-700">{result.errors[name][0]}</p> : null}</div>)}
      {phase === "editing" && !recovering ? <Button disabled={busy || Boolean(blocked)} type="submit" className="sm:col-span-2">{busy ? "기록·원장 확인 중…" : kind === "deposit" ? "실제 입금 기록" : "반환 이체 기록"}</Button> : null}
    </form>
    {key ? <p className="break-all text-xs">거래 식별자: <code>{key}</code> · 다른 브라우저에서도 이 식별자와 원래 입력으로 결과를 먼저 조회하세요.</p> : null}
    {result ? <p role={result.status === "success" && !refreshFailed ? "status" : "alert"} aria-live="polite" className="text-sm">{refreshFailed ? "갱신 실패 · 기록은 저장되었으나 최신 반환 원장을 확인하지 못했습니다." : result.status === "success" ? "저장 기록 확인됨 · 최신 금액은 서버 원장 검증 결과를 확인해주세요." : result.error}</p> : null}
    {((phase === "editing" && recovering) || phase === "unknown" || phase === "saved" || phase === "retry") ? <Button type="button" disabled={busy || workflow?.busy} onClick={() => { attempt.current ??= payload(); setRecovering(false); void run(() => lookupWorkflowReceipt(kind, targetId, key, attempt.current!)); }}>저장 결과 조회</Button> : null}
    {phase === "retry" ? <Button type="button" disabled={busy || workflow?.busy} onClick={() => void run(() => save(attempt.current!))}>동일 거래 식별자로 다시 기록</Button> : null}
    {(phase === "new" || phase === "saved" || phase === "editing") ? <Button type="button" disabled={busy || Boolean(disabled) || Boolean(workflow?.busy) || Boolean(workflow?.blocked) || refreshFailed} onClick={start}>{kind === "deposit" ? "새 입금 거래 시작" : "새 반환 거래 시작"}</Button> : null}
    {phase === "new" ? <div className="space-y-2"><Label htmlFor={`${prefix}-recover`}>다른 브라우저의 기존 거래 식별자</Label><Input id={`${prefix}-recover`} value={key} onChange={(event) => setKey(event.target.value)} maxLength={200} /><Button type="button" disabled={key.length < 16 || busy} onClick={() => { setRecovering(true); setPhase("editing"); setResult({ status: "failure", error: "원래 금액·이름/사유·일시를 입력하고 저장 결과를 먼저 조회하세요." }); }}>기존 거래 조회 준비</Button></div> : null}
  </div>;
}
export function DepositForm({ submissionId }: { submissionId: string }) {
  return <BankTransactionForm kind="deposit" targetId={submissionId} save={(form) => recordApplicationDeposit(submissionId, form)} />;
}
