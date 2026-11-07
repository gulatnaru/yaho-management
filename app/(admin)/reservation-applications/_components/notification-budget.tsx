import type { BudgetSnapshot } from "@/server/kakao/notification-queries";

export function budgetLevels(row: BudgetSnapshot) {
  const message = row.confirmed + row.reserved + row.carry;
  const total = message + row.lookupConfirmed + row.lookupReserved + row.lookupCarry + row.other;
  return { message, total, warning: message >= 2400000n || total >= 4000000n || row.monthRequests >= 160 || row.dayRequests >= 16,
    hardLimit: message >= 3000000n || total >= 5000000n || row.monthRequests >= 200 || row.dayRequests >= 20 };
}
const won = (amount: bigint) => `${(Number(amount) / 1000).toLocaleString("ko-KR")}원`;
export function NotificationBudget({ row }: { row: BudgetSnapshot }) {
  const levels = budgetLevels(row);
  return <section className="rounded border p-4 space-y-1"><h2 className="font-semibold">예산과 발송 차단</h2>
    <p>월 메시지 노출 {won(levels.message)} / 3,000원 · 월 총 노출 {won(levels.total)} / 5,000원 (VAT 포함)</p>
    <p>메시지 확정 {won(row.confirmed)} · 예약 {won(row.reserved)} · 이전 달 미해결 이월 {won(row.carry)}</p>
    <p>조회 비용 확정 {won(row.lookupConfirmed)} · 예약 {won(row.lookupReserved)} · 이월 {won(row.lookupCarry)} · 기타 {won(row.other)}</p>
    <p>월 요청 {row.monthRequests} / 200 · 일 요청 {row.dayRequests} / 20 · 요청당 최대 예약 15원</p>
    <p>{levels.hardLimit ? "한도 도달" : levels.warning ? "80% 경고" : "한도 이내"} · {row.blocked === null ? "차단 상태 확인 불가" : row.blocked ? "신규 발송 영속 차단" : "신규 발송 차단되지 않음"}</p>
    <p>표시는 발송권과 원자적 예산 검사를 대신하지 않습니다.</p>
  </section>;
}
