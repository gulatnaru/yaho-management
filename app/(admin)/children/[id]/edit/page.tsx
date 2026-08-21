import Link from "next/link";
import { notFound } from "next/navigation";
import { getChildDetail } from "@/lib/children/queries";
import { ChildForm } from "../../_components/child-form";

interface EditChildPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditChildPage({ params }: EditChildPageProps) {
  const { id } = await params;
  const child = await getChildDetail(id);

  if (!child) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">{child.name} 정보 수정</h1>
      <ChildForm
        childId={child.id}
        defaultValues={{
          name: child.name,
          birthDate: child.birthDate ? child.birthDate.toISOString().slice(0, 10) : "",
          gender: child.gender,
          guardianName: child.guardianName ?? "",
          guardianPhone: child.guardianPhone ?? "",
          memo: child.memo ?? "",
        }}
        mode="edit"
      />
    </section>
  );
}
