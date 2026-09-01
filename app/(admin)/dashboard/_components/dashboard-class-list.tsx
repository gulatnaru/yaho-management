import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getDashboardReservationLabel } from "@/server/dashboard/presentation";
import type { DashboardClassDetail } from "@/server/dashboard/types";

function reservationVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (status === "COMPLETED") return "success";
  if (status === "NO_SHOW") return "warning";
  if (status === "CANCELLED") return "secondary";
  return "default";
}

function ClassCard({ classItem, showReservations }: { classItem: DashboardClassDetail; showReservations: boolean }) {
  return (
    <Card data-testid={`dashboard-class-${classItem.id}`}>
      <CardHeader>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div>
            <CardTitle>
              <Link className="hover:underline" href={`/classes/${classItem.id}`}>{classItem.program.name}</Link>
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">{formatKstDateTimeRange(classItem.startsAt, classItem.endsAt)}</p>
          </div>
          <p className="text-sm tabular-nums">
            운영 {classItem.operationReservationCount}명 · 예약 {classItem.reservedCount}/{classItem.capacity}명 · 남은 자리 {classItem.remainingSeats}명
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">장소</dt><dd>{classItem.location}</dd></div>
          <div><dt className="text-slate-500">담당 선생님</dt><dd>{classItem.teachers.map((teacher) => teacher.name).join(", ") || "미배정"}</dd></div>
        </dl>
        {showReservations ? (
          classItem.reservations.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">예약자가 없습니다.</p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label={`${classItem.program.name} 예약 현황`}>
              {classItem.reservations.map((reservation) => (
                <li className="flex items-center justify-between gap-3 p-3 text-sm" key={reservation.id}>
                  <Link className="font-medium hover:underline" href={`/children/${reservation.child.id}`}>
                    {reservation.child.name}
                  </Link>
                  <Badge variant={reservationVariant(reservation.status)}>
                    {getDashboardReservationLabel(reservation.status, reservation.attendance)}
                  </Badge>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DashboardClassList({
  title,
  description,
  classes,
  showReservations,
  emptyMessage,
}: {
  title: string;
  description: string;
  classes: DashboardClassDetail[];
  showReservations: boolean;
  emptyMessage: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {classes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">{emptyMessage}</div>
      ) : (
        <div className="space-y-3">
          {classes.map((classItem) => <ClassCard classItem={classItem} key={classItem.id} showReservations={showReservations} />)}
        </div>
      )}
    </section>
  );
}
