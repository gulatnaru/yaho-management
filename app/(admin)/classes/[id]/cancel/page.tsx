import Link from "next/link";
import { notFound } from "next/navigation";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getClassDetail } from "@/lib/classes/queries";
import { ClassCancelForm } from "../../_components/class-cancel-form";

interface CancelClassPageProps {
  params: Promise<{ id: string }>;
}

export default async function CancelClassPage({ params }: CancelClassPageProps) {
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

  if (classDetail.status !== "SCHEDULED") {
    return (
      <section className="space-y-6">
        {backLink}
        <h1 className="text-2xl font-bold">클래스 취소</h1>
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-600">
          이미 취소되었거나 완료된 클래스입니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {backLink}

      <div>
        <h1 className="text-2xl font-bold">클래스 취소</h1>
        <p className="mt-1 text-sm text-slate-500">
          {classDetail.program.name} · {formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}
        </p>
      </div>

      <p className="text-sm text-slate-600">
        취소된 클래스는 되돌릴 수 없습니다. 개별 예약은 취소되지 않으니 필요 시 예약 화면에서 별도로 처리해주세요.
      </p>

      <ClassCancelForm classId={id} />
    </section>
  );
}
