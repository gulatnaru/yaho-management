"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CLASS_CAPACITY_DEFAULT,
  CLASS_CAPACITY_MAX,
  CLASS_CAPACITY_MIN,
} from "@/lib/classes/capacity";
import type { ProgramCandidate, TeacherCandidate } from "@/lib/classes/candidates";
import { CLASS_WEEKDAY_OPTIONS } from "@/lib/classes/recurrence";
import {
  getRecurringClassFormInput,
  recurringClassInputSchema,
  type ClassRegistrationMode,
} from "@/lib/validation/class";
import {
  createClass,
  updateClass,
  type ClassFormFieldKey,
  type ClassFormState,
} from "../actions";
import { loadLatestInsurancePrefill } from "../insurance-actions";

export type ClassFormDefaultValues = {
  programId: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  capacity: string;
  teacherIds: string[];
  memo: string;
  insured?: boolean;
  insurer?: string;
  insurancePolicyNo?: string;
  safetyMemo?: string;
};

export interface ClassFormProps {
  mode: "create" | "edit";
  classId?: string;
  programCandidates: ProgramCandidate[];
  teacherCandidates: TeacherCandidate[];
  defaultValues?: ClassFormDefaultValues;
}

const emptyDefaults: ClassFormDefaultValues = {
  programId: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  capacity: String(CLASS_CAPACITY_DEFAULT),
  teacherIds: [],
  memo: "",
  insured: false,
  insurer: "",
  insurancePolicyNo: "",
  safetyMemo: "",
};

const initialState: ClassFormState = {};

type RecurringPreview = {
  repeatStartDate: string;
  repeatEndDate: string;
  weekdays: number[];
  dates: string[];
};

