import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toTelHref } from "@/lib/shared/contact";
import { isProfileIncomplete } from "@/lib/children/profile-completeness";
import { IncompleteProfileBadge } from "./incomplete-profile-badge";

export type ChildListRow = {
  id: string;
  name: string;
  birthDate: Date | null;
  guardianName: string | null;
  guardianPhone: string | null;
  isActive: boolean;
  /** 가장 가까운 미래 RESERVED 예약의 클래스 시작일(KST "YYYY-MM-DD"). 없으면 null(ADR-012: "–" 표기). */
  nextReservationDate: string | null;
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
          <TableHead>보호자 연락처</TableHead>
          <TableHead>다음 예약</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((child) => (
          <TableRow key={child.id}>
            <TableCell>
              <Link className="flex items-center gap-2 font-medium hover:underline" href={`/children/${child.id}`}>
                {child.name}
                {isProfileIncomplete(child) ? <IncompleteProfileBadge /> : null}
              </Link>
            </TableCell>
            <TableCell>
              {child.guardianPhone ? (
                <a className="hover:underline" href={toTelHref(child.guardianPhone)}>
                  {child.guardianPhone}
                </a>
              ) : (
                "미입력"
              )}
            </TableCell>
            <TableCell>{child.nextReservationDate ?? "–"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
