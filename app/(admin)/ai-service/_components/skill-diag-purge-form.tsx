"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { previewSkillDiagPurgeAction, executeSkillDiagPurgeAction, type SkillDiagPurgePreviewState, type SkillDiagPurgeExecuteState } from "../actions";

const INITIAL_PREVIEW_STATE: SkillDiagPurgePreviewState = null;
const INITIAL_STATE: SkillDiagPurgeExecuteState = null;

export function SkillDiagPurgeForm() {
    const [previewState, previewAction, previewPending] = useActionState(previewSkillDiagPurgeAction, INITIAL_PREVIEW_STATE);
    const [state, executeAction, pending] = useActionState(executeSkillDiagPurgeAction, INITIAL_STATE);
    return <div className="mt-3 space-y-3">
        <form action={previewAction}>
            <Button disabled={previewPending || pending}>삭제 대상 확인</Button>
            {previewState && "formError" in previewState ? <p role="alert">
                {previewState.formError}
                {"partialDiagDeleted" in previewState ? <> · 일부 삭제: {previewState.partialDiagDeleted}건 · 남은 대상: {previewState.remainingEligible}건 · 감사 기록: {previewState.auditWritten ? "예" : "아니요"}</> : null}
            </p> : null}
        </form>
        {previewState && "expectedEligible" in previewState ? <form action={executeAction}>
            <p>삭제 대상: {previewState.expectedEligible}건 · 확인 시각 (UTC): {previewState.asOf}</p>
            <input type="hidden" name="expectedEligible" value={previewState.expectedEligible} />
            <Button disabled={pending || previewPending}>진단 삭제 확정</Button>
        </form> : null}
        {state && "formError" in state ? <p role="alert">{state.formError} · 일부 삭제: {state.partialDiagDeleted}건 · 남은 대상: {state.remainingEligible}건 · 감사 기록: {state.auditWritten ? "예" : "아니요"}</p> : null}
        {state && "diagDeleted" in state ? <p role="status">삭제: {state.diagDeleted}건 · 삭제 전 대상: {state.beforeEligible}건 · 삭제 후 대상: {state.afterEligible}건 · 감사 기록: {state.auditWritten ? "예" : "아니요"} · 감사 ID: {state.auditId ?? "없음"}</p> : null}
    </div>;
}
