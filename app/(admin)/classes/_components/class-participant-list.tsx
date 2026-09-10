import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { getParticipantPaymentLabel } from "@/lib/payments/participant-summary";
import { canCancelReservation } from "@/lib/reservations/cancellation";
import { getAttendanceLabel, groupClassParticipants } from "@/lib/reservations/participants";
import type { ClassReservationParticipant } from "@/lib/reservations/queries";
import {
  getReservationDisplayStatus,
  type ReservationDisplayStatus,
} from "@/lib/reservations/status";
import { AttendanceForm } from "./attendance-form";

const RESERVATION_LABEL: Record<ReservationDisplayStatus, string> = {
  RESERVED: "예약됨",
  CANCELLED: "취소",
  ENDED: "종료",
  COMPLETED: "참여완료",
  NO_SHOW: "노쇼",
};

const RESERVATION_VARIANT: Record<
  ReservationDisplayStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  RESERVED: "default",
  CANCELLED: "secondary",
  ENDED: "success",
  COMPLETED: "success",
  NO_SHOW: "warning",
};

type ParticipantClassSchedule = {
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  endsAt: Date;
};

function ParticipantCard({
  reservation,
  classSchedule,
}: {
  reservation: ClassReservationParticipant;
  classSchedule: ParticipantClassSchedule;
}) {
  const reservationStatus = getReservationDisplayStatus(reservation, classSchedule);
  const attendanceLabel = getAttendanceLabel(reservation.attendance);
  const paymentLabel = getParticipantPaymentLabel(reservation.paymentItem?.payment.status);
  const safety = reservation.child.safetyInfo;

  return (
    <li className="min-w-0 space-y-4 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="min-w-0 break-all font-medium hover:underline" href={`/children/${reservation.child.id}`}>
          {reservation.child.name}
        </Link>
        {canCancelReservation(reservation, classSchedule) ? (
          <Link className="text-sm text-red-600 hover:underline" href={`/reservations/${reservation.id}/cancel`}>
            예약 취소
          </Link>
        ) : null}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0 space-y-1">
          <dt className="text-slate-500">예약</dt>
          <dd>
            <Badge variant={RESERVATION_VARIANT[reservationStatus]}>{RESERVATION_LABEL[reservationStatus]}</Badge>
          </dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-slate-500">출결</dt>
          <dd>
            <Badge
              variant={
                attendanceLabel === "참석"
                  ? "success"
                  : attendanceLabel === "불참"
                    ? "warning"
                    : "secondary"
              }
            >
              {attendanceLabel}
            </Badge>
          </dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-slate-500">결제</dt>
          <dd>
            <Badge variant={paymentLabel === "결제완료" ? "success" : "secondary"}>{paymentLabel}</Badge>
          </dd>
        </div>
      </dl>

      <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <span>알레르기: {safety?.allergies || "없음"}</span>
        <span>응급 유의사항: {safety?.emergencyNotes || "없음"}</span>
        <span className="break-words">
          비상연락처: {safety?.emergencyContactName || "미입력"} {safety?.emergencyContactPhone || ""}
        </span>
      </div>

      {reservation.attendanceRecordedAt ? (
        <p className="text-xs text-slate-500">
          출결 기록: {reservation.attendanceRecordedBy?.name ?? "알 수 없음"} ·{" "}
          {formatKstDateTime(reservation.attendanceRecordedAt)}
        </p>
      ) : null}

      {classSchedule.status !== "CANCELLED" && reservation.status !== "CANCELLED" ? (
        <AttendanceForm current={reservation.attendance} reservationId={reservation.id} />
      ) : null}
    </li>
  );
}

function ParticipantGroup({
  title,
  items,
  classSchedule,
  emptyText,
}: {
  title: string;
  items: ClassReservationParticipant[];
  classSchedule: ParticipantClassSchedule;
  emptyText: string;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-slate-500">{items.length}명</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
          {items.map((reservation) => (
            <ParticipantCard
              classSchedule={classSchedule}
              key={reservation.id}
              reservation={reservation}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ClassParticipantList({
  reservations,
  classSchedule,
}: {
  reservations: ClassReservationParticipant[];
  classSchedule: ParticipantClassSchedule;
}) {
  const groups = groupClassParticipants(reservations);

  return (
    <Card>
      <CardHeader>
        <CardTitle>참가자 · 출결 · 결제</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ParticipantGroup
          classSchedule={classSchedule}
          emptyText="예약된 아이가 없습니다."
          items={groups.participants}
          title="일반 참가자"
        />
        <ParticipantGroup
          classSchedule={classSchedule}
          emptyText="취소된 예약이 없습니다."
          items={groups.cancelled}
          title="취소 예약"
        />
      </CardContent>
    </Card>
  );
}
