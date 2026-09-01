import { Card, CardContent } from "@/components/ui/card";
import { formatKrw } from "@/lib/payments/format";
import type { DashboardTodayMetrics } from "@/server/dashboard/types";

function SummaryCard({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardSummary({ metrics }: { metrics: DashboardTodayMetrics }) {
  return (
    <section aria-labelledby="today-summary-heading" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold" id="today-summary-heading">오늘 운영 요약</h2>
        <p className="text-sm text-slate-500">한국 시간(KST) 기준입니다.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="오늘 클래스" testId="summary-class-count" value={`${metrics.classCount}개`} />
        <SummaryCard
          label="오늘 운영 예약 인원"
          testId="summary-operation-reservations"
          value={`${metrics.operationReservationCount}명`}
        />
        <SummaryCard label="오늘 취소 처리" testId="summary-cancellations" value={`${metrics.cancellationCount}건`} />
        <div className="col-span-2 lg:col-span-2">
          <Card data-testid="summary-net-revenue">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-slate-500">오늘 순매출</p>
                <p className="text-xl font-bold tabular-nums">{formatKrw(metrics.netRevenue)}</p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span data-testid="summary-paid-amount">오늘 결제 {formatKrw(metrics.paidAmount)}</span>
                <span data-testid="summary-refunded-amount">오늘 완료 환불 {formatKrw(metrics.refundedAmount)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
