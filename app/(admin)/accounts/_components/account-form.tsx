"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ACCOUNT_ROLES, type AccountRole } from "@/lib/validation/accounts";
import { createAccount, updateAccount, type AccountFormState } from "../actions";

type TeacherOption = { id: string; name: string };

export type AccountFormDefaultValues = {
  name: string;
  email: string;
  role: AccountRole;
  teacherId: string;
  isActive: boolean;
};

type AccountFormProps = {
  mode: "create" | "edit";
  accountId?: string;
  teachers: TeacherOption[];
  defaultValues?: AccountFormDefaultValues;
  protectAdminSelf?: boolean;
};

const ROLE_LABELS: Record<AccountRole, string> = {
  ADMIN: "관리자",
  MANAGER: "준관리자",
  TEACHER: "선생님",
};

const EMPTY_VALUES: AccountFormDefaultValues = {
  name: "",
  email: "",
  role: "MANAGER",
  teacherId: "",
  isActive: true,
};

const INITIAL_STATE: AccountFormState = {};

export function AccountForm({
  mode,
  accountId,
  teachers,
  defaultValues = EMPTY_VALUES,
  protectAdminSelf = false,
}: AccountFormProps) {
  const action = mode === "edit" && accountId ? updateAccount.bind(null, accountId) : createAccount;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [role, setRole] = useState<AccountRole>(defaultValues.role);

  const value = <K extends keyof AccountFormDefaultValues>(key: K) =>
    state.values?.[key] ?? defaultValues[key];

  return (
    <form action={formAction} className="max-w-xl space-y-6" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">이름 *</Label>
        <Input defaultValue={value("name")} id="name" name="name" required />
        {state.errors?.name ? <p className="text-sm text-red-600" role="alert">{state.errors.name[0]}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">이메일 *</Label>
        <Input autoComplete="email" defaultValue={value("email")} id="email" name="email" required type="email" />
        {state.errors?.email ? <p className="text-sm text-red-600" role="alert">{state.errors.email[0]}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">역할 *</Label>
        {protectAdminSelf ? <input name="role" type="hidden" value="ADMIN" /> : null}
        <Select
          disabled={protectAdminSelf}
          id="role"
          name={protectAdminSelf ? undefined : "role"}
          onChange={(event) => setRole(event.target.value as AccountRole)}
          value={protectAdminSelf ? "ADMIN" : role}
        >
          {ACCOUNT_ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
        </Select>
        {protectAdminSelf ? <p className="text-xs text-slate-500">본인의 관리자 역할은 변경할 수 없습니다.</p> : null}
        {state.errors?.role ? <p className="text-sm text-red-600" role="alert">{state.errors.role[0]}</p> : null}
      </div>

      {role === "TEACHER" && !protectAdminSelf ? (
        <div className="space-y-1.5">
          <Label htmlFor="teacherId">연결 선생님 *</Label>
          <Select defaultValue={value("teacherId")} id="teacherId" name="teacherId" required>
            <option value="">선생님을 선택하세요</option>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </Select>
          {state.errors?.teacherId ? <p className="text-sm text-red-600" role="alert">{state.errors.teacherId[0]}</p> : null}
        </div>
      ) : null}

      {mode === "create" ? (
        <div className="space-y-1.5">
          <Label htmlFor="temporaryPassword">임시 비밀번호 *</Label>
          <Input autoComplete="new-password" id="temporaryPassword" minLength={8} name="temporaryPassword" required type="password" />
          <p className="text-xs text-slate-500">8~128자. 사용자는 로그인 후 반드시 새 비밀번호로 변경해야 합니다.</p>
          {state.errors?.temporaryPassword ? <p className="text-sm text-red-600" role="alert">{state.errors.temporaryPassword[0]}</p> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {protectAdminSelf ? <input name="isActive" type="hidden" value="on" /> : null}
        <Checkbox
          defaultChecked={protectAdminSelf ? true : Boolean(value("isActive"))}
          disabled={protectAdminSelf}
          id="isActive"
          name={protectAdminSelf ? undefined : "isActive"}
        />
        <Label htmlFor="isActive">활성 계정</Label>
      </div>
      {protectAdminSelf ? <p className="text-xs text-slate-500">본인 계정은 비활성화할 수 없습니다.</p> : null}

      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}

      <Button className="w-full sm:w-auto" disabled={pending} type="submit">
        {pending ? "저장 중..." : mode === "create" ? "계정 생성" : "변경사항 저장"}
      </Button>
    </form>
  );
}
