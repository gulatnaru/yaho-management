"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTeacher, updateTeacher, type TeacherFormState } from "../actions";

export type TeacherFormDefaultValues = {
  name: string;
  phone: string;
  memo: string;
};

export interface TeacherFormProps {
  mode: "create" | "edit";
  teacherId?: string;
  defaultValues?: TeacherFormDefaultValues;
}

const emptyDefaults: TeacherFormDefaultValues = {
  name: "",
  phone: "",
  memo: "",
};

const initialState: TeacherFormState = {};

export function TeacherForm({ mode, teacherId, defaultValues = emptyDefaults }: TeacherFormProps) {
  const action = mode === "edit" && teacherId ? updateTeacher.bind(null, teacherId) : createTeacher;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">
          이름 <span className="text-red-600">*</span>
        </Label>
        <Input defaultValue={defaultValues.name} id="name" name="name" required />
        {state.errors?.name ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">연락처</Label>
        <Input defaultValue={defaultValues.phone} id="phone" name="phone" placeholder="010-1234-5678" />
        {state.errors?.phone ? (
          <p className="text-sm text-red-600" role="alert">
            {state.errors.phone[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="memo">운영 메모</Label>
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
