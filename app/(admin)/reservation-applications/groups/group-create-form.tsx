"use client";

import { useActionState } from "react";
import { createApplicationGroup } from "../actions";
import { Button } from "@/components/ui/button";

type ClassRow = { id: string; startsAt: string; applicationPrice: number | null; program: { name: string } };

export function GroupCreateForm({ classes }: { classes: ClassRow[] }) {
  const [state, action, pending] = useActionState(async (_state: { error?: string; groupId?: string }, data: FormData) => createApplicationGroup(data), {});
  return <form action={action} className="space-y-3 rounded border p-4"><h2 className="font-semibold">새 그룹 만들기</h2>{classes.length === 0 ? <p className="text-sm text-slate-500">선택할 미래 예정 클래스가 없습니다.</p> : classes.map((item) => <label className="flex items-center gap-2 text-sm" key={item.id}><input disabled={!item.applicationPrice} name="classScheduleId" type="checkbox" value={item.id} /><span>{item.program.name} · {item.startsAt} · {item.applicationPrice ? `${item.applicationPrice.toLocaleString("ko-KR")}원` : "신청 금액 미설정"}</span></label>)}{state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}{state.groupId ? <p className="text-sm text-emerald-700">그룹을 만들었습니다. 목록에서 링크를 발급해주세요.</p> : null}<Button disabled={pending || classes.length === 0} type="submit">{pending ? "생성 중..." : "그룹 만들기"}</Button></form>;
}
