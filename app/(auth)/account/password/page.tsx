import { requirePasswordChangePrincipal } from "@/lib/auth/authorization";
import { PasswordForm } from "./password-form";

export default async function PasswordPage() {
  const principal = await requirePasswordChangePrincipal();

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
      </section>
    </main>
  );
}
