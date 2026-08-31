import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatKstDate, formatKstDateTime, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";
import { getClassDetail } from "@/lib/classes/queries";
import { getClassDisplayStatus, type ClassDisplayStatus } from "@/lib/classes/status";
import { isUnderStaffed } from "@/lib/classes/teacher-warning";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import { listReservationsByClassSchedule } from "@/lib/reservations/queries";
import { getReservationDisplayStatus, type ReservationDisplayStatus } from "@/lib/reservations/status";
import { toTelHref } from "@/lib/shared/contact";
import { cn } from "@/lib/utils";
import { AttendanceForm } from "../_components/attendance-form";

const CLASS_LABEL: Record<ClassDisplayStatus, string> = { SCHEDULED: "예정", CANCELLED: "취소", ENDED: "완료" };
const CLASS_VARIANT: Record<ClassDisplayStatus, NonNullable<BadgeProps["variant"]>> = { SCHEDULED: "default", CANCELLED: "secondary", ENDED: "success" };
const RESERVATION_LABEL: Record<ReservationDisplayStatus, string> = { RESERVED: "예약됨", CANCELLED: "취소", ENDED: "종료", COMPLETED: "참여완료", NO_SHOW: "노쇼" };
const RESERVATION_VARIANT: Record<ReservationDisplayStatus, NonNullable<BadgeProps["variant"]>> = { RESERVED: "default", CANCELLED: "secondary", ENDED: "success", COMPLETED: "success", NO_SHOW: "warning" };
const CANCEL_REASON_LABEL: Record<string, string> = { WEATHER: "날씨", SAFETY: "안전 문제", MINIMUM_ENROLLMENT: "최소 인원 미달", OPERATION: "운영 사정", OTHER: "기타" };

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [classDetail, reservations] = await Promise.all([getClassDetail(id), listReservationsByClassSchedule(id)]);
  if (!classDetail) notFound();
  const classStatus = getClassDisplayStatus(classDetail);
  const teacherCount = classDetail.teachers.length;
  const reservedCount = reservations.filter((reservation) => reservation.status === "RESERVED").length;
  const canAddReservation = classStatus === "SCHEDULED" && reservedCount < classDetail.capacity;

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/classes">클래스 목록으로</Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><h1 className="text-2xl font-bold">{formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}</h1><div className="flex flex-wrap gap-2">{canAddReservation ? <Link className={cn(buttonVariants())} href={`/reservations/new?classScheduleId=${id}`}>예약 추가</Link> : null}{classStatus === "SCHEDULED" ? <><Link className={cn(buttonVariants())} href={`/classes/${id}/edit`}>정보 수정</Link><Link className={cn(buttonVariants(), "bg-red-600 hover:bg-red-700")} href={`/classes/${id}/cancel`}>클래스 취소</Link></> : null}</div></div>
      <Card><CardHeader><CardTitle>기본 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">프로그램</p><Link className="hover:underline" href={`/programs/${classDetail.program.id}`}>{classDetail.program.name}</Link></div><div><p className="text-sm text-slate-500">일시</p><p>{formatKstDateTimeRange(classDetail.startsAt, classDetail.endsAt)}</p></div><div><p className="text-sm text-slate-500">장소</p><p>{classDetail.location}</p></div><div><p className="text-sm text-slate-500">정원</p><p>{classDetail.capacity}명</p></div><div><p className="text-sm text-slate-500">예약 인원</p><p>{reservedCount}/{classDetail.capacity}명</p></div><div><p className="text-sm text-slate-500">상태</p><Badge variant={CLASS_VARIANT[classStatus]}>{CLASS_LABEL[classStatus]}</Badge></div></CardContent></Card>
      <Card><CardHeader><CardTitle>보험 및 안전 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">보험 가입</p><p>{classDetail.insured ? "가입" : "미가입"}</p></div><div><p className="text-sm text-slate-500">보험사</p><p>{classDetail.insurer || "미입력"}</p></div><div><p className="text-sm text-slate-500">증권번호</p><p>{classDetail.insurancePolicyNo || "미입력"}</p></div><div className="sm:col-span-2"><p className="text-sm text-slate-500">활동 장소 안전 특이사항</p><p className="whitespace-pre-wrap">{classDetail.safetyMemo || "등록된 메모가 없습니다."}</p></div></CardContent></Card>
      {classDetail.status === "CANCELLED" ? <Card><CardHeader><CardTitle>취소 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">취소 일시</p><p>{classDetail.cancelledAt ? `${formatKstDate(classDetail.cancelledAt)} ${formatKstTime(classDetail.cancelledAt)}` : "-"}</p></div><div><p className="text-sm text-slate-500">취소 사유</p><p>{classDetail.cancelReason ? CANCEL_REASON_LABEL[classDetail.cancelReason] : "-"}</p></div><div><p className="text-sm text-slate-500">처리자</p><p>{classDetail.cancelledBy?.name ?? "-"}</p></div><div className="sm:col-span-2"><p className="text-sm text-slate-500">상세 사유</p><p className="whitespace-pre-wrap">{classDetail.cancelDetail || "상세 사유가 없습니다."}</p></div></CardContent></Card> : null}
      <Card><CardHeader><CardTitle>운영 메모</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm text-slate-700">{classDetail.memo || "메모가 없습니다."}</p></CardContent></Card>
      <Card><CardHeader><CardTitle>담당 선생님</CardTitle></CardHeader><CardContent>{classDetail.teachers.length === 0 ? <p className="text-sm text-slate-500">배정된 선생님이 없습니다.</p> : <ul className="space-y-2">{classDetail.teachers.map((assignment) => <li className="flex justify-between text-sm" key={assignment.id}><span>{assignment.teacher.name}</span>{assignment.teacher.phone ? <a className="hover:underline" href={toTelHref(assignment.teacher.phone)}>{assignment.teacher.phone}</a> : <span className="text-slate-400">연락처 미입력</span>}</li>)}</ul>}</CardContent></Card>
      {isUnderStaffed(teacherCount) ? <WarningBanner>선생님이 {teacherCount}명만 배정되어 있습니다. 원칙은 2명입니다.</WarningBanner> : null}
      <Card><CardHeader><CardTitle>참여 아이 · 안전 정보 · 출결</CardTitle></CardHeader><CardContent>{reservations.length === 0 ? <p className="text-sm text-slate-500">예약된 아이가 없습니다.</p> : <ul className="space-y-4">{reservations.map((reservation) => { const status = getReservationDisplayStatus(reservation, classDetail); const safety = reservation.child.safetyInfo; return <li className="space-y-3 rounded-md border p-3" key={reservation.id}><div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-medium hover:underline" href={`/children/${reservation.child.id}`}>{reservation.child.name}</Link><span className="flex items-center gap-3"><Badge variant={RESERVATION_VARIANT[status]}>{RESERVATION_LABEL[status]}</Badge>{canCancelReservation(reservation, classDetail) ? <Link className="text-red-600 hover:underline" href={`/reservations/${reservation.id}/cancel`}>예약 취소</Link> : null}</span></div><div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3"><span>알레르기: {safety?.allergies || "없음"}</span><span>응급 유의사항: {safety?.emergencyNotes || "없음"}</span><span>비상연락처: {safety?.emergencyContactName || "미입력"} {safety?.emergencyContactPhone || ""}</span></div>{reservation.attendanceRecordedAt ? <p className="text-xs text-slate-500">출결 기록: {reservation.attendanceRecordedBy?.name ?? "알 수 없음"} · {formatKstDateTime(reservation.attendanceRecordedAt)}</p> : null}{classDetail.status !== "CANCELLED" && reservation.status !== "CANCELLED" ? <AttendanceForm current={reservation.attendance} reservationId={reservation.id} /> : null}</li>; })}</ul>}</CardContent></Card>
    </section>
  );
}
