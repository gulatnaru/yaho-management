import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { listAccounts } from "@/server/accounts/queries";
import { AccountTable } from "./_components/account-table";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts();

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">계정 관리</h1>
          <p className="mt-1 text-sm text-slate-500">내부 운영자의 역할과 활성 상태를 관리합니다.</p>
        </div>
        <Link className={buttonVariants()} href="/accounts/new">계정 생성</Link>
      </div>
      <p className="text-sm text-slate-500">총 {accounts.length}개</p>
      <AccountTable accounts={accounts} />
    </section>
  );
}
