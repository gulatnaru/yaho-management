import Link from "next/link";
import { getChildDetail } from "@/lib/children/queries";
import { getClassDetail } from "@/lib/classes/queries";
import { listActiveChildCandidates, listScheduledClassCandidatesWithCapacity } from "@/lib/reservations/candidates";
import { resolveChildPrefillWarning, resolveClassPrefillWarning } from "@/lib/reservations/prefill-warning";
import { ReservationForm } from "../_components/reservation-form";

interface NewReservationPageProps {
  searchParams: Promise<{ classScheduleId?: string; childId?: string }>;
}

export default async function NewReservationPage({ searchParams }: NewReservationPageProps) {
  const resolvedParams = await searchParams;

  const [childCandidates, classCandidates] = await Promise.all([
    listActiveChildCandidates(),
    listScheduledClassCandidatesWithCapacity(),
  ]);

  // 클래스/아이 쿼리 파라미터가 후보 목록에 없으면(취소/완료/정원마감/비활성/존재하지 않음 등)
  // 왜 선택되지 않았는지 사용자에게 알려준다(폼 제출 자체를 막지는 않는다).
  let classPrefillWarning: string | undefined;
  if (
    resolvedParams.classScheduleId &&
    !classCandidates.some((classItem) => classItem.id === resolvedParams.classScheduleId)
  ) {
    const classDetail = await getClassDetail(resolvedParams.classScheduleId);
    classPrefillWarning = resolveClassPrefillWarning(classDetail) ?? undefined;
  }

  let childPrefillWarning: string | undefined;
  if (resolvedParams.childId && !childCandidates.some((child) => child.id === resolvedParams.childId)) {
    const childDetail = await getChildDetail(resolvedParams.childId);
    childPrefillWarning = resolveChildPrefillWarning(childDetail) ?? undefined;
  }

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/reservations">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">예약 등록</h1>
      <ReservationForm
        childCandidates={childCandidates}
        childPrefillWarning={childPrefillWarning}
        classCandidates={classCandidates}
        classPrefillWarning={classPrefillWarning}
        defaultValues={{
          classScheduleId: resolvedParams.classScheduleId ?? "",
          childId: resolvedParams.childId ?? "",
          memo: "",
        }}
      />
    </section>
  );
}
