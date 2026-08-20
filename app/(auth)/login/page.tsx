import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section aria-labelledby="login-title" className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-slate-500">YAHO 관리</p>
        <h1 className="text-2xl font-bold" id="login-title">
          운영자 로그인
        </h1>
        <p className="mt-2 text-sm text-slate-600">운영자 계정으로 로그인해 주세요.</p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
