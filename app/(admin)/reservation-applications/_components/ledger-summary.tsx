import Link from "next/link";
import { formatKstDateTime } from "@/lib/classes/datetime";
import type { ApplicationWorkflowDetail } from "@/lib/reservation-applications/detail-queries";

const money = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const returnLabel = { REJECTED: "반려 신청 반환", CANCELLED: "취소 신청 반환", EXCESS: "초과 입금 반환" };
export function LedgerSummary({ detail }: { detail: ApplicationWorkflowDetail }) {
  const { ledger } = detail;
  return <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]" data-testid="detail-ledger">
    {ledger.state === "available" ? <><dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{([
      ["Q · 신청 당시 고정액 합계", ledger.Q], ["D · 실제 확인 입금 누계", ledger.D], ["P · 예약 결제 배정액", ledger.P],
      ["R · 아직 반환할 금액", ledger.R], ["T · 이미 반환한 금액", ledger.T], ["A · 예약·후속 처리 가용액", ledger.A],
    ] as const).map(([label, amount]) => <div className="rounded border p-3" key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="font-semibold">{money(amount)}</dd></div>)}</dl><p className="text-xs text-slate-500">D = A + P + R + T · 반환 배정액에는 이미 반환한 금액이 포함됩니다. 실제 입금이 있어도 예약 확정 가능 여부는 별도 검증합니다.</p></> : <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"><p>금액 원장을 검증할 수 없습니다. 미확정 금액 또는 원장 기록을 확인해주세요.</p><p>가용액을 표시할 수 없습니다. 아래 원본 기록을 확인하고 다시 조회해주세요.</p></div>}
    <details className="rounded border p-3"><summary className="min-h-11 cursor-pointer py-2">실제 입금 및 배정 거래 내역 ({detail.deposits.length}건)</summary><div className="space-y-3 text-sm">{detail.deposits.length ? detail.deposits.map((deposit) => <article className="space-y-1 rounded border p-3" key={deposit.id}><h3 className="font-semibold">입금 기록 {deposit.id}</h3><p>실제 입금자 {detail.personalDataPurgedAt ? "개인정보 파기됨" : deposit.payerName ?? "개인정보 파기됨"} · {money(deposit.amount)}</p><p>입금일시 {formatKstDateTime(deposit.depositedAt)} · 확인일시 {formatKstDateTime(deposit.confirmedAt)} · 확인자 {deposit.confirmedBy.name ?? "기록 없음"}</p>{deposit.allocations.length ? <ul className="space-y-2">{deposit.allocations.map((allocation) => {
      const application = detail.applications.find((item) => item.paymentMapping?.id === allocation.paymentMappingId);
      return <li key={allocation.id}>배정 {allocation.id} · {money(allocation.amount)} · {formatKstDateTime(allocation.createdAt)} · {allocation.paymentMappingId ? application?.paymentMapping ? <Link className="underline" href={`/payments/${application.paymentMapping.paymentItem.paymentId}`}>예약 결제 배정</Link> : "결제 연결 확인 필요" : <a className="underline" href={`#return-${allocation.returnObligationId}`}>예약 전 반환 배정</a>}</li>;
    })}</ul> : <p>배정 기록 없음</p>}</article>) : <p>실제 입금 기록이 없습니다.</p>}</div></details>
    <div className="space-y-3"><h3 className="font-semibold">예약 확정 전 반환 내역</h3><p className="text-sm text-slate-600">실제 송금은 운영자가 별도로 처리합니다. 확정 후 환불(Refund)은 이 원장 가용액을 늘리지 않습니다.</p>{detail.returnObligations.length ? detail.returnObligations.map((obligation) => <article className="space-y-2 rounded border p-3 text-sm" id={`return-${obligation.id}`} tabIndex={-1} key={obligation.id}><h4 className="font-semibold">{returnLabel[obligation.kind]} · {obligation.id}</h4><p>반환 배정 원금 {money(obligation.amount)} · 완료 반환 {money(obligation.returnedAmount)} · {obligation.resolvedAt ? `처리 완료 ${formatKstDateTime(obligation.resolvedAt)}` : "처리 대기"}</p>{obligation.returns.length ? <ul className="space-y-2">{obligation.returns.map((record) => <li key={record.id}>반환 기록 {record.id} · {money(record.amount)} · 반환일시 {formatKstDateTime(record.returnedAt)} · 기록일시 {formatKstDateTime(record.createdAt)} · 사유 {detail.personalDataPurgedAt ? "개인정보 파기됨" : record.reason ?? "기록 없음"} · 처리자 {record.processedBy.name ?? "기록 없음"}</li>)}</ul> : <p>완료 반환 기록 없음</p>}<Link className="inline-flex min-h-11 items-center underline" href="/reservation-applications/returns">예약 전 반환 처리 화면</Link></article>) : <p className="text-sm">예약 전 반환 기록이 없습니다.</p>}</div>
  </div>;
}
