import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatKrw } from "@/lib/payments/format";
import type { DashboardTodayMetrics } from "@/server/dashboard/types";

function SummaryCard({
  label,
  value,
  testId,
  href,
  children,
}: {
  label: string;
  value: string;
  testId: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      className="block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
      data-testid={testId}
      href={href}
    >
      <Card className="h-full min-h-24 transition-colors hover:bg-slate-50">
        <CardContent className="flex h-full min-w-0 flex-col justify-between gap-2 p-4">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <div className="min-w-0">
            <p className="break-words text-lg font-bold leading-tight tabular-nums sm:text-xl">{value}</p>
            {children}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardSummary({ metrics, today }: { metrics: DashboardTodayMetrics; today: string }) {
  return (
    <section aria-labelledby="today-summary-heading" className="space-y-3">
      <h2 className="text-lg font-semibold" id="today-summary-heading">오늘 운영 요약</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          href={`/classes?dateFrom=${today}&dateTo=${today}&status=all`}
          label="오늘 수업"
          testId="summary-class-count"
          value={`${metrics.classCount}개`}
        />
        <SummaryCard
          href="/reservations"
          label="오늘 예약 현황"
          testId="summary-operation-reservations"
          value={`${metrics.operationReservationCount}명`}
        />
        <SummaryCard
          href="/reservations?status=CANCELLED"
          label="오늘 취소"
          testId="summary-cancellations"
          value={`${metrics.cancellationCount}건`}
        />
        <SummaryCard
          href={`/revenue?dateFrom=${today}&dateTo=${today}`}
          label="오늘 순매출"
          testId="summary-net-revenue"
          value={formatKrw(metrics.netRevenue)}
        >
          <p className="mt-1 break-words text-[11px] leading-tight text-slate-500 sm:text-xs">
            <span data-testid="summary-paid-amount">결제 {formatKrw(metrics.paidAmount)}</span>
            {" · "}
            <span data-testid="summary-refunded-amount">환불 {formatKrw(metrics.refundedAmount)}</span>
          </p>
        </SummaryCard>
      </div>
    </section>
  );
}