export function ClassForm({
  mode,
  classId,
  programCandidates,
  teacherCandidates,
  defaultValues = emptyDefaults,
}: ClassFormProps) {
  const action = mode === "edit" && classId ? updateClass.bind(null, classId) : createClass;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [registrationMode, setRegistrationMode] = useState<ClassRegistrationMode>(
    state.values?.registrationMode ?? "single",
  );
  const [recurringPreview, setRecurringPreview] = useState<RecurringPreview | null>(null);
  const [previewErrors, setPreviewErrors] = useState<
    Partial<Record<ClassFormFieldKey, string[]>>
  >({});
  const [insurance, setInsurance] = useState({
    insured: defaultValues.insured ?? false,
    insurer: defaultValues.insurer ?? "",
    insurancePolicyNo: defaultValues.insurancePolicyNo ?? "",
    safetyMemo: defaultValues.safetyMemo ?? "",
  });
  const [prefillPending, startPrefill] = useTransition();

  const fieldErrors = { ...state.errors, ...previewErrors };

  function invalidateRecurringPreview() {
    setRecurringPreview(null);
    setPreviewErrors({});
  }

  function selectRegistrationMode(nextMode: ClassRegistrationMode) {
    setRegistrationMode(nextMode);
    invalidateRecurringPreview();
  }

  function previewRecurringClasses() {
    if (!formRef.current) return;

    const result = recurringClassInputSchema.safeParse(
      getRecurringClassFormInput(new FormData(formRef.current)),
    );
    if (!result.success) {
      setRecurringPreview(null);
      setPreviewErrors(
        result.error.flatten().fieldErrors as Partial<Record<ClassFormFieldKey, string[]>>,
      );
      return;
    }

    setPreviewErrors({});
    setRecurringPreview({
      repeatStartDate: result.data.repeatStartDate,
      repeatEndDate: result.data.repeatEndDate,
      weekdays: result.data.weekdays,
      dates: result.data.targetDates,
    });
  }

  function applyLatestInsurance() {
    startPrefill(async () => {
      const latest = await loadLatestInsurancePrefill(classId);
      if (latest) {
        setInsurance({ insured: latest.insured, insurer: latest.insurer ?? "", insurancePolicyNo: latest.insurancePolicyNo ?? "", safetyMemo: latest.safetyMemo ?? "" });
        invalidateRecurringPreview();
      }
    });
  }

  return (
    <form
      action={formAction}
      className="max-w-xl space-y-6"
      noValidate
      onChange={
        mode === "create" && registrationMode === "recurring"
          ? invalidateRecurringPreview
          : undefined
      }
      ref={formRef}
    >
      {mode === "create" ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium leading-none" id="registration-mode-legend">
            등록 방식
          </legend>
          <div
            aria-labelledby="registration-mode-legend"
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
          >
            {[
              { value: "single" as const, label: "단건 등록" },
              { value: "recurring" as const, label: "반복 등록" },
            ].map((option) => (
              <label
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-900"
                key={option.value}
              >
                <input
                  defaultChecked={registrationMode === option.value}
                  key={`${option.value}:${registrationMode}`}
                  name="registrationMode"
                  onChange={() => selectRegistrationMode(option.value)}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="programId">
          프로그램 <span className="text-red-600">*</span>
        </Label>
        <Select
          defaultValue={state.values?.programId ?? defaultValues.programId}
          id="programId"
          name="programId"
          required
        >
          <option disabled value="">
            프로그램을 선택하세요
          </option>
          {programCandidates.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </Select>
        {fieldErrors.programId ? (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.programId[0]}
          </p>
        ) : null}
      </div>

      {mode === "edit" || registrationMode === "single" ? (
        <div className="space-y-1.5">
          <Label htmlFor="date">
            날짜 <span className="text-red-600">*</span>
          </Label>
          <Input
            defaultValue={state.values?.date ?? defaultValues.date}
            id="date"
            name="date"
            required
            type="date"
          />
          {fieldErrors.date ? (
            <p className="text-sm text-red-600" role="alert">
              {fieldErrors.date[0]}
            </p>
          ) : null}
        </div>
      ) : (
        <fieldset className="space-y-4 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold">반복 일정</legend>
          <p className="text-sm text-slate-500">
            같은 달 안에서 시작일과 종료일을 정하고 반복할 요일을 선택해주세요.
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="repeatStartDate">
                시작일 <span className="text-red-600">*</span>
              </Label>
              <Input
                defaultValue={state.values?.repeatStartDate ?? ""}
                id="repeatStartDate"
                name="repeatStartDate"
                required
                type="date"
              />
              {fieldErrors.repeatStartDate ? (
                <p className="text-sm text-red-600" role="alert">
                  {fieldErrors.repeatStartDate[0]}
                </p>
              ) : null}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="repeatEndDate">
                종료일 <span className="text-red-600">*</span>
              </Label>
              <Input
                defaultValue={state.values?.repeatEndDate ?? ""}
                id="repeatEndDate"
                name="repeatEndDate"
                required
                type="date"
              />
              {fieldErrors.repeatEndDate ? (
                <p className="text-sm text-red-600" role="alert">
                  {fieldErrors.repeatEndDate[0]}
                </p>
              ) : null}
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              반복 요일 <span className="text-red-600">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CLASS_WEEKDAY_OPTIONS.map((weekday) => (
                <label
                  className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  key={weekday.value}
                >
                  <Checkbox
                    defaultChecked={(state.values?.weekdays ?? []).includes(String(weekday.value))}
                    key={`${weekday.value}:${(state.values?.weekdays ?? []).join(",")}`}
                    name="weekdays"
                    value={weekday.value}
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
            {fieldErrors.weekdays ? (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.weekdays[0]}
              </p>
            ) : null}
          </fieldset>
        </fieldset>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="startTime">
            시작 시간 <span className="text-red-600">*</span>
          </Label>
          <Input
            defaultValue={state.values?.startTime ?? defaultValues.startTime}
            id="startTime"
            name="startTime"
            required
            type="time"
          />
          {fieldErrors.startTime ? (
            <p className="text-sm text-red-600" role="alert">
              {fieldErrors.startTime[0]}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="endTime">
            종료 시간 <span className="text-red-600">*</span>
          </Label>
          <Input
            defaultValue={state.values?.endTime ?? defaultValues.endTime}
            id="endTime"
            name="endTime"
            required
            type="time"
          />
          {fieldErrors.endTime ? (
            <p className="text-sm text-red-600" role="alert">
              {fieldErrors.endTime[0]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="location">
          장소 <span className="text-red-600">*</span>
        </Label>
        <Input
          defaultValue={state.values?.location ?? defaultValues.location}
          id="location"
          name="location"
          required
        />
        {fieldErrors.location ? (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.location[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="capacity">정원</Label>
        <Input
          defaultValue={state.values?.capacity ?? defaultValues.capacity}
          id="capacity"
          max={CLASS_CAPACITY_MAX}
          min={CLASS_CAPACITY_MIN}
          name="capacity"
          step={1}
          type="number"
        />
        {fieldErrors.capacity ? (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.capacity[0]}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium leading-none">
          선생님 <span className="text-red-600">*</span>
        </legend>
        <p className="text-sm text-slate-500">최소 1명 이상 배정해주세요. (원칙은 2명입니다)</p>
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          {teacherCandidates.length === 0 ? (
            <p className="text-sm text-slate-500">배정 가능한 선생님이 없습니다.</p>
          ) : (
            teacherCandidates.map((teacher) => (
              <label className="flex items-center gap-2 text-sm" key={teacher.id}>
                <Checkbox
                  defaultChecked={(state.values?.teacherIds ?? defaultValues.teacherIds).includes(teacher.id)}
                  name="teacherIds"
                  value={teacher.id}
                />
                {teacher.name}
              </label>
            ))
          )}
        </div>
        {fieldErrors.teacherIds ? (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.teacherIds[0]}
          </p>
        ) : null}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="memo">메모</Label>
        <Textarea defaultValue={state.values?.memo ?? defaultValues.memo} id="memo" name="memo" rows={4} />
        {fieldErrors.memo ? (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.memo[0]}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">보험 및 안전 메모</legend>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={insurance.insured}
              name="insured"
              onChange={(event) =>
                setInsurance((current) => ({ ...current, insured: event.target.checked }))
              }
            />
            보험 가입
          </label>
          <Button disabled={prefillPending} onClick={applyLatestInsurance} type="button">
            {prefillPending ? "불러오는 중..." : "직전 클래스 값 불러오기"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="insurer">보험사</Label>
            <Input
              id="insurer"
              name="insurer"
              onChange={(event) =>
                setInsurance((current) => ({ ...current, insurer: event.target.value }))
              }
              value={insurance.insurer}
            />
            {fieldErrors.insurer ? (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.insurer[0]}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="insurancePolicyNo">증권번호</Label>
            <Input
              id="insurancePolicyNo"
              name="insurancePolicyNo"
              onChange={(event) =>
                setInsurance((current) => ({ ...current, insurancePolicyNo: event.target.value }))
              }
              value={insurance.insurancePolicyNo}
            />
            {fieldErrors.insurancePolicyNo ? (
              <p className="text-sm text-red-600" role="alert">
                {fieldErrors.insurancePolicyNo[0]}
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="safetyMemo">활동 장소 안전 특이사항</Label>
          <Textarea
            id="safetyMemo"
            name="safetyMemo"
            onChange={(event) =>
              setInsurance((current) => ({ ...current, safetyMemo: event.target.value }))
            }
            rows={3}
            value={insurance.safetyMemo}
          />
          {fieldErrors.safetyMemo ? (
            <p className="text-sm text-red-600" role="alert">
              {fieldErrors.safetyMemo[0]}
            </p>
          ) : null}
        </div>
      </fieldset>

      {state.formError ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.formError}
        </p>
      ) : null}

      {mode === "create" && registrationMode === "recurring" ? (
        <div className="space-y-4">
          <Button
            className="w-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 sm:w-auto"
            disabled={pending}
            onClick={previewRecurringClasses}
            type="button"
          >
            생성 일정 미리보기
          </Button>

          {recurringPreview ? (
            <section
              aria-labelledby="recurring-preview-title"
              aria-live="polite"
              className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4"
            >
              <div className="space-y-1">
                <h2 className="font-semibold" id="recurring-preview-title">
                  생성 일정 미리보기
                </h2>
                <p className="text-sm text-slate-600">
                  {recurringPreview.repeatStartDate} ~ {recurringPreview.repeatEndDate} ·{" "}
                  {recurringPreview.weekdays
                    .map(
                      (value) =>
                        CLASS_WEEKDAY_OPTIONS.find((weekday) => weekday.value === value)?.label,
                    )
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="text-sm font-medium">총 {recurringPreview.dates.length}개 클래스</p>
              </div>
              <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {recurringPreview.dates.map((date) => (
                  <li className="min-w-0 break-words rounded bg-white px-2 py-1.5" key={date}>
                    {date}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {recurringPreview ? (
            <Button className="w-full sm:w-auto" disabled={pending} type="submit">
              {pending ? "등록 중..." : `${recurringPreview.dates.length}개 클래스 등록`}
            </Button>
          ) : null}
        </div>
      ) : (
        <Button className="w-full sm:w-auto" disabled={pending} type="submit">
          {pending ? "저장 중..." : mode === "create" ? "등록" : "저장"}
        </Button>
      )}
    </form>
  );
}
