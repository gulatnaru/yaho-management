"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createChild, updateChild, type ChildFormState } from "../actions";

export type ChildFormDefaultValues = {
  name: string;
  birthDate: string;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  guardianName: string;
  guardianPhone: string;
  memo: string;
};

export interface ChildFormProps {
  mode: "create" | "edit";
  childId?: string;
  defaultValues?: ChildFormDefaultValues;
}

const emptyDefaults: ChildFormDefaultValues = {
  name: "",
  birthDate: "",
  gender: "UNSPECIFIED",
  guardianName: "",
  guardianPhone: "",
  memo: "",
};

const initialState: ChildFormState = {};

export function ChildForm({ mode, childId, defaultValues = emptyDefaults }: ChildFormProps) {
  const action = mode === "edit" && childId ? updateChild.bind(null, childId) : createChild;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">
          이름 <span className="text-red-600">*</span>
        </Label>
        <Input defaultValue={state.values?.name ?? defaultValues.name} id="name" name="name" required />
        {state.errors?.name ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="birthDate">생년월일</Label>
        <Input
          defaultValue={state.values?.birthDate ?? defaultValues.birthDate}
          id="birthDate"
          name="birthDate"
          type="date"
        />
        {state.errors?.birthDate ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.birthDate[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gender">성별</Label>
        <Select
          defaultValue={(state.values?.gender as ChildFormDefaultValues["gender"]) ?? defaultValues.gender}
          id="gender"
          name="gender"
        >
          <option value="UNSPECIFIED">선택 안 함</option>
          <option value="MALE">남</option>
          <option value="FEMALE">여</option>
        </Select>
        {state.errors?.gender ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.gender[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guardianName">보호자 이름</Label>
        <Input
          defaultValue={state.values?.guardianName ?? defaultValues.guardianName}
          id="guardianName"
          name="guardianName"
        />
        {state.errors?.guardianName ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.guardianName[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guardianPhone">보호자 연락처</Label>
        <Input
          defaultValue={state.values?.guardianPhone ?? defaultValues.guardianPhone}
          id="guardianPhone"
          name="guardianPhone"
          placeholder="010-1234-5678"
        />
        {state.errors?.guardianPhone ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.guardianPhone[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="memo">운영 메모</Label>
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
