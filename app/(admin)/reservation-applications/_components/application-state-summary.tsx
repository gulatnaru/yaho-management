import type { FamilyApplication } from "@/lib/reservation-applications/family-queries";

export function applicationStateSummary(family: FamilyApplication) {
  const pending = family.children.filter((child) => child.status === "SUBMITTED").length;
  const confirmed = family.children.filter((child) => child.status === "CONFIRMED").length;
  const rejected = family.children.filter((child) => child.status === "REJECTED").length;
  const cancelled = family.children.filter((child) => child.status === "CANCELLED").length;
  const processing = [pending ? `처리 대기 ${pending}명` : "", confirmed ? `${confirmed < family.children.length ? "일부 확정" : "예약 확정"} ${confirmed}/${family.children.length}명` : "", rejected ? `반려 ${rejected}명` : "", cancelled ? `취소 ${cancelled}명` : ""].filter(Boolean).join(" · ");
  const deposit = family.kind === "legacy" ? `기존 방식 · 금액 미기록 · ${family.legacyDepositConfirmed ? "입금 확인 기록 있음" : "입금 확인 기록 없음"}` : family.deposit.state === "unavailable" ? "입금 상태 조회 오류" : family.deposit.state === "available" && family.deposit.depositedAmount > 0 ? `은행 확인 입금 누계 ${family.deposit.depositedAmount.toLocaleString("ko-KR")}원` : `${family.notificationReceived ? "알림 받음 · " : ""}은행 확인 기록 없음`;
  const action = family.deposit.state === "unavailable" ? "입금 상태를 상세에서 다시 확인해 주세요." : family.deposit.state === "available" && family.deposit.hasOutstandingReturn ? "반환이 필요한 내역을 확인해 주세요." : pending ? family.kind === "legacy" ? "기존 신청 내용을 확인하고 처리해 주세요." : family.deposit.state === "available" && family.deposit.depositedAmount > 0 ? "신청 내용과 입금 배정을 확인하고 예약을 확정해 주세요." : "신청 내용과 실제 은행 입금을 확인해 주세요." : "아이별 처리 결과를 확인할 수 있습니다.";
  return { processing, deposit, action };
}
export function ApplicationStateSummary({ family }: { family: FamilyApplication }) {
  const summary = applicationStateSummary(family);
  return <div className="space-y-1 text-sm"><p className="font-medium text-blue-800">{summary.action}</p><p>{summary.processing}</p><p className={family.deposit.state === "unavailable" ? "text-red-700" : "text-slate-600"}>{summary.deposit}</p>{family.kind === "submission" ? <p className="text-xs text-slate-500">입금은 가족 제출 전체 기준 · 알림은 실제 입금·예약 확정과 별개입니다.</p> : <p className="text-xs text-slate-500">보호자 입금 알림·금액 원장 미지원</p>}</div>;
}
