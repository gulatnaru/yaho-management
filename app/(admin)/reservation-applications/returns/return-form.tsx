"use client";

import { useActionState, useEffect, useState } from "react";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import { recordApplicationReturn } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function newIdempotencyKey() { return crypto.randomUUID(); }

export function ReturnForm({ obligationId, remaining }: { obligationId: string; remaining: number }) {
  const [key, setKey] = useState(newIdempotencyKey);
  const [state, action, pending] = useActionState(async (_: { error?: string; remainingAmount?: number }, form: FormData) => recordApplicationReturn(obligationId, form), {});
  useEffect(() => { if (state.remainingAmount !== undefined) setKey(newIdempotencyKey()); }, [state.remainingAmount]);
  const now = new Date();
  return <form action={action} className="mt-2 flex flex-wrap gap-2">
    <input name="idempotencyKey" type="hidden" value={key} />
    <Input max={remaining} min="1" name="amount" required type="number" />
    <Input name="reason" required placeholder="반환 사유" />
    <Input aria-label="실제 반환일시 (KST)" defaultValue={`${formatKstDate(now)}T${formatKstTime(now)}`} name="returnedAt" required type="datetime-local" />
    <Button disabled={pending} type="submit">반환 기록</Button>
    {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    {state.remainingAmount !== undefined ? <p className="text-sm text-emerald-700" role="status">남은 반환 {state.remainingAmount.toLocaleString("ko-KR")}원</p> : null}
  </form>;
}
