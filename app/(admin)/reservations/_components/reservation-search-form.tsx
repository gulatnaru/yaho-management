import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ReservationListStatus } from "@/lib/reservations/query-builder";

export interface ReservationSearchFormProps {
  childName?: string;
  programName?: string;
  dateFrom?: string;
  dateTo?: string;
  status: ReservationListStatus;
}

/**
 * 예약 검색 폼. 선택지가 고정된 상태/기간 필터는 기본 노출하고(UI-GUIDELINES §4),
 * 자유 입력 텍스트 검색(아이 이름/프로그램명)은 기본 접힘으로 둔다.
 */
export function ReservationSearchForm({
  childName,
  programName,
  dateFrom,
  dateTo,
  status,
}: ReservationSearchFormProps) {
  return (
    <form action="/reservations" className="flex flex-col gap-3 md:flex-row md:items-end" method="get">
      <div className="w-full space-y-1.5 md:w-auto">
        <Label htmlFor="status">상태</Label>
        <Select defaultValue={status} id="status" name="status">
          <option value="all">전체</option>
          <option value="RESERVED">예약됨</option>
          <option value="CANCELLED">취소</option>
          <option value="COMPLETED">완료</option>
          <option value="NO_SHOW">노쇼</option>
        </Select>
      </div>

      <div className="w-full min-w-0 space-y-1.5 md:w-auto">
        <Label htmlFor="dateFrom">시작일</Label>
        <Input defaultValue={dateFrom} id="dateFrom" name="dateFrom" type="date" />
      </div>

      <div className="w-full min-w-0 space-y-1.5 md:w-auto">
        <Label htmlFor="dateTo">종료일</Label>
        <Input defaultValue={dateTo} id="dateTo" name="dateTo" type="date" />
      </div>

      <Disclosure
        className="w-full md:w-auto"
        open={Boolean(childName || programName)}
        summary={
          <>
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            검색 조건
          </>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="w-full min-w-0 space-y-1.5 md:w-auto">
            <Label htmlFor="childName">아이 이름</Label>
            <Input defaultValue={childName} id="childName" name="childName" placeholder="아이 이름" type="search" />
          </div>
          <div className="w-full min-w-0 space-y-1.5 md:w-auto">
            <Label htmlFor="programName">프로그램명</Label>
            <Input
              defaultValue={programName}
              id="programName"
              name="programName"
              placeholder="프로그램명"
              type="search"
            />
          </div>
        </div>
      </Disclosure>

      <Button className="w-full md:w-auto" type="submit">
        검색
      </Button>
    </form>
  );
}
