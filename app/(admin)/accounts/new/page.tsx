import Link from "next/link";
import { AccountForm } from "../_components/account-form";
import { listAvailableAccountTeachers } from "@/server/accounts/queries";

export default async function NewAccountPage() {
  const teachers = await listAvailableAccountTeachers();

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/accounts">← 목록으로</Link>
      <div>
        <h1 className="text-2xl font-bold">계정 생성</h1>
        <p className="mt-1 text-sm text-slate-500">임시 비밀번호는 저장 후 다시 확인할 수 없습니다.</p>
      </div>
      <AccountForm mode="create" teachers={teachers} />
    </section>
  );
}
