import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKstDate, formatKstDateTimeRange, formatKstTime } from "@/lib/classes/datetime";
import { formatKrw } from "@/lib/payments/format";
import { getPaymentDetail } from "@/lib/payments/queries";
import { cn } from "@/lib/utils";

const STATUS_LABEL = { PAID: "결제완료", PARTIAL_REFUNDED: "부분환불", REFUNDED: "전액환불", CANCELLED: "취소" } as const;
const METHOD_LABEL = { CARD: "카드", TRANSFER: "계좌이체", CASH: "현금", OTHER: "기타" } as const;
const REASON_LABEL: Record<string, string> = { PERSONAL: "개인 사정", ILLNESS: "질병", WEATHER: "날씨", SCHEDULE: "일정 변경", DUPLICATE_PAYMENT: "중복 결제", CLASS_CANCELLED: "클래스 취소", OPERATION: "운영 사정", OTHER: "기타" };
const REFUND_STATUS_LABEL = { REQUESTED: "요청", COMPLETED: "완료", CANCELLED: "취소" } as const;

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await getPaymentDetail(id);
  if (!payment) notFound();
  return <section className="space-y-6"><Link className="text-sm text-slate-500 hover:underline" href="/payments">결제 목록으로</Link><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><h1 className="text-2xl font-bold">결제 상세</h1><Badge>{STATUS_LABEL[payment.status]}</Badge></div><Card><CardHeader><CardTitle>결제 정보</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-slate-500">결제수단</p><p>{METHOD_LABEL[payment.method]}</p></div><div><p className="text-sm text-slate-500">결제일시</p><p>{formatKstDate(payment.paidAt)} {formatKstTime(payment.paidAt)}</p></div><div><p className="text-sm text-slate-500">결제자</p><p>{payment.payerName || "미입력"}</p></div><div><p className="text-sm text-slate-500">총 실결제액</p><p>{formatKrw(payment.totalAmount)}</p></div></CardContent></Card>{payment.items.map((item) => { const remaining = item.paidAmount - item.refundedAmount; return <Card key={item.id}><CardHeader><CardTitle>{item.reservation.child.name} · {item.reservation.classSchedule.program.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-slate-500">{formatKstDateTimeRange(item.reservation.classSchedule.startsAt, item.reservation.classSchedule.endsAt)}</p><div className="grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-slate-500">정가</p><p>{formatKrw(item.amount)}</p></div><div><p className="text-xs text-slate-500">할인</p><p>{formatKrw(item.discountAmount)}</p></div><div><p className="text-xs text-slate-500">환불 누계</p><p>{formatKrw(item.refundedAmount)}</p></div><div><p className="text-xs text-slate-500">환불 가능</p><p>{formatKrw(remaining)}</p></div></div>{remaining > 0 ? <Link className={cn(buttonVariants(), "w-full md:w-auto")} href={`/refunds/new?paymentItemId=${item.id}`}>환불 등록</Link> : null}<div><h3 className="font-medium">환불 이력</h3>{item.refunds.length === 0 ? <p className="mt-2 text-sm text-slate-500">환불 이력이 없습니다.</p> : <ul className="mt-2 space-y-2">{item.refunds.map((refund) => <li className="rounded-md border p-3 text-sm" key={refund.id}><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><span>{REASON_LABEL[refund.reason]}</span><Badge variant={refund.status === "COMPLETED" ? "success" : refund.status === "CANCELLED" ? "secondary" : "warning"}>{REFUND_STATUS_LABEL[refund.status]}</Badge></span><strong>{formatKrw(refund.amount)}</strong></div><p className="mt-1 text-xs text-slate-500">{formatKstDate(refund.refundedAt)} {formatKstTime(refund.refundedAt)} · {refund.processedBy?.name ?? "알 수 없음"}</p>{refund.reasonDetail ? <p className="mt-2 whitespace-pre-wrap">{refund.reasonDetail}</p> : null}</li>)}</ul>}</div></CardContent></Card>; })}</section>;
}
