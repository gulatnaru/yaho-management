"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createRefund, type RefundFormState } from "@/app/(admin)/payments/actions";

const REASONS = [{ value: "PERSONAL", label: "개인 사정" }, { value: "ILLNESS", label: "질병" }, { value: "WEATHER", label: "날씨" }, { value: "SCHEDULE", label: "일정 변경" }, { value: "DUPLICATE_PAYMENT", label: "중복 결제" }, { value: "CLASS_CANCELLED", label: "클래스 취소" }, { value: "OPERATION", label: "운영 사정" }, { value: "OTHER", label: "기타" }];

export function RefundForm({ paymentItemId, remainingAmount, isNoShow }: { paymentItemId: string; remainingAmount: number; isNoShow: boolean }) {
  const [state, formAction, pending] = useActionState(createRefund, {} as RefundFormState);
  const formKey = state.values ? JSON.stringify(state.values) : "initial";
  return <form action={formAction} className="max-w-xl space-y-6" key={formKey} noValidate><input name="paymentItemId" type="hidden" value={paymentItemId} /><div className="space-y-1.5"><Label htmlFor="amount">환불금액 *</Label><Input defaultValue={state.values?.amount ?? ""} id="amount" max={remainingAmount} min={1} name="amount" required type="number" />{state.errors?.amount ? <p className="text-sm text-red-600" role="alert">{state.errors.amount[0]}</p> : null}</div><div className="space-y-1.5"><Label htmlFor="reason">환불 사유 *</Label><Select defaultValue={state.values?.reason ?? ""} id="reason" name="reason" required><option disabled value="">환불 사유를 선택하세요</option>{REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>{state.errors?.reason ? <p className="text-sm text-red-600" role="alert">{state.errors.reason[0]}</p> : null}</div><div className="space-y-1.5"><Label htmlFor="reasonDetail">상세 환불사유 {isNoShow ? "*" : ""}</Label><Textarea defaultValue={state.values?.reasonDetail ?? ""} id="reasonDetail" name="reasonDetail" required={isNoShow} rows={4} />{isNoShow ? <p className="text-xs text-amber-700">노쇼 예약은 예외 환불 사유를 반드시 기록해야 합니다.</p> : null}{state.errors?.reasonDetail ? <p className="text-sm text-red-600" role="alert">{state.errors.reasonDetail[0]}</p> : null}</div>{state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}<Button disabled={pending} type="submit">{pending ? "처리 중..." : "환불 처리"}</Button></form>;
}
