import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTargetAgeRange } from "@/lib/programs/format";

export type ProgramListRow = {
  id: string;
  name: string;
  targetAgeMin: number | null;
  targetAgeMax: number | null;
  status: "ACTIVE" | "INACTIVE";
};

export interface ProgramTableProps {
  items: ProgramListRow[];
}

export function ProgramTable({ items }: ProgramTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        조건에 맞는 프로그램이 없습니다.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>프로그램명</TableHead>
          <TableHead>대상연령</TableHead>
          <TableHead>운영상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((program) => (
          <TableRow key={program.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/programs/${program.id}`}>
                {program.name}
              </Link>
            </TableCell>
            <TableCell>{formatTargetAgeRange(program.targetAgeMin, program.targetAgeMax)}</TableCell>
            <TableCell>{program.status === "ACTIVE" ? "활성" : "비활성"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
