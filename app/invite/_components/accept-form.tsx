"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitation, type InvitationAcceptState } from "../actions";

const INITIAL_STATE: InvitationAcceptState = {};

export function AcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation.bind(null, token), INITIAL_STATE);

  if (state.success) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-emerald-700" role="status">
          초대를 수락했습니다. 설정한 비밀번호로 로그인해주세요.
        </p>
        <Link className="text-sm text-slate-600 underline" href="/login">
          로그인 페이지로 이동
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="password">새 비밀번호 *</Label>
        <Input autoComplete="new-password" id="password" minLength={8} name="password" required type="password" />
        <p className="text-xs text-slate-500">8~128자</p>
        {state.errors?.password ? <p className="text-sm text-red-600" role="alert">{state.errors.password[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">새 비밀번호 확인 *</Label>
        <Input autoComplete="new-password" id="confirmPassword" minLength={8} name="confirmPassword" required type="password" />
        {state.errors?.confirmPassword ? <p className="text-sm text-red-600" role="alert">{state.errors.confirmPassword[0]}</p> : null}
      </div>
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      <Button disabled={pending} type="submit">{pending ? "처리 중..." : "비밀번호 설정하고 계정 활성화"}</Button>
    </form>
  );
}
