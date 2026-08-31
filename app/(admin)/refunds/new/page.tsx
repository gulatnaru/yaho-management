import Link from "next/link";
import { notFound } from "next/navigation";
import { WarningBanner } from "@/components/ui/warning-banner";
import { formatKrw } from "@/lib/payments/format";
import { getRefundRegistrationContext } from "@/lib/payments/queries";
import { RefundForm } from "../_components/refund-form";

export default async function NewRefundPage({ searchParams }: { searchParams: Promise<{ paymentItemId?: string }> }) {
  const { paymentItemId } = await searchParams;
  if (!paymentItemId) notFound();
  const item = await getRefundRegistrationContext(paymentItemId);
  if (!item) notFound();
  const remaining = item.paidAmount - item.refundedAmount;
  const isNoShow = item.reservation.status === "NO_SHOW" || item.reservation.attendance === "ABSENT";
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href={`/payments/${item.payment.id}`}>결제 상세로</Link><div><h1 className="text-2xl font-bold">환불 등록</h1><p className="mt-1 text-sm text-slate-500">{item.reservation.child.name} · 남은 환불 가능 금액 {formatKrw(remaining)}</p></div>{isNoShow ? <WarningBanner>노쇼 예약의 예외 환불입니다. 상세 사유를 반드시 기록해주세요.</WarningBanner> : null}{remaining > 0 ? <RefundForm isNoShow={isNoShow} paymentItemId={item.id} remainingAmount={remaining} /> : <p>남은 환불 가능 금액이 없습니다.</p>}</section>;
}
