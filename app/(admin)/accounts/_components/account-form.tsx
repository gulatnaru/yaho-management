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
  // P2: SUPER_ADMIN 행은 상세 화면에서 조회되지만 일반 경로로는 변경할 수 없으므로,
  // 폼은 읽기 전용으로 렌더링하고 제출 수단을 제공하지 않는다 (서버 코어 거부와 이중 방어).
  role: AccountRole | "SUPER_ADMIN";
  teacherId: string;
  isActive: boolean;
};

type AccountFormProps = {
  mode: "create" | "edit";
  accountId?: string;
  teachers: TeacherOption[];
  defaultValues?: AccountFormDefaultValues;
};

const ROLE_LABELS: Record<AccountRole, string> = {
  ADMIN: "관리자",
  MANAGER: "준관리자",
  TEACHER: "선생님",
  // P2: 일반 생성·수정 선택지에서 SUPER_ADMIN은 제외된다 (코어에서 서버 강제 거부).
  STAFF: "직원",
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
}: AccountFormProps) {
  const action = mode === "edit" && accountId ? updateAccount.bind(null, accountId) : createAccount;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [role, setRole] = useState<AccountRole | "SUPER_ADMIN">(defaultValues.role);

  const value = <K extends keyof AccountFormDefaultValues>(key: K) =>
    state.values?.[key] ?? defaultValues[key];

  // P2: 최고관리자 행은 일반 경로로 어떤 변경도 할 수 없으므로 폼 자체를 제출하지 않는다.
  // 본인 보호(protectAdminSelf)는 P2에서 소멸했다 — ADMIN은 계정 관리에 접근하지 않고,
  // SUPER_ADMIN 본인 행도 이 읽기 전용 분기로 처리된다.
  if (mode === "edit" && defaultValues.role === "SUPER_ADMIN") {
    return (
      <div className="max-w-xl space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="name">이름</Label>
          <Input defaultValue={defaultValues.name} disabled id="name" name="name" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">이메일</Label>
          <Input defaultValue={defaultValues.email} disabled id="email" name="email" type="email" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role">역할</Label>
          <Input defaultValue="최고관리자" disabled id="role" name="role" />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox defaultChecked={defaultValues.isActive} disabled id="isActive" name="isActive" />
          <Label htmlFor="isActive">활성 계정</Label>
        </div>

        <p className="text-sm text-slate-500" role="note">
          최고관리자 계정은 일반 경로로 변경할 수 없습니다. 최고관리자 권한 변경·복구는
          별도 고위험 절차(P3-2/P7) 대상입니다.
        </p>
      </div>
    );
  }

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
        <Select
          id="role"
          name="role"
          onChange={(event) => setRole(event.target.value as AccountRole)}
          value={role}
        >
          {ACCOUNT_ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
        </Select>
        {state.errors?.role ? <p className="text-sm text-red-600" role="alert">{state.errors.role[0]}</p> : null}
      </div>

      {role === "TEACHER" ? (
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
        <p className="text-sm text-slate-500" role="note">
          비밀번호 없이 생성됩니다. 계정은 비활성 상태로 생성되며, 초대 수락(P3)을 통해
          활성화됩니다. 임시 비밀번호 전달 경로는 없습니다.
        </p>
      ) : null}

      {mode === "edit" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            defaultChecked={Boolean(value("isActive"))}
            id="isActive"
            name="isActive"
          />
          <Label htmlFor="isActive">활성 계정</Label>
        </div>
      ) : null}

      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}

      <Button className="w-full sm:w-auto" disabled={pending} type="submit">
        {pending ? "저장 중..." : mode === "create" ? "계정 생성" : "변경사항 저장"}
      </Button>
    </form>
  );
}
