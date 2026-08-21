import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ProgramListStatus } from "@/lib/programs/query-builder";

export interface ProgramSearchFormProps {
  q?: string;
  status: ProgramListStatus;
}

export function ProgramSearchForm({ q, status }: ProgramSearchFormProps) {
  return (
    <form action="/programs" className="flex flex-col gap-3 md:flex-row md:items-end" method="get">
      <div className="w-full space-y-1.5 md:w-auto">
        <Label htmlFor="status">상태</Label>
        <Select defaultValue={status} id="status" name="status">
          <option value="all">전체</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </Select>
      </div>

      <Disclosure
        className="w-full md:w-auto"
        open={Boolean(q)}
        summary={
          <>
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            검색 조건
          </>
        }
      >
        <div className="w-full space-y-1.5 md:w-auto">
          <Label htmlFor="q">프로그램명</Label>
          <Input defaultValue={q} id="q" name="q" placeholder="검색어를 입력하세요" type="search" />
        </div>
      </Disclosure>

      <Button className="w-full md:w-auto" type="submit">
        검색
      </Button>
    </form>
  );
}
