import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccountManagementPrincipal } from "@/lib/auth/authorization";
import { getAccountDetail, listAvailableAccountTeachers } from "@/server/accounts/queries";
import { AccountForm } from "../../../accounts/_components/account-form";

type EditAccountPageProps = { params: Promise<{ id: string }> };

export default async function EditAccountPage({ params }: EditAccountPageProps) {
  // P2-S: 계정 관리 진입점은 모드별 가드(requireAccountManagementPrincipal)를 쓴다.
  // LEGACY_ADMIN 모드에서는 ADMIN이, SUPER_ADMIN 모드에서는 SUPER_ADMIN이 진입한다.
  // 본인 보호는 폼·코어에서 처리한다 — SUPER_ADMIN 본인 행은 폼이 읽기 전용으로
  // 렌더링하고, 코어는 본인 변경을 거부한다.
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
