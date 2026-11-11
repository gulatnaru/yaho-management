"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { deleteConsultationAction, lookupConsultationsBySubjectAction, type ConsultationLookupState } from "../actions";

const input = "rounded border px-3 py-2 w-full";
const button = "rounded bg-slate-800 px-3 py-2 text-white";
const danger = "rounded bg-red-700 px-3 py-2 text-white";

const INITIAL_STATE: ConsultationLookupState = {};

/**
 * Individual-delete section (OQ-12 P0-B). Two-step flow: the ADMIN looks a
 * subject up first, then submits a separate delete form for the rows shown.
 * The subject ID is never stored on the server: it travels only as a form
 * field the ADMIN's browser resubmits (hidden field in the delete forms).
 * Only row metadata is ever displayed — no utterance, no hash.
 */
export function ConsultationDeleteForm() {
    const [lookup, lookupAction, lookupPending] = useActionState(lookupConsultationsBySubjectAction, INITIAL_STATE);
    const [deletion, deleteAction, deletePending] = useActionState(deleteConsultationAction, INITIAL_STATE);
    const [subject, setSubject] = useState("");
    const [submittedSubject, setSubmittedSubject] = useState("");
    const [reasonCode, setReasonCode] = useState("USER_REQUEST");
    return <div className="mt-3 space-y-3">
        <form action={lookupAction} onSubmit={() => setSubmittedSubject(subject)} className="grid gap-3 md:grid-cols-2">
            <label>카카오 사용자 ID<Input className={input} name="subjectUserId" value={subject} onChange={(e) => setSubject(e.target.value)} required /></label>
            <Button className={button} disabled={lookupPending}>조회</Button>
        </form>
        {lookup.formError ? <p role="alert">조회에 실패했습니다.</p> : null}
        {deletion.formError ? <p role="alert">삭제에 실패했습니다.</p> : null}
        {deletion.deleted ? <p role="status">삭제 완료: {deletion.deleted.deletedCount}건 삭제, 남은 {deletion.deleted.remainingCount}건. 다시 조회해 확인하세요.</p> : null}
        {lookup.rows && !deletion.deleted ? <div>
            <p>조회 결과: {lookup.rows.length}건</p>
            <ul className="mt-2 space-y-2">
                {lookup.rows.map((r) => <li key={r.id} className="rounded border p-2">
                    <p>요청 {r.id} · 상태 {r.status} · 분류 {r.category ?? "없음"}</p>
                    <p>생성 (UTC): {r.createdAt} · 만료 (UTC): {r.expiresAt}</p>
                    <form action={deleteAction} className="mt-2 flex gap-2">
                        <input type="hidden" name="subjectUserId" value={submittedSubject} />
                        <input type="hidden" name="scope" value="SINGLE" />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="reasonCode" value={reasonCode} />
                        <Button className={danger} disabled={deletePending}>이 요청 삭제</Button>
                    </form>
                </li>)}
            </ul>
            {lookup.rows.length > 0 ? <form action={deleteAction} className="mt-3 flex gap-2">
                <input type="hidden" name="subjectUserId" value={submittedSubject} />
                <input type="hidden" name="scope" value="BULK" />
                <input type="hidden" name="reasonCode" value={reasonCode} />
                <Button className={danger} disabled={deletePending}>조회된 요청 전체 삭제 (최대 100건)</Button>
            </form> : null}
            <label className="mt-3 block">삭제 사유<Select className={input} name="reasonCode" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}><option value="USER_REQUEST">이용자 요청</option><option value="ADMIN_REVIEW">관리자 검토</option></Select></label>
        </div> : null}
    </div>;
}
