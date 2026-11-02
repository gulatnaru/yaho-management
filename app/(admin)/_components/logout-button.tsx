"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

/**
 * 관리자 공통 로그아웃 버튼. NavDrawer가 역할과 무관하게 렌더링하므로
 * 모든 역할(ADMIN·SUPER_ADMIN·MANAGER·TEACHER·STAFF)에서 동일하게 동작한다.
 * 역할 조건을 두지 않는다.
 *
 * 동작: signOut({ redirectTo: "/login", redirect: false })로 세션을 먼저 끊은 뒤
 * /api/auth/session을 직접 조회해 세션 소멸을 확인하고 나서만 /login으로 이동한다.
 * 기본 redirect: true는 응답이 파싱만 되면 세션 잔존 여부와 무관하게 이동하므로,
 * 실패 시 "로그아웃된 것처럼 보이는" 상태를 만들 수 있어 사용하지 않는다.
 * 세션 조회는 실패와 소멸을 구분한다: 응답이 ok가 아니거나 네트워크·파싱에
 * 실패하면 조회 실패로 보고, 200 응답의 본문이 null이거나 user가 없는 객체면
 * 소멸로 본다. 조회 실패·세션 잔존 시에는 이동하지 않고 버튼을 다시
 * 활성화하고 일반 문구만 표시한다. 토큰·이메일·에러 내부는 노출하지 않는다.
 * (getSession()은 조회 실패 시에도 null을 반환해 실패와 소멸을 구분할 수
 * 없으므로 사용하지 않는다.)
 */
export function LogoutButton({ className, tabIndex }: { className?: string; tabIndex?: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut({ redirectTo: "/login", redirect: false });
      let checkFailed = false;
      let sessionUser: unknown = undefined;
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) checkFailed = true;
        else sessionUser = (await res.json() as { user?: unknown } | null)?.user;
      } catch {
        checkFailed = true;
      }
      if (checkFailed || sessionUser !== undefined) {
        throw new Error("logout verification failed");
      }
      window.location.href = "/login";
    } catch {
      setPending(false);
      setError("로그아웃에 실패했습니다. 다시 시도해 주세요.");
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <button
        className="text-sm text-slate-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
        disabled={pending}
        onClick={handleLogout}
        tabIndex={tabIndex}
        type="button"
      >
        {pending ? "로그아웃 중..." : "로그아웃"}
      </button>
      {error ? (
        <span aria-live="polite" className="text-xs text-red-600" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
