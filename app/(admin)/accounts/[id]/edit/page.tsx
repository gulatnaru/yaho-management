import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccountManagementPrincipal } from "@/lib/auth/authorization";
import { getAccountDetail, listAvailableAccountTeachers } from "@/server/accounts/queries";
import { AccountForm } from "../../../accounts/_components/account-form";

type EditAccountPageProps = { params: Promise<{ id: string }> };

export default async function EditAccountPage({ params }: EditAccountPageProps) {
  // 단순화 결정(ADR-071): 계정 관리 진입점은 역할만 보는 가드
  // (requireAccountManagementPrincipal — ADMIN 또는 SUPER_ADMIN)를 쓴다.
  // 모드는 판정하지 않으며, SUPER_ADMIN 행도 일반 폼으로 편집할 수 있다.
  await requireAccountManagementPrincipal();
  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();

  const teachers = await listAvailableAccountTeachers(detail.account.teacher?.id);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href={`/accounts/${id}`}>← 계정 상세로</Link>
      <h1 className="text-2xl font-bold">계정 수정</h1>
      <AccountForm
        accountId={id}
        defaultValues={{
          name: detail.account.name,
          email: detail.account.email,
          role: detail.account.role,
          teacherId: detail.account.teacher?.id ?? "",
          isActive: detail.account.isActive,
        }}
        mode="edit"
        teachers={teachers}
      />
    </section>
  );
}
