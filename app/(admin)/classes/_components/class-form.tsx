"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProgramCandidate, TeacherCandidate } from "@/lib/classes/candidates";
import { CAPACITY_MAX, CAPACITY_MIN } from "@/lib/validation/class";
import { createClass, updateClass, type ClassFormState } from "../actions";

export type ClassFormDefaultValues = {
  programId: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  capacity: string;
  teacherIds: string[];
  memo: string;
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
  capacity: String(CAPACITY_MAX),
  teacherIds: [],
  memo: "",
};

const initialState: ClassFormState = {};

export function ClassForm({
  mode,
  classId,
  programCandidates,
  teacherCandidates,
  defaultValues = emptyDefaults,
}: ClassFormProps) {
  const action = mode === "edit" && classId ? updateClass.bind(null, classId) : createClass;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
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
        {state.errors?.programId ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.programId[0]}
          </p>
        ) : null}
      </div>

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
        {state.errors?.date ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.date[0]}
          </p>
        ) : null}
      </div>

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
          {state.errors?.startTime ? (
            <p className="text-sm text-red-600" role="alert">
              {state.errors.startTime[0]}
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
          {state.errors?.endTime ? (
            <p className="text-sm text-red-600" role="alert">
              {state.errors.endTime[0]}
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
        {state.errors?.location ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.location[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="capacity">정원</Label>
        <Input
          defaultValue={state.values?.capacity ?? defaultValues.capacity}
          id="capacity"
          max={CAPACITY_MAX}
          min={CAPACITY_MIN}
          name="capacity"
          step={1}
          type="number"
        />
        {state.errors?.capacity ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.capacity[0]}
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
        {state.errors?.teacherIds ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.teacherIds[0]}
          </p>
        ) : null}
      </fieldset>

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
        {pending ? "저장 중..." : mode === "create" ? "등록" : "저장"}
      </Button>
    </form>
  );
}
