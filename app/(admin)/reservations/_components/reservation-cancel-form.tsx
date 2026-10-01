"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cancelReservation, type ReservationCancelFormState } from "../actions";

// prisma/schema.prisma ReservationCancelReason enum
const CANCEL_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "PERSONAL", label: "개인 사정" },
  { value: "ILLNESS", label: "질병" },
  { value: "SCHEDULE", label: "일정 변경" },
  { value: "WEATHER", label: "날씨" },
  { value: "DUPLICATE", label: "중복 예약" },
  { value: "OPERATION", label: "운영 사정" },
  { value: "OTHER", label: "기타" },
];

export interface ReservationCancelFormProps {
  reservationId: string;
  /** 보관기간 만료로 개인정보를 파기한 아이의 예약이면 상세 사유(자유 입력)를 받지 않는다(ADR-058). */
  childPersonalDataPurged?: boolean;
}

const initialState: ReservationCancelFormState = {};

export function ReservationCancelForm({ reservationId, childPersonalDataPurged = false }: ReservationCancelFormProps) {
  const [state, formAction, pending] = useActionState(cancelReservation.bind(null, reservationId), initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="cancelReason">
          취소 사유 <span className="text-red-600">*</span>
        </Label>
        <Select defaultValue={state.values?.cancelReason ?? ""} id="cancelReason" name="cancelReason" required>
          <option disabled value="">
            취소 사유를 선택하세요
          </option>
          {CANCEL_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {state.errors?.cancelReason ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.cancelReason[0]}
          </p>
        ) : null}
      </div>

      {childPersonalDataPurged ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600" data-testid="cancel-detail-purged">
          보관기간이 지나 개인정보를 파기한 아이의 예약이라 상세 사유는 기록하지 않습니다. 취소 사유만 선택해주세요.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="cancelDetail">상세 사유</Label>
          <Textarea
            defaultValue={state.values?.cancelDetail ?? ""}
            id="cancelDetail"
            name="cancelDetail"
            rows={4}
          />
          {state.errors?.cancelDetail ? (
            <p className="text-sm text-red-600" role="alert">
              {state.errors.cancelDetail[0]}
            </p>
          ) : null}
        </div>
      )}
      {childPersonalDataPurged && state.errors?.cancelDetail ? (
        <p className="text-sm text-red-600" role="alert">
          {state.errors.cancelDetail[0]}
        </p>
      ) : null}

      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}

      <Button className="bg-red-600 hover:bg-red-700" disabled={pending} type="submit">
        {pending ? "취소 처리 중..." : "예약 취소"}
      </Button>
    </form>
  );
}
