import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toTelHref } from "@/lib/shared/contact";

export type TeacherListRow = {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
};

export interface TeacherTableProps {
  items: TeacherListRow[];
}

export function TeacherTable({ items }: TeacherTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        조건에 맞는 선생님이 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이름</TableHead>
          <TableHead>연락처</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((teacher) => (
          <TableRow key={teacher.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/teachers/${teacher.id}`}>
                {teacher.name}
              </Link>
            </TableCell>
            <TableCell>
              {teacher.phone ? (
                <a className="hover:underline" href={toTelHref(teacher.phone)}>
                  {teacher.phone}
                </a>
              ) : (
                "미입력"
              )}
            </TableCell>
            <TableCell>{teacher.isActive ? "활성" : "비활성"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
