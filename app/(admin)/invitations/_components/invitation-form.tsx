"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ACCOUNT_ROLES, type AccountRole } from "@/lib/validation/accounts";
import { issueInvitation, type InvitationFormState } from "../actions";

type TeacherOption = { id: string; name: string };

const ROLE_LABELS: Record<AccountRole, string> = {
  SUPER_ADMIN: "최고관리자",
  ADMIN: "관리자",
  MANAGER: "준관리자",
  TEACHER: "선생님",
  STAFF: "직원",
};

const INITIAL_STATE: InvitationFormState = {};

export function InvitationForm({ teachers }: { teachers: TeacherOption[] }) {
  const [state, formAction, pending] = useActionState(issueInvitation, INITIAL_STATE);
  const [role, setRole] = useState<AccountRole>("MANAGER");

  const value = (key: "name" | "email" | "role" | "teacherId") => state.values?.[key] ?? "";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">이름 *</Label>
        <Input defaultValue={value("name")} id="name" name="name" required />
        {state.errors?.name ? <p className="text-sm text-red-600" role="alert">{state.errors.name[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">이메일 *</Label>
        <Input defaultValue={value("email")} id="email" name="email" required type="email" />
        {state.errors?.email ? <p className="text-sm text-red-600" role="alert">{state.errors.email[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">역할 *</Label>
        <Select
          defaultValue={value("role") || "MANAGER"}
          id="role"
          name="role"
          onChange={(event) => setRole(event.target.value as AccountRole)}
          required
        >
          {ACCOUNT_ROLES.map((roleOption) => (
            <option key={roleOption} value={roleOption}>{ROLE_LABELS[roleOption]}</option>
          ))}
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
      <p className="text-xs text-slate-500">
        초대 링크는 72시간 동안 1회만 유효합니다. 발송 요청 결과는 목록에서 확인할 수 있습니다.
      </p>
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700" role="status">발송 요청 접수</p> : null}
      <Button disabled={pending} type="submit">{pending ? "처리 중..." : "초대 발급"}</Button>
    </form>
  );
}
