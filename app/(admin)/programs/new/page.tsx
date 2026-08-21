import Link from "next/link";
import { ProgramForm } from "../_components/program-form";

export default function NewProgramPage() {
  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/programs">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">프로그램 등록</h1>
      <ProgramForm mode="create" />
    </section>
  );
}
