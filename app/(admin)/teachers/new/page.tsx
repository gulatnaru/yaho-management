import Link from "next/link";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { TeacherForm } from "../_components/teacher-form";

export default async function NewTeacherPage() {
  await requireOperationalPrincipal();
  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/teachers">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">선생님 등록</h1>
      <TeacherForm mode="create" />
    </section>
  );
}
