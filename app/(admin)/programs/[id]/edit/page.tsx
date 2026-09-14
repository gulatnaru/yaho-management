import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { getProgramAdminDetail, getProgramOperationalDetail } from "@/lib/programs/queries";
import { ProgramForm } from "../../_components/program-form";

interface EditProgramPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProgramPage({ params }: EditProgramPageProps) {
  const { id } = await params;
  const principal = await requireOperationalPrincipal();
  const isAdmin = principal.role === "ADMIN";
  const program = isAdmin
    ? await getProgramAdminDetail(id)
    : await getProgramOperationalDetail(id);

  if (!program) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/programs">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">{program.name} 정보 수정</h1>
      <ProgramForm
        defaultValues={{
          name: program.name,
          description: program.description ?? "",
          targetAgeMin: program.targetAgeMin === null ? "" : String(program.targetAgeMin),
          targetAgeMax: program.targetAgeMax === null ? "" : String(program.targetAgeMax),
          defaultDuration: program.defaultDuration === null ? "" : String(program.defaultDuration),
          ...(isAdmin && "defaultPrice" in program
            ? { defaultPrice: String(program.defaultPrice) }
            : {}),
          memo: program.memo ?? "",
        }}
        mode="edit"
        programId={program.id}
        showDefaultPrice={isAdmin}
      />
    </section>
  );
}
