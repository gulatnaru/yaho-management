import Link from "next/link";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { ProgramForm } from "../_components/program-form";

export default async function NewProgramPage() {
  const principal = await requireOperationalPrincipal();

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/programs">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">프로그램 등록</h1>
      <ProgramForm mode="create" showDefaultPrice={principal.role === "ADMIN"} />
    </section>
  );
}
