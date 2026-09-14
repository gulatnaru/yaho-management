import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
import { getAccountDetail, listAvailableAccountTeachers } from "@/server/accounts/queries";
import { AccountForm } from "../../../accounts/_components/account-form";

type EditAccountPageProps = { params: Promise<{ id: string }> };

export default async function EditAccountPage({ params }: EditAccountPageProps) {
  const principal = await requireAdminPrincipal();
  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();

  const teachers = await listAvailableAccountTeachers(detail.account.teacher?.id);
  const protectAdminSelf = principal.userId === detail.account.id && detail.account.role === "ADMIN";

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
        protectAdminSelf={protectAdminSelf}
        teachers={teachers}
      />
    </section>
  );
}
