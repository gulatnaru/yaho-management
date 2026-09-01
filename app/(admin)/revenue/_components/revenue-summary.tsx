import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKrw } from "@/lib/payments/format";
import type { RevenueMetrics } from "@/server/revenue/types";

export function RevenueSummary({ metrics }: { metrics: RevenueMetrics }) {
  const items = [
    { label: "예약", value: `${metrics.reservationCount}건` },
    { label: "참여", value: `${metrics.participantCount}명` },
    { label: "정가", value: formatKrw(metrics.amount) },
    { label: "할인", value: formatKrw(metrics.discountAmount) },
    { label: "결제", value: formatKrw(metrics.paidAmount) },
    { label: "환불", value: formatKrw(metrics.refundedAmount) },
    { label: "순매출", value: formatKrw(metrics.netRevenue) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <Card data-testid={`summary-${item.label}`} key={item.label}>
          <CardHeader className="border-0 pb-1">
            <CardTitle className="text-sm font-medium text-slate-500">{item.label}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xl font-bold tabular-nums">{item.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
