import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKstDate, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";
import { getReservationDetail } from "@/lib/reservations/queries";
import { getReservationDisplayStatus, type ReservationDisplayStatus } from "@/lib/reservations/status";
import { cn } from "@/lib/utils";

const LABEL: Record<ReservationDisplayStatus, string> = {
  RESERVED: "예약됨",
  CANCELLED: "취소",
  ENDED: "종료",
  COMPLETED: "참여완료",
  NO_SHOW: "노쇼",
};
const VARIANT: Record<ReservationDisplayStatus, NonNullable<BadgeProps["variant"]>> = {
  RESERVED: "default",
  CANCELLED: "secondary",
  ENDED: "success",
  COMPLETED: "success",
  NO_SHOW: "warning",
};
const CANCEL_REASON_LABEL: Record<string, string> = {
  PERSONAL: "개인 사정",
  ILLNESS: "질병",
  SCHEDULE: "일정 변경",
  WEATHER: "날씨",
  DUPLICATE: "중복 예약",
  OPERATION: "운영 사정",
  OTHER: "기타",
};

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reservation = await getReservationDetail(id);
  if (!reservation) notFound();

  const status = getReservationDisplayStatus(reservation, reservation.classSchedule);

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/reservations">예약 목록으로</Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{reservation.child.name} 예약</h1>
        {status === "RESERVED" ? <Link className={cn(buttonVariants(), "bg-red-600 hover:bg-red-700")} href={`/reservations/${id}/cancel`}>예약 취소</Link> : null}
      </div>

      <Card>
        <CardHeader><CardTitle>예약 정보</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-sm text-slate-500">아이</p><p><Link className="hover:underline" href={`/children/${reservation.child.id}`}>{reservation.child.name}</Link>{!reservation.child.isActive ? <Badge className="ml-2" variant="secondary">비활성</Badge> : null}</p></div>
          <div><p className="text-sm text-slate-500">클래스</p><Link className="hover:underline" href={`/classes/${reservation.classSchedule.id}`}>{reservation.classSchedule.program.name}</Link></div>
          <div><p className="text-sm text-slate-500">일시</p><p>{formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}</p></div>
          <div><p className="text-sm text-slate-500">장소</p><p>{reservation.classSchedule.location}</p></div>
          <div><p className="text-sm text-slate-500">상태</p><Badge variant={VARIANT[status]}>{LABEL[status]}</Badge></div>
          <div><p className="text-sm text-slate-500">예약 일시</p><p>{formatKstDate(reservation.reservedAt)} {formatKstTime(reservation.reservedAt)}</p></div>
          <div><p className="text-sm text-slate-500">출결</p><p>{reservation.attendance === "PRESENT" ? "참석" : reservation.attendance === "ABSENT" ? "불참" : "미기록"}</p></div>
          {reservation.attendanceRecordedAt ? <div><p className="text-sm text-slate-500">출결 기록</p><p>{reservation.attendanceRecordedBy?.name ?? "알 수 없음"} · {formatKstDate(reservation.attendanceRecordedAt)} {formatKstTime(reservation.attendanceRecordedAt)}</p></div> : null}
        </CardContent>
      </Card>

      {reservation.status === "CANCELLED" ? <Card><CardHeader><CardTitle>취소 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">취소 일시</p><p>{reservation.cancelledAt ? `${formatKstDate(reservation.cancelledAt)} ${formatKstTime(reservation.cancelledAt)}` : "-"}</p></div><div><p className="text-sm text-slate-500">취소 사유</p><p>{reservation.cancelReason ? CANCEL_REASON_LABEL[reservation.cancelReason] : "-"}</p></div><div><p className="text-sm text-slate-500">처리자</p><p>{reservation.cancelledBy?.name ?? "-"}</p></div><div className="sm:col-span-2"><p className="text-sm text-slate-500">상세 사유</p><p className="whitespace-pre-wrap">{reservation.cancelDetail || "상세 사유가 없습니다."}</p></div></CardContent></Card> : null}

      <Card><CardHeader><CardTitle>예약 메모</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm text-slate-700">{reservation.memo || "메모가 없습니다."}</p></CardContent></Card>
    </section>
  );
}
