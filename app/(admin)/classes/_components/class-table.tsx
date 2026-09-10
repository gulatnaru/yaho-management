import Link from "next/link";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";
import { formatCapacityState, getCapacityState } from "@/lib/classes/capacity";
import { getClassDisplayStatus, type ClassDisplayStatus } from "@/lib/classes/status";

export type ClassListStatusValue = "SCHEDULED" | "CANCELLED" | "COMPLETED";

export type ClassListRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: ClassListStatusValue;
  capacity: number;
  reservedCount: number;
  program: { id: string; name: string };
};

export interface ClassTableProps {
  items: ClassListRow[];
}

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
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%] px-2 md:px-4">날짜/시간</TableHead>
          <TableHead className="w-[33%] px-2 md:px-4">프로그램명</TableHead>
          <TableHead className="w-[25%] px-2 md:px-4">좌석/상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((classItem) => {
          const displayStatus = getClassDisplayStatus(classItem);
          const capacityState = getCapacityState(classItem.capacity, classItem.reservedCount);
          const label =
            displayStatus === "SCHEDULED"
              ? formatCapacityState(classItem.capacity, classItem.reservedCount)
              : displayStatus === "ENDED"
                ? "종료"
                : "취소";
          const variant: NonNullable<BadgeProps["variant"]> =
            displayStatus !== "SCHEDULED"
              ? STATUS_VARIANT[displayStatus]
              : capacityState.status === "AVAILABLE"
                ? "default"
                : "warning";
          return (
            <TableRow key={classItem.id}>
              <TableCell className="break-words px-2 text-xs md:px-4 md:text-sm">
                {formatKstDateTimeRange(classItem.startsAt, classItem.endsAt)}
              </TableCell>
              <TableCell className="break-words px-2 md:px-4">
                <Link className="font-medium hover:underline" href={`/classes/${classItem.id}`}>
                  {classItem.program.name}
                </Link>
              </TableCell>
              <TableCell className="px-2 md:px-4">
                <Badge variant={variant}>{label}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
