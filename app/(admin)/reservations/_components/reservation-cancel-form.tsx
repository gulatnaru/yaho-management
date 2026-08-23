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
}

const initialState: ReservationCancelFormState = {};

export function ReservationCancelForm({ reservationId }: ReservationCancelFormProps) {
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
