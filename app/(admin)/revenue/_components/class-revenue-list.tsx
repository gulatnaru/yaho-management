import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDateTime } from "@/lib/classes/datetime";
import { formatKrw } from "@/lib/payments/format";
import type { RevenueClassRow } from "@/server/revenue/types";

export function ClassRevenueList({ rows }: { rows: RevenueClassRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>클래스</TableHead>
          <TableHead>예약·참여</TableHead>
          <TableHead className="hidden md:table-cell">결제</TableHead>
          <TableHead className="hidden md:table-cell">환불</TableHead>
          <TableHead>순매출</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow data-testid={`class-row-${row.classScheduleId}`} key={row.classScheduleId}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/classes/${row.classScheduleId}`}>
                {row.programName}
              </Link>
              <p className="text-xs text-slate-500">{formatKstDateTime(row.startsAt)}</p>
            </TableCell>
            <TableCell>
              <span className="whitespace-nowrap text-xs text-slate-600">
                예약 {row.reservationCount} · 참여 {row.participantCount} · 취소 {row.cancellationCount}
              </span>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <p>{formatKrw(row.paidAmount)}</p>
              <p className="text-xs text-slate-500">정가 {formatKrw(row.amount)} · 할인 {formatKrw(row.discountAmount)}</p>
            </TableCell>
            <TableCell className="hidden md:table-cell">{formatKrw(row.refundedAmount)}</TableCell>
            <TableCell className="font-medium tabular-nums">{formatKrw(row.netRevenue)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
