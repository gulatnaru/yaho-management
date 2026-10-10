"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updateApplicationGroup } from "../actions";

type ClassOption = { id: string; label: string; applicationPrice: number | null; selected: boolean; eligible: boolean };

/** ADMIN-only future membership editor. Existing submitted quotes are kept server-side. */
export function GroupEditForm({ groupId, isActive, classes }: { groupId: string; isActive: boolean; classes: ClassOption[] }) {
  const [state, action, pending] = useActionState(async (_state: { error?: string }, formData: FormData) => updateApplicationGroup(groupId, formData), {});
  return <form action={action} className="space-y-3 rounded border p-4"><div><h2 className="font-semibold">클래스 구성 변경</h2><p className="mt-1 text-sm text-slate-500">변경은 이후 신청에만 적용되며, 이미 접수된 신청은 유지됩니다.</p></div>{classes.map((item) => <label className="flex items-center gap-2 text-sm" key={item.id}><input defaultChecked={item.selected} disabled={!isActive || (!item.eligible && !item.selected)} name="classScheduleId" type="checkbox" value={item.id} /><span>{item.label} · {item.applicationPrice ? `${item.applicationPrice.toLocaleString("ko-KR")}원` : "신청 금액 미설정"}{item.selected && !item.eligible ? " · 현재 구성에 보존됨 (해제하면 제거)" : ""}</span></label>)}{state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}<Button disabled={!isActive || pending} type="submit">{pending ? "저장 중..." : "구성 저장"}</Button></form>;
}
