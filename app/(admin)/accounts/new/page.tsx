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
        <p className="mt-1 text-sm text-slate-500">비밀번호 없이 생성되며, 계정은 비활성 상태로 초대 수락(P3)을 통해 활성화됩니다.</p>
      </div>
      <AccountForm mode="create" teachers={teachers} />
    </section>
  );
}
