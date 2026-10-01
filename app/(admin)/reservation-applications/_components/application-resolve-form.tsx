"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_RESOLUTION_NOTE_MAX_LENGTH } from "@/lib/reservation-applications/constants";
import {
  cancelReservationApplication,
  rejectReservationApplication,
  type ApplicationResolveFormState,
} from "../actions";

const COPY = {
  REJECTED: {
    label: "반려 사유",
    placeholder: "예) 정원이 마감되어 반려",
    submit: "신청 반려",
  },
  CANCELLED: {
    label: "취소 사유",
    placeholder: "예) 보호자 요청으로 취소",
    submit: "신청 취소",
  },
} as const;

const initialState: ApplicationResolveFormState = {};

/** 반려(운영자 판단)와 취소(보호자 요청)는 각각 별도 폼이다(UI-GUIDELINES §7). 사유는 필수다. */
export function ApplicationResolveForm({
  applicationId,
  kind,
}: {
  applicationId: string;
  kind: "REJECTED" | "CANCELLED";
}) {
  const action = kind === "REJECTED" ? rejectReservationApplication : cancelReservationApplication;
  const [state, formAction, pending] = useActionState(action.bind(null, applicationId), initialState);
  const copy = COPY[kind];
  const fieldId = `${kind.toLowerCase()}-resolution-note`;
  const formKey = state.values ? JSON.stringify(state.values) : "initial";

  return (
    <form action={formAction} className="space-y-2" key={formKey} noValidate>
      <Label htmlFor={fieldId}>
        {copy.label} <span className="text-red-600">*</span>
      </Label>
      <Textarea
        defaultValue={state.values?.resolutionNote ?? ""}
        id={fieldId}
        maxLength={APPLICATION_RESOLUTION_NOTE_MAX_LENGTH}
        name="resolutionNote"
        placeholder={copy.placeholder}
        rows={3}
      />
      {state.errors?.resolutionNote ? (
        <p className="text-sm text-red-600" role="alert">
          {state.errors.resolutionNote[0]}
        </p>
      ) : null}
      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}
      <Button className="w-full md:w-auto" disabled={pending} type="submit">
        {pending ? "처리 중..." : copy.submit}
      </Button>
    </form>
  );
}
