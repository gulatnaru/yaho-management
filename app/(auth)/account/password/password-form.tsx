"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  changeOwnPasswordAction,
  type ChangePasswordState,
} from "./actions";

const initialState: ChangePasswordState = {};

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) {
    return null;
  }
  return (
    <p className="text-sm text-red-600" role="alert">
      {messages[0]}
    </p>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="currentPassword">
          현재 비밀번호
        </label>
        <input
          aria-describedby={state.errors?.currentPassword ? "currentPassword-error" : undefined}
          autoComplete="current-password"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900"
          id="currentPassword"
          name="currentPassword"
          required
          type="password"
        />
        <div id="currentPassword-error">
          <FieldError messages={state.errors?.currentPassword} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="newPassword">
          새 비밀번호
        </label>
        <input
          aria-describedby={state.errors?.newPassword ? "newPassword-error" : undefined}
          autoComplete="new-password"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900"
          id="newPassword"
          name="newPassword"
          required
          type="password"
        />
        <div id="newPassword-error">
          <FieldError messages={state.errors?.newPassword} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="confirmPassword">
          새 비밀번호 확인
        </label>
        <input
          aria-describedby={state.errors?.confirmPassword ? "confirmPassword-error" : undefined}
          autoComplete="new-password"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900"
          id="confirmPassword"
          name="confirmPassword"
          required
          type="password"
        />
        <div id="confirmPassword-error">
          <FieldError messages={state.errors?.confirmPassword} />
        </div>
      </div>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "변경 중..." : "비밀번호 변경"}
      </Button>
    </form>
  );
}
