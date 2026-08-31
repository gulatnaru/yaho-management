import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateAge } from "@/lib/children/age";
import { getChildConsentSummary } from "@/lib/children/consent/queries";
import type { ConsentType } from "@/lib/children/consent/validation";
import { getChildDetail } from "@/lib/children/queries";
import { getChildSafetyInfo } from "@/lib/children/safety-info/queries";
import { formatKstDate, formatKstDateTime, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";
import { formatKrw } from "@/lib/payments/format";
import { listPaymentItemsByChild } from "@/lib/payments/queries";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import { listReservationsByChild } from "@/lib/reservations/queries";
import { getReservationDisplayStatus, type ReservationDisplayStatus } from "@/lib/reservations/status";
import { toTelHref } from "@/lib/shared/contact";
import { cn } from "@/lib/utils";
import { ConsentForm } from "./consent-form";
import { ChildStatusToggle } from "../_components/child-status-toggle";
import { PlaceholderSection } from "../_components/placeholder-section";

const CONSENT_TYPES: ConsentType[] = ["PRIVACY", "SENSITIVE_INFO", "PHOTO_SHARE", "PHOTO_MARKETING"];
const CONSENT_LABEL: Record<ConsentType, string> = { PRIVACY: "개인정보 수집·이용", SENSITIVE_INFO: "민감정보 수집", PHOTO_SHARE: "활동 사진 보호자 공유", PHOTO_MARKETING: "사진 홍보·마케팅" };
const STATUS_LABEL: Record<ReservationDisplayStatus, string> = { RESERVED: "예약됨", CANCELLED: "취소", ENDED: "종료", COMPLETED: "참여완료", NO_SHOW: "노쇼" };
const STATUS_VARIANT: Record<ReservationDisplayStatus, NonNullable<BadgeProps["variant"]>> = { RESERVED: "default", CANCELLED: "secondary", ENDED: "success", COMPLETED: "success", NO_SHOW: "warning" };

export default async function ChildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [child, reservations, safetyInfo, consent, paymentItems] = await Promise.all([getChildDetail(id), listReservationsByChild(id), getChildSafetyInfo(id), getChildConsentSummary(id), listPaymentItemsByChild(id)]);
  if (!child) notFound();

  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">아이 목록으로</Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><h1 className="text-2xl font-bold">{child.name}</h1><div className="flex flex-wrap gap-2">{child.isActive ? <Link className={cn(buttonVariants())} href={`/reservations/new?childId=${child.id}`}>예약 추가</Link> : null}<Link className={cn(buttonVariants())} href={`/children/${child.id}/edit`}>정보 수정</Link><ChildStatusToggle id={child.id} isActive={child.isActive} /></div></div>
      <Card><CardHeader><CardTitle>기본 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">생년월일</p><p>{child.birthDate ? `${child.birthDate.toISOString().slice(0, 10)} (만 ${calculateAge(child.birthDate)}세)` : "미입력"}</p></div><div><p className="text-sm text-slate-500">성별</p><p>{child.gender === "MALE" ? "남아" : child.gender === "FEMALE" ? "여아" : "미지정"}</p></div><div><p className="text-sm text-slate-500">보호자</p><p>{child.guardianName ?? "미입력"}</p></div><div><p className="text-sm text-slate-500">보호자 연락처</p><p>{child.guardianPhone ? <a className="hover:underline" href={toTelHref(child.guardianPhone)}>{child.guardianPhone}</a> : "미입력"}</p></div><div><p className="text-sm text-slate-500">상태</p><p>{child.isActive ? "활성" : "비활성"}</p></div><div><p className="text-sm text-slate-500">등록일</p><p>{child.registeredAt.toISOString().slice(0, 10)}</p></div></CardContent></Card>
      <Card><CardHeader><CardTitle>운영 메모</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm text-slate-700">{child.memo || "메모가 없습니다."}</p></CardContent></Card>
      <Card><CardHeader><CardTitle>안전 정보</CardTitle></CardHeader><CardContent className="space-y-3">{safetyInfo ? <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">알레르기 및 주의사항</p><p className="whitespace-pre-wrap">{safetyInfo.allergies || "없음"}</p></div><div><p className="text-sm text-slate-500">응급 시 유의사항</p><p className="whitespace-pre-wrap">{safetyInfo.emergencyNotes || "없음"}</p></div><div><p className="text-sm text-slate-500">비상연락처</p><p>{safetyInfo.emergencyContactName || "미입력"} {safetyInfo.emergencyContactRelation ? `(${safetyInfo.emergencyContactRelation})` : ""}</p></div><div><p className="text-sm text-slate-500">전화번호</p><p>{safetyInfo.emergencyContactPhone || "미입력"}</p></div><div className="text-xs text-slate-500 sm:col-span-2">최종 수정: {safetyInfo.updatedBy?.name ?? "알 수 없음"} · {formatKstDate(safetyInfo.updatedAt)} {formatKstTime(safetyInfo.updatedAt)}</div></div> : <p className="text-sm text-slate-500">등록된 안전 정보가 없습니다.</p>}<Link className={cn(buttonVariants(), "bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100")} href={`/children/${id}/safety`}>안전 정보 수정</Link></CardContent></Card>
      <Card><CardHeader><CardTitle>동의 현황 및 이력</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 sm:grid-cols-2">{CONSENT_TYPES.map((type) => { const record = consent.current.get(type); return <div className="flex items-center justify-between rounded-md border p-3 text-sm" key={type}><span>{CONSENT_LABEL[type]}</span><Badge variant={record?.action === "AGREED" ? "success" : "secondary"}>{record?.action === "AGREED" ? "동의" : record ? "철회" : "미기록"}</Badge></div>; })}</div><ConsentForm childId={id} />{consent.history.length > 0 ? <details><summary className="cursor-pointer text-sm font-medium">전체 이력 보기 ({consent.history.length})</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{consent.history.map((record) => <li key={record.id}>{CONSENT_LABEL[record.consentType as ConsentType]} · {record.action === "AGREED" ? "동의" : "철회"} · {formatKstDateTime(record.recordedAt)} · {record.recordedBy?.name ?? "알 수 없음"}</li>)}</ul></details> : null}</CardContent></Card>
      <Card><CardHeader><CardTitle>예약 이력</CardTitle></CardHeader><CardContent>{reservations.length === 0 ? <p className="text-sm text-slate-500">예약 이력이 없습니다.</p> : <ul className="space-y-2">{reservations.map((reservation) => { const status = getReservationDisplayStatus(reservation, reservation.classSchedule); return <li className="flex items-center justify-between gap-3 text-sm" key={reservation.id}><Link className="font-medium hover:underline" href={`/classes/${reservation.classSchedule.id}`}>{reservation.classSchedule.program.name}<span className="block text-xs text-slate-500">{formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}</span></Link><span className="flex items-center gap-3"><Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>{canCancelReservation(reservation, reservation.classSchedule) ? <Link className="text-red-600 hover:underline" href={`/reservations/${reservation.id}/cancel`}>예약 취소</Link> : null}</span></li>; })}</ul>}</CardContent></Card>
      <Card><CardHeader><CardTitle>결제·환불 이력</CardTitle></CardHeader><CardContent>{paymentItems.length === 0 ? <p className="text-sm text-slate-500">결제 이력이 없습니다.</p> : <ul className="space-y-3">{paymentItems.map((item) => <li className="rounded-md border p-3 text-sm" key={item.id}><div className="flex flex-col justify-between gap-2 sm:flex-row"><Link className="font-medium hover:underline" href={`/payments/${item.payment.id}`}>{item.reservation.classSchedule.program.name}</Link><span>{formatKrw(item.paidAmount)} 결제 · {formatKrw(item.refundedAmount)} 환불</span></div>{item.refunds.length > 0 ? <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-slate-600">{item.refunds.map((refund) => <li key={refund.id}>{formatKstDateTime(refund.refundedAt)} · {formatKrw(refund.amount)} · {refund.reasonDetail || "상세 사유 없음"}</li>)}</ul> : null}</li>)}</ul>}</CardContent></Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><PlaceholderSection description="Phase 7에서 제공 예정" title="친구관계" /><PlaceholderSection description="Phase 7에서 제공 예정" title="형제·자매관계" /></div>
    </section>
  );
}
