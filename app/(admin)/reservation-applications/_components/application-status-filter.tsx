import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { familyListHref, type FamilyFilters } from "@/lib/reservation-applications/navigation";

export function ApplicationStatusFilter({ filters }: { filters: FamilyFilters }) {
  return <form action="/reservation-applications" className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-end" method="get">
    {filters.classScheduleId ? <><input type="hidden" name="classScheduleId" value={filters.classScheduleId} /><Link className="min-h-11 text-sm underline" href={`/classes/${filters.classScheduleId}`}>이 클래스 상세로</Link><a className="inline-flex min-h-11 items-center text-sm underline" href={familyListHref({ ...filters, classScheduleId: undefined, page: 1 })}>클래스 필터 해제</a></> : null}
    <div className="space-y-1.5"><Label htmlFor="status">상태</Label><Select defaultValue={filters.status} id="status" name="status"><option value="SUBMITTED">처리 대기</option><option value="CONFIRMED">확정</option><option value="REJECTED">반려</option><option value="CANCELLED">취소</option><option value="all">전체</option></Select></div>
    <div className="space-y-1.5"><Label htmlFor="notification">보호자 입금 알림</Label><Select defaultValue={filters.notification} id="notification" name="notification"><option value="all">전체</option><option value="received">알림 받음</option><option value="none">알림 없음 (새 방식)</option><option value="legacy">기존 방식 · 미지원</option></Select></div>
    <div className="space-y-1.5"><Label htmlFor="bankRecord">은행 확인 입금</Label><Select defaultValue={filters.bankRecord} id="bankRecord" name="bankRecord"><option value="all">전체</option><option value="recorded">기록 있음</option><option value="none">기록 없음 (새 방식)</option><option value="legacy">기존 방식 · 금액 미기록</option></Select></div>
    <Button className="min-h-11 w-full md:w-auto" type="submit">조회</Button><Link className="inline-flex min-h-11 items-center text-sm underline" href="/reservation-applications?status=all">필터 초기화</Link>
  </form>;
}
