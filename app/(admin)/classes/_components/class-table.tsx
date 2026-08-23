import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { getClassDisplayStatus, type ClassDisplayStatus } from "@/lib/classes/status";

export type ClassListStatusValue = "SCHEDULED" | "CANCELLED" | "COMPLETED";

export type ClassListRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: ClassListStatusValue;
  program: { id: string; name: string };
};

export interface ClassTableProps {
  items: ClassListRow[];
}

const STATUS_LABEL: Record<ClassDisplayStatus, string> = {
  SCHEDULED: "예정",
  CANCELLED: "취소",
  ENDED: "완료",
};

const STATUS_VARIANT: Record<ClassDisplayStatus, NonNullable<BadgeProps["variant"]>> = {
  SCHEDULED: "default",
  CANCELLED: "secondary",
  ENDED: "success",
};

export function ClassTable({ items }: ClassTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        조건에 맞는 클래스가 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>날짜/시간</TableHead>
          <TableHead>프로그램명</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((classItem) => {
          const displayStatus = getClassDisplayStatus(classItem);
          return (
            <TableRow key={classItem.id}>
              <TableCell>{formatKstDateTimeRange(classItem.startsAt, classItem.endsAt)}</TableCell>
              <TableCell>
                <Link className="font-medium hover:underline" href={`/classes/${classItem.id}`}>
                  {classItem.program.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[displayStatus]}>{STATUS_LABEL[displayStatus]}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
