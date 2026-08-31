import Link from "next/link";
import { notFound } from "next/navigation";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getPaymentRegistrationContext } from "@/lib/payments/queries";
import { PaymentForm } from "../_components/payment-form";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ reservationId?: string }> }) {
  const { reservationId } = await searchParams;
  if (!reservationId) notFound();
  const reservation = await getPaymentRegistrationContext(reservationId);
  if (!reservation) notFound();
  if (reservation.paymentItem) return <section className="space-y-4"><Link className="text-sm text-slate-500 hover:underline" href={`/reservations/${reservationId}`}>예약 상세로</Link><h1 className="text-2xl font-bold">결제 등록</h1><p>이미 결제가 등록된 예약입니다.</p><Link className="hover:underline" href={`/payments/${reservation.paymentItem.paymentId}`}>결제 상세 보기</Link></section>;
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href={`/reservations/${reservationId}`}>예약 상세로</Link><div><h1 className="text-2xl font-bold">결제 등록</h1><p className="mt-1 text-sm text-slate-500">{reservation.child.name} · {reservation.classSchedule.program.name} · {formatKstDateTimeRange(reservation.classSchedule.startsAt, reservation.classSchedule.endsAt)}</p></div><PaymentForm defaultPayerName={reservation.child.guardianName} reservationId={reservation.id} /></section>;
}
