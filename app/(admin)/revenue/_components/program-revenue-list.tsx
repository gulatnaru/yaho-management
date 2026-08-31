import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKrw } from "@/lib/payments/format";
import type { RevenueProgramRow } from "@/server/revenue/types";

function Operations({ row }: { row: RevenueProgramRow }) {
  return (
    <span className="whitespace-nowrap text-xs text-slate-600">
      예약 {row.reservationCount} · 참여 {row.participantCount} · 취소 {row.cancellationCount}
    </span>
  );
}

export function ProgramRevenueList({ rows }: { rows: RevenueProgramRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">조회 기간의 집계가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>프로그램</TableHead>
          <TableHead>운영</TableHead>
          <TableHead className="hidden md:table-cell">결제</TableHead>
          <TableHead className="hidden md:table-cell">환불</TableHead>
          <TableHead>순매출</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow data-testid={`program-row-${row.programId}`} key={row.programId}>
            <TableCell>
              <p className="font-medium">{row.programName}</p>
              <p className="text-xs text-slate-500">클래스 {row.classCount}개</p>
            </TableCell>
            <TableCell><Operations row={row} /></TableCell>
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
