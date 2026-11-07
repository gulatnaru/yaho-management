import type { NotificationSummary } from "@/server/kakao/notification-queries";

export function describeNotification(row: NotificationSummary | null): { state: string; action: string } {
  if (!row) return { state: "알림 기록 없음", action: "신청을 직접 확인해 주세요." };
  if (row.finalStatus === "delivered") return { state: "최종 전달 성공", action: "비용 대사 상태도 확인해 주세요." };
  if (row.finalStatus === "delivery_failed") return { state: "최종 전달 실패", action: "신청과 비용 대사 상태를 확인해 주세요." };
  if (row.finalStatus === "not_sent") return { state: "미발송 확인", action: "신청과 비용 대사 상태를 확인해 주세요." };
  if (row.reconciliationState === "closed_unconfirmed") return { state: "미확정 종료", action: "전달 및 비용 미확정 내역을 확인해 주세요." };
  if (row.finalStatus === "unknown" || row.reconciliationState === "unknown" || row.reconciliationState === "open_unknown" || row.lastErrorCode === "provider_result_unknown") return { state: "결과 불명", action: "대사가 필요합니다. 자동 재전송하지 않습니다." };
  if (row.reconciliationState === "awaiting_cost") return { state: "비용 대사 대기", action: "비용 대사가 필요합니다." };
  if (row.reconciliationState === "awaiting_final") return { state: "최종 전달 결과 대기", action: "최종 결과를 확인해 주세요." };
  if (row.status === "skipped" && row.lastErrorCode === "event_expired") return { state: "24시간 만료 / 미발송", action: "신청을 직접 확인해 주세요." };
  switch (row.status) {
    case "sent": return { state: "공급자 접수", action: "최종 전달 결과는 별도로 확인해야 합니다." };
    case "skipped": return { state: "미발송 / 건너뜀", action: "신청을 직접 확인해 주세요." };
    case "failed": return { state: "실패 또는 결과 불명", action: "이력을 확인해 주세요." };
    case "processing": return { state: "처리 중", action: "이력에서 결과를 확인해 주세요." };
    default: return { state: "발송 대기", action: "신청을 직접 확인해 주세요." };
  }
}

export function describeReconciliation(state: string | null): string {
  switch (state) {
    case "open_unknown": case "unknown": return "불명 / 대사 필요";
    case "awaiting_final": return "최종 결과 대사 대기";
    case "awaiting_cost": return "비용 대사 대기";
    case "closed_unconfirmed": return "미확정 종료 / 후속 대사 필요";
    case "in_flight": return "요청 처리 중";
    case "ready": return "준비";
    case "rejected": return "거절";
    default: return "별도 대사 상태 없음 또는 확인 필요";
  }
}

export function NotificationSummaryView({ row }: { row: NotificationSummary | null }) {
  const description = describeNotification(row);
  return <section className="rounded border p-4" aria-label="신청 접수 알림">
    <h2 className="font-semibold">신청 접수 알림</h2>
    <p>{description.state}</p>
    <p>발송 요청권: {row?.submittedAt ? `발급 (${row.submittedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}) · 실제 호출 여부는 결과를 확인` : "발급 기록 없음"}</p>
    {row && <p>마지막 확인·갱신: {row.updatedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 실패 횟수: {row.attemptCount}</p>}
    {row && <p>대사: {describeReconciliation(row.reconciliationState)}</p>}
    {row?.reconciliationState === "closed_unconfirmed" && <p>미확정 종료 기록이 있습니다. 후속 대사 및 비용을 확인해 주세요.</p>}
    <p>{description.action}</p>
  </section>;
}
