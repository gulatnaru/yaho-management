"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import type { ChildCandidate, ScheduledClassCandidate } from "@/lib/reservations/candidates";
import { createReservation, type ReservationFormState } from "../actions";

export type ReservationFormDefaultValues = {
  classScheduleId: string;
  childId: string;
  memo: string;
};

export interface ReservationFormProps {
  childCandidates: ChildCandidate[];
  classCandidates: ScheduledClassCandidate[];
  defaultValues?: ReservationFormDefaultValues;
  /** ?classScheduleId= 프리필이 후보 목록에 없을 때 표시할 사유 (제출을 막지 않는다). */
  classPrefillWarning?: string;
  /** ?childId= 프리필이 후보 목록에 없을 때 표시할 사유 (제출을 막지 않는다). */
  childPrefillWarning?: string;
}

const emptyDefaults: ReservationFormDefaultValues = {
  classScheduleId: "",
  childId: "",
  memo: "",
};

const initialState: ReservationFormState = {};

/** 예) "발레 A반 9/5 10:00 (3/8명)" */
function formatClassCandidateLabel(item: ScheduledClassCandidate): string {
  const [, month, day] = formatKstDate(item.startsAt).split("-");
  const time = formatKstTime(item.startsAt);
  return `${item.program.name} ${Number(month)}/${Number(day)} ${time} (${item.reservedCount}/${item.capacity}명)`;
}

export function ReservationForm({
  childCandidates,
  classCandidates,
  defaultValues = emptyDefaults,
  classPrefillWarning,
  childPrefillWarning,
}: ReservationFormProps) {
  const [state, formAction, pending] = useActionState(createReservation, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="classScheduleId">
          클래스 <span className="text-red-600">*</span>
        </Label>
        {classPrefillWarning ? <WarningBanner>{classPrefillWarning}</WarningBanner> : null}
        <Select
          defaultValue={state.values?.classScheduleId ?? defaultValues.classScheduleId}
          id="classScheduleId"
          name="classScheduleId"
          required
        >
          <option disabled value="">
            클래스를 선택하세요
          </option>
          {classCandidates.map((classItem) => (
            <option key={classItem.id} value={classItem.id}>
              {formatClassCandidateLabel(classItem)}
            </option>
          ))}
        </Select>
        {state.errors?.classScheduleId ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.classScheduleId[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="childId">
          아이 <span className="text-red-600">*</span>
        </Label>
        {childPrefillWarning ? <WarningBanner>{childPrefillWarning}</WarningBanner> : null}
        <Select defaultValue={state.values?.childId ?? defaultValues.childId} id="childId" name="childId" required>
          <option disabled value="">
            아이를 선택하세요
          </option>
          {childCandidates.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </Select>
        {state.errors?.childId ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.childId[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="memo">메모</Label>
        <Textarea defaultValue={state.values?.memo ?? defaultValues.memo} id="memo" name="memo" rows={4} />
        {state.errors?.memo ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.memo[0]}
          </p>
        ) : null}
      </div>

      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}

      <Button disabled={pending} type="submit">
        {pending ? "저장 중..." : "예약 등록"}
      </Button>
    </form>
  );
}
