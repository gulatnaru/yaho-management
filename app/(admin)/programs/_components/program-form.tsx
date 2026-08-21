"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProgram, updateProgram, type ProgramFormState } from "../actions";

export type ProgramFormDefaultValues = {
  name: string;
  description: string;
  targetAgeMin: string;
  targetAgeMax: string;
  defaultDuration: string;
  defaultPrice: string;
  status: "ACTIVE" | "INACTIVE";
  memo: string;
};

export interface ProgramFormProps {
  mode: "create" | "edit";
  programId?: string;
  defaultValues?: ProgramFormDefaultValues;
}

const emptyDefaults: ProgramFormDefaultValues = {
  name: "",
  description: "",
  targetAgeMin: "",
  targetAgeMax: "",
  defaultDuration: "",
  defaultPrice: "0",
  status: "ACTIVE",
  memo: "",
};

const initialState: ProgramFormState = {};

export function ProgramForm({ mode, programId, defaultValues = emptyDefaults }: ProgramFormProps) {
  const action = mode === "edit" && programId ? updateProgram.bind(null, programId) : createProgram;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">
          프로그램명 <span className="text-red-600">*</span>
        </Label>
        <Input defaultValue={defaultValues.name} id="name" name="name" required />
        {state.errors?.name ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">설명</Label>
        <Textarea defaultValue={defaultValues.description} id="description" name="description" rows={3} />
        {state.errors?.description ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.description[0]}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="targetAgeMin">대상연령 최소</Label>
          <Input
            defaultValue={defaultValues.targetAgeMin}
            id="targetAgeMin"
            min={0}
            name="targetAgeMin"
            step={1}
            type="number"
          />
          {state.errors?.targetAgeMin ? (
            <p className="text-sm text-red-600" role="alert">
              {state.errors.targetAgeMin[0]}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="targetAgeMax">대상연령 최대</Label>
          <Input
            defaultValue={defaultValues.targetAgeMax}
            id="targetAgeMax"
            min={0}
            name="targetAgeMax"
            step={1}
            type="number"
          />
          {state.errors?.targetAgeMax ? (
            <p className="text-sm text-red-600" role="alert">
              {state.errors.targetAgeMax[0]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="defaultDuration">기본 소요시간(분)</Label>
        <Input
          defaultValue={defaultValues.defaultDuration}
          id="defaultDuration"
          min={1}
          name="defaultDuration"
          step={1}
          type="number"
        />
        {state.errors?.defaultDuration ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.defaultDuration[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="defaultPrice">기본가격(원)</Label>
        <Input
          defaultValue={defaultValues.defaultPrice}
          id="defaultPrice"
          min={0}
          name="defaultPrice"
          step={1}
          type="number"
        />
        {state.errors?.defaultPrice ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.defaultPrice[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">운영상태</Label>
        <Select defaultValue={defaultValues.status} id="status" name="status">
          <option value="ACTIVE">활성</option>
          <option value="INACTIVE">비활성</option>
        </Select>
        {state.errors?.status ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.status[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="memo">메모</Label>
        <Textarea defaultValue={defaultValues.memo} id="memo" name="memo" rows={4} />
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
