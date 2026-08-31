"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatKrw } from "@/lib/payments/format";
import { createPayment, type PaymentFormState } from "../actions";

export function PaymentForm({ reservationId, defaultPayerName }: { reservationId: string; defaultPayerName?: string | null }) {
  const [state, formAction, pending] = useActionState(createPayment, {} as PaymentFormState);
  const [amount, setAmount] = useState(state.values?.amount ?? "");
  const [discountAmount, setDiscountAmount] = useState(state.values?.discountAmount ?? "0");
  const paidAmount = useMemo(() => {
    const amountValue = Number(amount);
    const discountValue = Number(discountAmount);
    if (!Number.isInteger(amountValue) || !Number.isInteger(discountValue)) return null;
    if (amountValue < 0 || discountValue < 0 || discountValue > amountValue) return null;
    return amountValue - discountValue;
  }, [amount, discountAmount]);
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  return (
    <form action={formAction} className="max-w-xl space-y-6" key={formKey} noValidate>
      <input name="reservationId" type="hidden" value={reservationId} />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="amount">정가 *</Label>
          <Input id="amount" inputMode="numeric" min={0} name="amount" onChange={(event) => setAmount(event.target.value)} required type="number" value={amount} />
          {state.errors?.amount ? <p className="text-sm text-red-600" role="alert">{state.errors.amount[0]}</p> : null}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="discountAmount">할인금액 *</Label>
          <Input id="discountAmount" inputMode="numeric" min={0} name="discountAmount" onChange={(event) => setDiscountAmount(event.target.value)} required type="number" value={discountAmount} />
          {state.errors?.discountAmount ? <p className="text-sm text-red-600" role="alert">{state.errors.discountAmount[0]}</p> : null}
        </div>
      </div>
      <p className="rounded-md bg-slate-50 p-3 text-sm">실제 결제금액: <strong>{paidAmount === null ? "입력값 확인 필요" : formatKrw(paidAmount)}</strong></p>
      <div className="space-y-1.5">
        <Label htmlFor="method">결제수단 *</Label>
        <Select defaultValue={state.values?.method ?? ""} id="method" name="method" required>
          <option disabled value="">결제수단을 선택하세요</option>
          <option value="CARD">카드</option><option value="TRANSFER">계좌이체</option><option value="CASH">현금</option><option value="OTHER">기타</option>
        </Select>
        {state.errors?.method ? <p className="text-sm text-red-600" role="alert">{state.errors.method[0]}</p> : null}
      </div>
      <div className="space-y-1.5"><Label htmlFor="payerName">결제자 이름</Label><Input defaultValue={state.values?.payerName ?? defaultPayerName ?? ""} id="payerName" name="payerName" /></div>
      <div className="space-y-1.5"><Label htmlFor="memo">메모</Label><Textarea defaultValue={state.values?.memo ?? ""} id="memo" name="memo" rows={3} /></div>
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      <Button disabled={pending} type="submit">{pending ? "등록 중..." : "결제 등록"}</Button>
    </form>
  );
}
