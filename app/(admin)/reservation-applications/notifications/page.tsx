import Link from "next/link";
import { getNotificationHistory } from "@/server/kakao/notification-queries";
import { describeNotification, describeReconciliation } from "../_components/notification-summary";
import { NotificationBudget } from "../_components/notification-budget";
import { BlockForm } from "./block-form";
import { reviewNeeds } from "../_components/notification-review";

export const dynamic = "force-dynamic";
const time = (date: Date) => date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
export default async function NotificationHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; filter?: string }> }) {
  const params = await searchParams;
  const raw = params.page;
  const page = raw && /^\d+$/.test(raw) ? Math.min(1000, Math.max(1, Number(raw))) : 1;
  const filter = ["attention", "all", "failed", "skipped", "unknown"].includes(params.filter ?? "") ? params.filter! : "attention";
  const { rows, budget } = await getNotificationHistory(page, filter);
  const now = Date.now();
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">관리자 알림 이력</h1>
    <NotificationBudget row={budget} />
    <BlockForm />
    <p>공급자 접수는 최종 전달 완료와 다릅니다. 결과 불명은 자동 재전송하지 않습니다.</p>
    <nav className="flex flex-wrap gap-4" aria-label="알림 이력 필터">{[["attention", "확인 필요"], ["all", "전체"], ["failed", "실패"], ["skipped", "건너뜀"], ["unknown", "불명"]].map(([value, label]) => <Link key={value} href={`?filter=${value}`} aria-current={filter === value ? "page" : undefined}>{label}</Link>)}</nav>
    {rows.length === 0 ? <p>알림 이력이 없습니다.</p> : rows.slice(0, 20).map((row) => {
      const description = describeNotification(row);
      const review = reviewNeeds(row, now);
      return <article key={row.entityId} className="rounded border p-4 space-y-1">
        <Link className="underline" href={`/reservation-applications/submissions/${encodeURIComponent(row.entityId)}`}>신청 상세</Link>
        <p>접수 이벤트: {time(row.occurredAt)} · Outbox: {row.status} · {description.state}</p>
        <p>대사: {describeReconciliation(row.reconciliationState)}{row.submittedAt && ` · 최초 발송권 발급 ${time(row.submittedAt)}`}{row.nextRetryAt && ` · 다음 처리 예정 ${time(row.nextRetryAt)}`}</p>
        <p>실패 횟수 {row.attemptCount} · 요청 슬롯 {row.slotCount ?? 0} · 미해결 슬롯 {row.unresolvedSlots} · 미해결 비용 예약 {row.unresolvedCosts}건 · 마지막 확인·갱신 {time(row.updatedAt)}</p>
        {(row.status === "pending" || row.status === "processing") && now >= row.occurredAt.getTime() + 86400000 && <p>24시간 만료 기한 경과 · 처리 상태 확인 필요</p>}
        <p>{description.action}</p>
        {row.unknownSince && <p>불명 시작 {time(row.unknownSince)} · 7일 점검 {review.seven ? "필요 / 연체" : row.reviewed7dAt ? time(row.reviewed7dAt) : "예정"} · 30일 책임자 재검토 {review.thirty ? "필요 / 연체" : row.responsibilityReviewedAt ? time(row.responsibilityReviewedAt) : "예정"}{row.nextReviewAt && ` · 다음 점검 ${time(row.nextReviewAt)}`}</p>}
      </article>;
    })}
    <nav className="flex gap-4">{page > 1 && <Link href={`?filter=${filter}&page=${page - 1}`}>이전</Link>}{rows.length > 20 && page < 1000 && <Link href={`?filter=${filter}&page=${page + 1}`}>다음</Link>}</nav>
  </section>;
}
