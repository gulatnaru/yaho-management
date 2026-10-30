import Link from "next/link";
import { requirePasswordChangePrincipal } from "@/lib/auth/authorization";
import { PasswordForm } from "./password-form";

export default async function PasswordPage() {
  const principal = await requirePasswordChangePrincipal();
  // P2 (OQ-12): 본인 이력 페이지는 표시만 연결하고, 접근 권한은 서버 쿼리가 검사한다.
  // MANAGER·TEACHER에게는 링크를 노출하지 않는다 (직접 URL 접근 시에도 서버에서 거부된다).
  const canViewOwnHistory =
    principal.role === "SUPER_ADMIN" || principal.role === "ADMIN" || principal.role === "STAFF";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section aria-labelledby="password-title" className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-slate-500">YAHO 계정</p>
        <h1 className="text-2xl font-bold" id="password-title">
          비밀번호 변경
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {principal.mustChangePassword
            ? "운영 기능을 사용하기 전에 임시 비밀번호를 변경해 주세요."
            : "현재 비밀번호를 확인한 뒤 새 비밀번호를 설정해 주세요."}
        </p>
        <div className="mt-6">
          <PasswordForm />
        </div>
        {canViewOwnHistory ? (
          <p className="mt-6 text-sm">
            <Link className="text-slate-500 hover:underline" href="/account/history">내 계정 변경 이력 보기 →</Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
