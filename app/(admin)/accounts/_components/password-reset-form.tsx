"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetAccountPassword, type PasswordResetState } from "../actions";

const INITIAL_STATE: PasswordResetState = {};

export function PasswordResetForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(resetAccountPassword.bind(null, accountId), INITIAL_STATE);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="temporaryPassword">새 임시 비밀번호</Label>
        <Input autoComplete="new-password" id="temporaryPassword" minLength={8} name="temporaryPassword" required type="password" />
        <p className="text-xs text-slate-500">재설정 즉시 기존 세션이 차단되며 다음 로그인 후 비밀번호 변경이 필요합니다.</p>
        {state.errors?.temporaryPassword ? <p className="text-sm text-red-600" role="alert">{state.errors.temporaryPassword[0]}</p> : null}
      </div>
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700" role="status">임시 비밀번호를 재설정했습니다.</p> : null}
      <Button disabled={pending} type="submit">{pending ? "처리 중..." : "비밀번호 재설정"}</Button>
    </form>
  );
}
