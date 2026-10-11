import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDateTime, formatKstDateTimeRange } from "@/lib/classes/datetime";
import { APPLICATION_STATUS_LABEL, PURGED_PERSONAL_DATA_LABEL } from "@/lib/reservation-applications/constants";
import type { ApplicationListRow } from "@/lib/reservation-applications/queries";

export const APPLICATION_STATUS_VARIANT: Record<ApplicationListRow["status"], NonNullable<BadgeProps["variant"]>> = {
  SUBMITTED: "warning",
  CONFIRMED: "success",
  REJECTED: "secondary",
  CANCELLED: "secondary",
};

/** 모바일 3열(아이·클래스·상태), 데스크톱 5열(UI-GUIDELINES §3). 연락처·요청사항은 상세에서만 본다. */
export function ApplicationTable({ items }: { items: ApplicationListRow[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        조건에 맞는 신청이 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>아이 이름</TableHead>
          <TableHead>클래스</TableHead>
          <TableHead className="hidden md:table-cell">신청 일시</TableHead>
          <TableHead className="hidden md:table-cell">입금</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((application) => (
          <TableRow data-testid="application-row" key={application.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/reservation-applications/${application.id}`}>
                {application.childName ?? PURGED_PERSONAL_DATA_LABEL}
              </Link>
              {application.submissionId ? <Link className="ml-2 text-xs text-slate-500 hover:underline" href={`/reservation-applications/submissions/${application.submissionId}`}>가족 신청</Link> : null}
              {application.isPossibleDuplicate ? (
                <Badge className="ml-2" variant="warning">
                  중복 가능
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>
              <span className="break-words">{application.classSchedule.program.name}</span>
              <span className="block text-xs text-slate-500">
                {formatKstDateTimeRange(application.classSchedule.startsAt, application.classSchedule.endsAt)}
              </span>
            </TableCell>
            <TableCell className="hidden md:table-cell">{formatKstDateTime(application.submittedAt)}</TableCell>
            <TableCell className="hidden md:table-cell">
              <Badge variant={application.depositConfirmedAt ? "success" : "secondary"}>
                {application.depositConfirmedAt ? "확인" : "미확인"}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={APPLICATION_STATUS_VARIANT[application.status]}>
                {APPLICATION_STATUS_LABEL[application.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
