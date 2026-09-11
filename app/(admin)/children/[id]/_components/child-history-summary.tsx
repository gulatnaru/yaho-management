import { Card, CardContent } from "@/components/ui/card";
import type { ChildHistorySummary } from "@/server/children/history";

const SUMMARY_ITEMS = [
  ["totalReservations", "총 예약"],
  ["presentCount", "참석"],
  ["absentCount", "불참"],
  ["cancelledCount", "취소"],
  ["upcomingCount", "예정"],
] as const;

export function ChildHistorySummaryCards({ summary }: { summary: ChildHistorySummary }) {
  return (
    <section aria-labelledby="child-history-summary-heading" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold" id="child-history-summary-heading">
          통합 이력 요약
        </h2>
        <p className="text-sm text-slate-500">
          참석·불참·취소는 서로 다른 상태를 기준으로 하므로 같은 예약이 여러 항목에 포함될 수 있습니다.
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-5">
        {SUMMARY_ITEMS.map(([key, label]) => (
          <Card className="min-w-0" key={key}>
            <CardContent className="p-4">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-1 break-words text-2xl font-bold tabular-nums">{summary[key]}건</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
