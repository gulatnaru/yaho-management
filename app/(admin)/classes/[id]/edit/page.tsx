import Link from "next/link";
import { notFound } from "next/navigation";
import { listProgramCandidates, listTeacherCandidates } from "@/lib/classes/candidates";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import { getClassDetail } from "@/lib/classes/queries";
import { getClassDisplayStatus } from "@/lib/classes/status";
import { ClassForm } from "../../_components/class-form";

interface EditClassPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClassPage({ params }: EditClassPageProps) {
  const { id } = await params;
  const classDetail = await getClassDetail(id);

  if (!classDetail) {
    notFound();
  }

  const backLink = (
    <Link className="text-sm text-slate-500 hover:underline" href={`/classes/${id}`}>
      ← 클래스 상세로
    </Link>
  );

  if (getClassDisplayStatus(classDetail) !== "SCHEDULED") {
    return (
      <section className="space-y-6">
        {backLink}
        <h1 className="text-2xl font-bold">클래스 정보 수정</h1>
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-600">
          취소되었거나 종료된 클래스는 수정할 수 없습니다.
        </p>
      </section>
    );
  }

  const currentTeacherIds = classDetail.teachers.map((assignment) => assignment.teacherId);

  const [programCandidates, teacherCandidates] = await Promise.all([
    listProgramCandidates(classDetail.programId),
    listTeacherCandidates(currentTeacherIds),
  ]);

  return (
    <section className="space-y-6">
      {backLink}

      <h1 className="text-2xl font-bold">클래스 정보 수정</h1>
      <ClassForm
        classId={classDetail.id}
        defaultValues={{
          programId: classDetail.programId,
          date: formatKstDate(classDetail.startsAt),
          startTime: formatKstTime(classDetail.startsAt),
          endTime: formatKstTime(classDetail.endsAt),
          location: classDetail.location,
          capacity: String(classDetail.capacity),
          teacherIds: currentTeacherIds,
          memo: classDetail.memo ?? "",
          insured: classDetail.insured,
          insurer: classDetail.insurer ?? "",
          insurancePolicyNo: classDetail.insurancePolicyNo ?? "",
          safetyMemo: classDetail.safetyMemo ?? "",
        }}
        mode="edit"
        programCandidates={programCandidates}
        teacherCandidates={teacherCandidates}
      />
    </section>
  );
}
