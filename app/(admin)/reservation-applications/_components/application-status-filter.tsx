import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ApplicationListStatus } from "@/lib/reservation-applications/list";

/** 선택지가 고정된 상태 필터만 둔다(UI-GUIDELINES §4, §4-1). 기본값은 처리 대기다. */
export function ApplicationStatusFilter({ status }: { status: ApplicationListStatus }) {
  return (
    <form action="/reservation-applications" className="flex flex-col gap-3 md:flex-row md:items-end" method="get">
      <div className="w-full space-y-1.5 md:w-auto">
        <Label htmlFor="status">상태</Label>
        <Select defaultValue={status} id="status" name="status">
          <option value="SUBMITTED">처리 대기</option>
          <option value="CONFIRMED">확정</option>
          <option value="REJECTED">반려</option>
          <option value="CANCELLED">취소</option>
          <option value="all">전체</option>
        </Select>
      </div>
      <Button className="w-full md:w-auto" type="submit">
        조회
      </Button>
    </form>
  );
}
