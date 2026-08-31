import Link from "next/link";
import { PaymentTable } from "./_components/payment-table";
import { listPayments } from "@/lib/payments/queries";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const result = await listPayments(Number(params.page) || 1);
  return <section className="space-y-6"><div><h1 className="text-2xl font-bold">결제·환불</h1><p className="mt-1 text-sm text-slate-500">예약별 결제와 환불 내역을 관리합니다.</p></div>{result.payments.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">등록된 결제가 없습니다. 예약 상세에서 결제를 등록할 수 있습니다.</p> : <PaymentTable payments={result.payments} />}<div className="flex justify-between text-sm">{result.page > 1 ? <Link href={`/payments?page=${result.page - 1}`}>이전</Link> : <span />}{result.page < result.totalPages ? <Link href={`/payments?page=${result.page + 1}`}>다음</Link> : <span />}</div></section>;
}
