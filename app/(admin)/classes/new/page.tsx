import Link from "next/link";
import { listProgramCandidates, listTeacherCandidates } from "@/lib/classes/candidates";
import { ClassForm } from "../_components/class-form";

export default async function NewClassPage() {
  const [programCandidates, teacherCandidates] = await Promise.all([
    listProgramCandidates(),
    listTeacherCandidates(),
  ]);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/classes">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">클래스 등록</h1>
      <ClassForm mode="create" programCandidates={programCandidates} teacherCandidates={teacherCandidates} />
    </section>
  );
}
