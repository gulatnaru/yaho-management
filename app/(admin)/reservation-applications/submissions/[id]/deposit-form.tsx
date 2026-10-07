"use client";

import { useActionState, useEffect, useState } from "react";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordApplicationDeposit } from "../../actions";

function newIdempotencyKey() { return crypto.randomUUID(); }

export function DepositForm({ submissionId }: { submissionId: string }) {
  const [key, setKey] = useState(newIdempotencyKey);
  const [state, action, pending] = useActionState(async (_: { error?: string; availableAmount?: number }, form: FormData) => recordApplicationDeposit(submissionId, form), {});
  useEffect(() => { if (state.availableAmount !== undefined) setKey(newIdempotencyKey()); }, [state.availableAmount]);
  const now = new Date();
  return <form action={action} className="grid gap-3 rounded border p-4 sm:grid-cols-2">
    <input name="idempotencyKey" type="hidden" value={key} />
    <div><Label>실제 입금액</Label><Input min="1" name="amount" required type="number" /></div>
    <div><Label>실제 입금자명</Label><Input name="payerName" required /></div>
    <div><Label>입금일시 (KST)</Label><Input defaultValue={`${formatKstDate(now)}T${formatKstTime(now)}`} name="depositedAt" required type="datetime-local" /></div>
    {state.error ? <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p> : null}
    {state.availableAmount !== undefined ? <p className="text-sm text-emerald-700 sm:col-span-2">현재 가용 입금액 {state.availableAmount.toLocaleString("ko-KR")}원</p> : null}
    <Button className="sm:col-span-2" disabled={pending} type="submit">{pending ? "기록 중..." : "실제 입금 기록"}</Button>
  </form>;
}
