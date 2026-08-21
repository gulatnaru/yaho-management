import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calculateAge } from "@/lib/children/age";
import { isProfileIncomplete } from "@/lib/children/profile-completeness";
import { IncompleteProfileBadge } from "./incomplete-profile-badge";

export type ChildListRow = {
  id: string;
  name: string;
  birthDate: Date | null;
  guardianName: string | null;
  guardianPhone: string | null;
  isActive: boolean;
};

export interface ChildTableProps {
  items: ChildListRow[];
}

export function ChildTable({ items }: ChildTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        조건에 맞는 아이가 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이름</TableHead>
          <TableHead>생년월일 / 연령</TableHead>
          <TableHead>보호자 연락처</TableHead>
          <TableHead>친구 수</TableHead>
          <TableHead>형제/자매 수</TableHead>
          <TableHead>최근 예약</TableHead>
          <TableHead>누적 예약 횟수</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((child) => {
          const age = calculateAge(child.birthDate);
          return (
            <TableRow key={child.id}>
              <TableCell>
                <Link className="flex items-center gap-2 font-medium hover:underline" href={`/children/${child.id}`}>
                  {child.name}
                  {isProfileIncomplete(child) ? <IncompleteProfileBadge /> : null}
                </Link>
              </TableCell>
              <TableCell>
                {child.birthDate
                  ? `${child.birthDate.toISOString().slice(0, 10)} (만 ${age}세)`
                  : "미입력"}
              </TableCell>
              <TableCell>{child.guardianPhone ?? "미입력"}</TableCell>
              <TableCell>–</TableCell>
              <TableCell>–</TableCell>
              <TableCell>–</TableCell>
              <TableCell>–</TableCell>
              <TableCell>
                <Badge variant={child.isActive ? "success" : "secondary"}>
                  {child.isActive ? "활성" : "비활성"}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
