import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherDetail } from "@/lib/teachers/queries";
import { TeacherForm } from "../../_components/teacher-form";

interface EditTeacherPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditTeacherPage({ params }: EditTeacherPageProps) {
  const { id } = await params;
  const teacher = await getTeacherDetail(id);

  if (!teacher) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/teachers">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">{teacher.name} 정보 수정</h1>
      <TeacherForm
        defaultValues={{
          name: teacher.name,
          phone: teacher.phone ?? "",
          memo: teacher.memo ?? "",
        }}
        mode="edit"
        teacherId={teacher.id}
      />
    </section>
  );
}
