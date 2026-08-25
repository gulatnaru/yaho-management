import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getReservationDisplayStatus, type ReservationDisplayStatus } from "@/lib/reservations/status";

export type ReservationListStatusValue = "RESERVED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
export type ReservationListRow = { id: string; status: ReservationListStatusValue; child: { id: string; name: string }; classSchedule: { id: string; startsAt: Date; endsAt: Date; status: "SCHEDULED" | "CANCELLED" | "COMPLETED"; program: { id: string; name: string } } };
const LABEL: Record<ReservationDisplayStatus, string> = { RESERVED: "예약됨", CANCELLED: "취소", ENDED: "종료", COMPLETED: "참여완료", NO_SHOW: "노쇼" };
const VARIANT: Record<ReservationDisplayStatus, NonNullable<BadgeProps["variant"]>> = { RESERVED: "default", CANCELLED: "secondary", ENDED: "success", COMPLETED: "success", NO_SHOW: "warning" };

export function ReservationTable({ items }: { items: ReservationListRow[] }) {
  if (items.length === 0) return <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">조건에 맞는 예약이 없습니다.</div>;
  return <Table><TableHeader><TableRow><TableHead>아이 이름</TableHead><TableHead>클래스</TableHead><TableHead>상태</TableHead></TableRow></TableHeader><TableBody>{items.map((reservation) => { const status = getReservationDisplayStatus(reservation, reservation.classSchedule); return <TableRow key={reservation.id}><TableCell><Link className="font-medium hover:underline" href={`/reservations/${reservation.id}`}>{reservation.child.name}</Link></TableCell><TableCell>{reservation.classSchedule.program.name}<span className="block text-xs text-slate-500">{formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}</span></TableCell><TableCell><Badge variant={VARIANT[status]}>{LABEL[status]}</Badge></TableCell></TableRow>; })}</TableBody></Table>;
}
