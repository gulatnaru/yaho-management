import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ChildListStatus } from "@/lib/children/query-builder";

export interface ChildSearchFormProps {
  q?: string;
  status: ChildListStatus;
  birthDate?: string;
}

export function ChildSearchForm({ q, status, birthDate }: ChildSearchFormProps) {
  return (
    <form action="/children" className="flex flex-wrap items-end gap-3" method="get">
      <div className="space-y-1.5">
        <Label htmlFor="q">이름 / 보호자 연락처</Label>
        <Input defaultValue={q} id="q" name="q" placeholder="검색어를 입력하세요" type="search" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="birthDate">생년월일</Label>
        <Input defaultValue={birthDate} id="birthDate" name="birthDate" type="date" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="status">상태</Label>
        <Select defaultValue={status} id="status" name="status">
          <option value="all">전체</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </Select>
      </div>
      <Button type="submit">검색</Button>
    </form>
  );
}
