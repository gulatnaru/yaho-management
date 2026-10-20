"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_RESOLUTION_NOTE_MAX_LENGTH } from "@/lib/reservation-applications/constants";
import {
  cancelReservationApplication,
  rejectReservationApplication,
  type ApplicationResolveFormState,
} from "../actions";

import { refreshApplicationWorkflow, resolveApplicationWorkflow, type WorkflowActionResult } from "../actions";
import { useWorkflowCoordinator } from "../submissions/[id]/workflow-controller";

const COPY = {
  REJECTED: {
    label: "반려 사유",
    placeholder: "예) 정원이 마감되어 반려",
    submit: "신청 반려",
  },
  CANCELLED: {
    label: "취소 사유",
    placeholder: "예) 보호자 요청으로 취소",
    submit: "보호자 요청으로 취소",
  },
} as const;

const initialState: ApplicationResolveFormState = {};

/** 반려(운영자 판단)와 취소(보호자 요청)는 각각 별도 폼이다(UI-GUIDELINES §7). 사유는 필수다. */
function LegacyApplicationResolveForm({
  applicationId,
  kind,
}: {
  applicationId: string;
  kind: "REJECTED" | "CANCELLED";
}) {
  const action = kind === "REJECTED" ? rejectReservationApplication : cancelReservationApplication;
  const [state, formAction, pending] = useActionState(action.bind(null, applicationId), initialState);
  const copy = COPY[kind];
  const fieldId = `${applicationId}-${kind.toLowerCase()}-resolution-note`;
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  return (
    <form action={formAction} className="space-y-2" key={formKey} noValidate>
      <Label htmlFor={fieldId}>
        {copy.label} <span className="text-red-600">*</span>
      </Label>
      <Textarea
        defaultValue={state.values?.resolutionNote ?? ""}
        id={fieldId}
        maxLength={APPLICATION_RESOLUTION_NOTE_MAX_LENGTH}
        name="resolutionNote"
        placeholder={copy.placeholder}
        rows={3}
      />
      {state.errors?.resolutionNote ? (
        <p className="text-sm text-red-600" role="alert">
          {state.errors.resolutionNote[0]}
        </p>
      ) : null}
      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}
      <Button className="w-full md:w-auto" disabled={pending} type="submit">
        {pending ? "처리 중..." : copy.submit}
      </Button>
    </form>
  );
}


export function ApplicationResolveForm(props: { applicationId: string; kind: "REJECTED" | "CANCELLED"; childName?: string; familyWorkflow?: boolean }) {
  return props.familyWorkflow ? <FamilyResolveForm {...props} /> : <LegacyApplicationResolveForm {...props} />;
}
function FamilyResolveForm({ applicationId, kind, childName }: { applicationId: string; kind: "REJECTED" | "CANCELLED"; childName?: string }) {
  const workflow = useWorkflowCoordinator();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<WorkflowActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const attempt = useRef<{ applicationId: string; kind: "REJECTED" | "CANCELLED"; note: string } | null>(null);
  const frozen = busy || active.current || Boolean(workflow?.busy) || result?.status === "result-unknown" || result?.status === "success";
  const copy = COPY[kind];
  const fieldId = `${applicationId}-${kind}-reason`;
  const lookup = async () => {
    if (!workflow || active.current) return;
    active.current = true; setBusy(true);
    try {
      setResult(await workflow.run(async () => {
        const detail = await refreshApplicationWorkflow(workflow.submissionId);
        const row = detail?.applications.find((item) => item.id === applicationId);
        const original = attempt.current;
        return original?.applicationId === applicationId && original.kind === kind && row?.status === kind && row.resolutionNote === original.note ? { status: "success", receiptId: applicationId, submissionId: detail!.id } : { status: "result-unknown", submissionId: workflow.submissionId, error: "처리 결과를 아직 확인하지 못했습니다. 다시 조회해주세요." };
      }, kind, `${kind}:${applicationId}`));
    } finally { active.current = false; setBusy(false); }
  };
  return <form className="min-w-0 space-y-2" noValidate onSubmit={async (event) => {
    event.preventDefault(); if (!workflow || workflow.blocked || workflow.busy || active.current) return;
    if (!note.trim()) { setResult({ status: "failure", errors: { resolutionNote: ["사유를 입력해주세요"] } }); return; }
    if (!window.confirm(`${childName ?? "아이"} · ${applicationId}\n${copy.submit}\n사유: ${note.trim()}\n이 대상과 사유로 처리할까요?`)) return;
    active.current = true; setBusy(true);
    attempt.current = { applicationId, kind, note: note.trim() };
    const data = new FormData(); data.set("resolutionNote", note);
    try { setResult(await workflow.run(() => resolveApplicationWorkflow(applicationId, kind, data), kind, `${kind}:${applicationId}`)); }
    finally { active.current = false; setBusy(false); }
  }}>
    <Label htmlFor={fieldId}>{copy.label} (필수)</Label><Textarea id={fieldId} value={note} onChange={(event) => { if (!frozen && !active.current) setNote(event.target.value); }} readOnly={frozen} maxLength={APPLICATION_RESOLUTION_NOTE_MAX_LENGTH} rows={3} required aria-invalid={Boolean(result?.errors?.resolutionNote)} />
    {result?.errors?.resolutionNote ? <p role="alert" className="text-sm text-red-700">{result.errors.resolutionNote[0]}</p> : null}{result?.error ? <p role="alert">{result.error}</p> : null}
    <Button type="submit" disabled={workflow?.blocked || busy || workflow?.busy || result?.status === "result-unknown" || result?.status === "success"}>{busy || workflow?.busy ? "처리·원장 확인 중…" : copy.submit}</Button>
    {result?.status === "result-unknown" ? <Button type="button" onClick={() => void lookup()} disabled={busy || workflow?.busy}>처리 결과 조회</Button> : null}
  </form>;
}
