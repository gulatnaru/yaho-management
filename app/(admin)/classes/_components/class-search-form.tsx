import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ClassListStatus } from "@/lib/classes/query-builder";

export interface ClassSearchFormProps {
  dateFrom?: string;
  dateTo?: string;
  status: ClassListStatus;
}

/**
 * 클래스 검색 폼. ADR-021: 검색은 날짜(기간)와 상태 2개뿐이다.
 * 필드가 3개(시작일/종료일/상태)뿐이라 접을 이유가 없어 Disclosure를 쓰지 않는다.
 */
export function ClassSearchForm({ dateFrom, dateTo, status }: ClassSearchFormProps) {
  return (
    <form action="/classes" className="flex flex-col gap-3 md:flex-row md:items-end" method="get">
      <div className="w-full min-w-0 space-y-1.5 md:w-auto">
        <Label htmlFor="dateFrom">시작일</Label>
        <Input defaultValue={dateFrom} id="dateFrom" name="dateFrom" type="date" />
      </div>

      <div className="w-full min-w-0 space-y-1.5 md:w-auto">
        <Label htmlFor="dateTo">종료일</Label>
        <Input defaultValue={dateTo} id="dateTo" name="dateTo" type="date" />
      </div>

      <div className="w-full space-y-1.5 md:w-auto">
        <Label htmlFor="status">상태</Label>
        <Select defaultValue={status} id="status" name="status">
          <option value="all">전체</option>
          <option value="SCHEDULED">예정</option>
          <option value="CANCELLED">취소</option>
          <option value="COMPLETED">완료</option>
        </Select>
      </div>

      <Button className="w-full md:w-auto" type="submit">
        검색
      </Button>
    </form>
  );
}
