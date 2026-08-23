import Link from "next/link";
import { notFound } from "next/navigation";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getReservationDetail } from "@/lib/reservations/queries";
import { getReservationDisplayStatus } from "@/lib/reservations/status";
import { ReservationCancelForm } from "../../_components/reservation-cancel-form";

interface CancelReservationPageProps {
  params: Promise<{ id: string }>;
}

export default async function CancelReservationPage({ params }: CancelReservationPageProps) {
  const { id } = await params;
  const reservation = await getReservationDetail(id);

  if (!reservation) {
    notFound();
  }

  const backLink = (
    <Link className="text-sm text-slate-500 hover:underline" href={`/reservations/${id}`}>
      ← 예약 상세로
    </Link>
  );

  if (getReservationDisplayStatus(reservation, reservation.classSchedule) !== "RESERVED") {
    return (
      <section className="space-y-6">
        {backLink}
        <h1 className="text-2xl font-bold">예약 취소</h1>
        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-600">
          이미 취소되었거나 종료된 예약입니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {backLink}

      <div>
        <h1 className="text-2xl font-bold">예약 취소</h1>
        <p className="mt-1 text-sm text-slate-500">
          {reservation.child.name} · {reservation.classSchedule.program.name} ·{" "}
          {formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}
        </p>
      </div>

      <ReservationCancelForm reservationId={id} />
    </section>
  );
}
