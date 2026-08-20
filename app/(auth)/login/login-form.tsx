"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          이메일
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900"
          id="email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password">
          비밀번호
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none ring-offset-2 focus:ring-2 focus:ring-slate-900"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>
      {state.error ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "로그인 중..." : "로그인"}
      </Button>
    </form>
  );
}
