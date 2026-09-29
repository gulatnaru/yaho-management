"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APPLICATION_GENDER_OPTIONS,
  APPLICATION_NAME_MAX_LENGTH,
  APPLICATION_REQUEST_NOTE_GUIDE,
  APPLICATION_REQUEST_NOTE_MAX_LENGTH,
  GUARDIAN_RELATIONSHIP_OPTIONS,
} from "@/lib/reservation-applications/constants";
import type { ApplicationConsentItem } from "@/lib/reservation-applications/consent-content";
import type { ReservationApplicationFormState } from "../actions";

type SubmitApplicationAction = (
  state: ReservationApplicationFormState,
  formData: FormData,
) => Promise<ReservationApplicationFormState>;

export interface ReservationApplicationFormProps {
  action: SubmitApplicationAction;
  consentItems: ApplicationConsentItem[];
}

const initialState: ReservationApplicationFormState = {};

function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p className="text-sm text-red-600" id={id} role="alert">
      {messages[0]}
    </p>
  );
}

function RequiredMark() {
  return <span className="text-red-600">*</span>;
}

/** 모바일 1열 신청서. 서버 검증 실패 시 입력값과 필드별 오류를 유지한다(UI-GUIDELINES 8). */
export function ReservationApplicationForm({ action, consentItems }: ReservationApplicationFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const values = state.values;
  const errors = state.errors ?? {};
  const formKey = values ? JSON.stringify(values) : "initial";

  return (
    <form action={formAction} className="space-y-6" key={formKey} noValidate>
      <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <legend className="px-1 text-base font-semibold">아이 정보</legend>

        <div className="space-y-1.5">
          <Label htmlFor="childName">
            아이 이름 <RequiredMark />
          </Label>
          <Input
            aria-describedby={errors.childName ? "childName-error" : undefined}
            aria-invalid={Boolean(errors.childName)}
            autoComplete="off"
            defaultValue={values?.childName ?? ""}
            id="childName"
            maxLength={APPLICATION_NAME_MAX_LENGTH}
            name="childName"
            required
          />
          <FieldError id="childName-error" messages={errors.childName} />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="childBirthDate">
            생년월일 <RequiredMark />
          </Label>
          <Input
            aria-describedby={errors.childBirthDate ? "childBirthDate-error" : undefined}
            aria-invalid={Boolean(errors.childBirthDate)}
            defaultValue={values?.childBirthDate ?? ""}
            id="childBirthDate"
            name="childBirthDate"
            required
            type="date"
          />
          <FieldError id="childBirthDate-error" messages={errors.childBirthDate} />
        </div>

        <fieldset className="space-y-2" aria-describedby={errors.childGender ? "childGender-error" : undefined}>
          <legend className="text-sm font-medium">
            성별 <RequiredMark />
          </legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {APPLICATION_GENDER_OPTIONS.map((option) => (
              <label className="flex items-center gap-2 text-sm" key={option.value}>
                <input
                  className="h-4 w-4"
                  defaultChecked={values?.childGender === option.value}
                  name="childGender"
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
          <FieldError id="childGender-error" messages={errors.childGender} />
        </fieldset>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <legend className="px-1 text-base font-semibold">보호자 정보</legend>

        <div className="space-y-1.5">
          <Label htmlFor="guardianName">
            보호자 이름 <RequiredMark />
          </Label>
          <Input
            aria-describedby={errors.guardianName ? "guardianName-error" : undefined}
            aria-invalid={Boolean(errors.guardianName)}
            autoComplete="name"
            defaultValue={values?.guardianName ?? ""}
            id="guardianName"
            maxLength={APPLICATION_NAME_MAX_LENGTH}
            name="guardianName"
            required
          />
          <FieldError id="guardianName-error" messages={errors.guardianName} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="guardianPhone">
            보호자 연락처 <RequiredMark />
          </Label>
          <Input
            aria-describedby={errors.guardianPhone ? "guardianPhone-error" : undefined}
            aria-invalid={Boolean(errors.guardianPhone)}
            autoComplete="tel"
            defaultValue={values?.guardianPhone ?? ""}
            id="guardianPhone"
            inputMode="tel"
            name="guardianPhone"
            placeholder="010-0000-0000"
            required
            type="tel"
          />
          <FieldError id="guardianPhone-error" messages={errors.guardianPhone} />
        </div>

        <fieldset
          aria-describedby={errors.guardianRelationship ? "guardianRelationship-error" : undefined}
          className="space-y-2"
        >
          <legend className="text-sm font-medium">
            아이와의 관계 <RequiredMark />
          </legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {GUARDIAN_RELATIONSHIP_OPTIONS.map((option) => (
              <label className="flex items-center gap-2 text-sm" key={option.value}>
                <input
                  className="h-4 w-4"
                  defaultChecked={values?.guardianRelationship === option.value}
                  name="guardianRelationship"
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
          <FieldError id="guardianRelationship-error" messages={errors.guardianRelationship} />
        </fieldset>
      </fieldset>

      <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-4">
        <Label htmlFor="requestNote">요청사항</Label>
        <p className="text-xs text-slate-500" id="requestNote-guide">
          {APPLICATION_REQUEST_NOTE_GUIDE}
        </p>
        <Textarea
          aria-describedby="requestNote-guide"
          defaultValue={values?.requestNote ?? ""}
          id="requestNote"
          maxLength={APPLICATION_REQUEST_NOTE_MAX_LENGTH}
          name="requestNote"
          rows={4}
        />
        <FieldError id="requestNote-error" messages={errors.requestNote} />
      </div>

      <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <legend className="px-1 text-base font-semibold">확인 및 동의</legend>
        {consentItems.map((item) => (
          <div className="space-y-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0" key={item.key}>
            <p className="text-sm font-semibold">
              {item.required ? "[필수]" : "[선택]"} {item.title}
            </p>
            <Disclosure summary={<span className="underline">내용 보기</span>}>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                {item.body.map((line) => (
                  <li className="break-words" key={line}>
                    {line}
                  </li>
                ))}
              </ul>
            </Disclosure>
            <div className="flex items-start gap-2">
              <Checkbox
                aria-describedby={errors[item.key] ? `${item.key}-error` : undefined}
                className="mt-0.5 shrink-0"
                defaultChecked={Boolean(values?.[item.key])}
                id={item.key}
                name={item.key}
              />
              <Label className="leading-snug" htmlFor={item.key}>
                {item.required ? "[필수]" : "[선택]"} {item.checkLabel}
              </Label>
            </div>
            <FieldError id={`${item.key}-error`} messages={errors[item.key]} />
          </div>
        ))}
      </fieldset>

      {/* 봇 차단용 숨은 입력칸. 화면과 보조기기에서 숨긴다. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="website">웹사이트</label>
        <input autoComplete="off" id="website" name="website" tabIndex={-1} type="text" />
      </div>

      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}

      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "신청 중..." : "신청하기"}
      </Button>
    </form>
  );
}
