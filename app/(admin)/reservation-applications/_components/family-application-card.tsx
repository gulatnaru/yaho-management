import Link from "next/link";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { APPLICATION_STATUS_LABEL } from "@/lib/reservation-applications/constants";
import type { FamilyApplication } from "@/lib/reservation-applications/family-queries";
import { familyAnchor, familyDetailHref, type FamilyFilters } from "@/lib/reservation-applications/navigation";
import { ApplicationStateSummary } from "./application-state-summary";

export function FamilyApplicationCard({ family, filters }: { family: FamilyApplication; filters: FamilyFilters }) {
  const classes = [...new Map(family.children.map((child) => [child.classScheduleId, child.classSchedule])).values()];
  return <article className="min-w-0 scroll-mt-6 space-y-4 rounded-lg border bg-white p-4 md:p-6" id={familyAnchor(family.kind, family.id)} data-testid="family-application-card">
    <ApplicationStateSummary family={family} />
    <div className="space-y-2 break-words"><h2 className="font-semibold">보호자 {family.guardianName ?? "파기됨"} · 자녀 {family.children.length}명</h2>
      {family.kind === "legacy" ? <p className="text-sm text-slate-600">기존 방식 · 아이 1명 신청</p> : null}
      <p className="text-sm">{family.children.map((child) => child.childName ?? "파기됨").join(", ")}</p>
      {classes.map((schedule, index) => <p className="text-sm text-slate-600" key={index}>{schedule.program.name} · {formatKstDateTimeRange(schedule.startsAt, schedule.endsAt)}</p>)}
    </div>
    {family.children.some((child) => child.status === "SUBMITTED" && child.isPossibleDuplicate) ? <p className="text-sm text-amber-800">중복 가능 · 같은 클래스의 다른 신청을 상세에서 확인해 주세요.</p> : null}
    <Link className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm text-white md:w-auto" href={familyDetailHref(family.kind, family.id, filters)}>신청 처리하기</Link>
    <details className="group min-w-0 border-t pt-3"><summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium"><span className="group-open:hidden">자녀 {family.children.length}명 펼치기</span><span className="hidden group-open:inline">자녀 접기</span></summary>
      <ul className="space-y-3 pt-2">{family.children.map((child) => <li className="min-w-0 space-y-1 break-words rounded-md bg-slate-50 p-3 text-sm" key={child.id}>
        <p className="font-medium">{child.childName ?? "파기됨"}{child.matchesFilter ? " · 필터 일치" : " · 같은 제출의 자녀"}</p>
        <p>{child.classSchedule.program.name} · {formatKstDateTimeRange(child.classSchedule.startsAt, child.classSchedule.endsAt)}</p>
        <p>{child.quotedAmount === null ? family.kind === "legacy" ? "금액 미기록" : "금액 확인 필요" : `${child.quotedAmount.toLocaleString("ko-KR")}원`} · {APPLICATION_STATUS_LABEL[child.status]}</p>
      </li>)}</ul>
    </details>
  </article>;
}
