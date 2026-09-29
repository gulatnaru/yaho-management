"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  APPLICATION_RESERVATION_MEMO_MAX_LENGTH,
  NEW_CHILD_CHOICE,
} from "@/lib/reservation-applications/constants";
import { cn } from "@/lib/utils";
import { confirmReservationApplication, type ApplicationConfirmFormState } from "../actions";

export type ApplicationChildOption = {
  id: string;
  name: string;
  birthDateLabel: string;
  guardianPhone: string | null;
  isActive: boolean;
  matchLabel: string;
};

export interface ApplicationConfirmFormProps {
  applicationId: string;
  childOptions: ApplicationChildOption[];
  defaultMemo: string;
}

const initialState: ApplicationConfirmFormState = {};

/**
 * 기존 아이 선택 또는 새 아이 등록 후 예약으로 확정한다(ADR-053). 자동으로 연결하지 않는다.
 * 정원 이상이면 기존 예약 화면과 같은 2단계 초과 예약 확인을 거친다.
 */
export function ApplicationConfirmForm({ applicationId, childOptions, defaultMemo }: ApplicationConfirmFormProps) {
  const [state, formAction, pending] = useActionState(
    confirmReservationApplication.bind(null, applicationId),
    initialState,
  );
  const formKey = state.values ? JSON.stringify(state.values) : "initial";
  const selectedChoice = state.values?.childChoice ?? (childOptions.length === 0 ? NEW_CHILD_CHOICE : undefined);
  const hasInactiveOption = childOptions.some((option) => !option.isActive);

  return (
    <form action={formAction} className="space-y-4" key={formKey} noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          연결할 아이 <span className="text-red-600">*</span>
        </legend>
        {childOptions.length === 0 ? (
          <p className="text-sm text-slate-500">이름이나 연락처가 같은 기존 아이가 없습니다.</p>
        ) : null}
        {childOptions.map((option) => (
          <label
            className={cn(
              "flex items-start gap-3 rounded-md border border-slate-200 p-3 text-sm",
              !option.isActive && "opacity-60",
            )}
            key={option.id}
          >
            <input
              className="mt-1 h-4 w-4 shrink-0"
              defaultChecked={selectedChoice === option.id}
              disabled={!option.isActive}
              name="childChoice"
              type="radio"
              value={option.id}
            />
            <span className="min-w-0">
              <span className="block break-words font-medium">
                {option.name}
                {option.isActive ? null : " (비활성)"}
              </span>
              <span className="block break-words text-xs text-slate-500">
                생년월일 {option.birthDateLabel} · 연락처 {option.guardianPhone ?? "미입력"} · {option.matchLabel}
              </span>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3 text-sm">
          <input
            className="mt-1 h-4 w-4 shrink-0"
            defaultChecked={selectedChoice === NEW_CHILD_CHOICE}
            name="childChoice"
            type="radio"
            value={NEW_CHILD_CHOICE}
          />
          <span>신청 정보로 새 아이 등록</span>
        </label>
        {hasInactiveOption ? (
          <p className="text-xs text-slate-500">비활성 아이는 아이 상세에서 다시 활성화한 뒤 연결할 수 있습니다.</p>
        ) : null}
        {state.errors?.childChoice ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.childChoice[0]}
          </p>
        ) : null}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-memo">예약 메모</Label>
        <Textarea
          aria-describedby="confirm-memo-guide"
          defaultValue={state.values?.memo ?? defaultMemo}
          id="confirm-memo"
          maxLength={APPLICATION_RESERVATION_MEMO_MAX_LENGTH}
          name="memo"
          rows={4}
        />
        <p className="text-xs text-slate-500" id="confirm-memo-guide">
          보호자 요청사항을 옮겨 두었습니다. 건강·알레르기 정보가 있으면 지우고 아이의 안전정보에 기록해주세요.
        </p>
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

      {state.overbookingConfirmation ? (
        <>
          <WarningBanner>
            현재 예약 {state.overbookingConfirmation.reservedCount}명 / 정원 {state.overbookingConfirmation.capacity}명입니다.
            확정하면 정원 초과 {state.overbookingConfirmation.overByAfterCreate}명이 됩니다.
          </WarningBanner>
          <input name="confirmedApplicationId" type="hidden" value={state.overbookingConfirmation.applicationId} />
          <input name="confirmedChildChoice" type="hidden" value={state.overbookingConfirmation.childChoice} />
        </>
      ) : null}

      <div className="flex flex-col gap-2 md:flex-row">
        <Button className="w-full md:w-auto" disabled={pending} type="submit">
          {pending ? "처리 중..." : "예약 확정"}
        </Button>
        {state.overbookingConfirmation ? (
          <Button
            className="w-full md:w-auto"
            disabled={pending}
            name="confirmOverbooking"
            type="submit"
            value="true"
          >
            {pending ? "처리 중..." : "초과 예약 확인 후 확정"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
