import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ClassListStatus } from "@/lib/classes/query-builder";
import { cn } from "@/lib/utils";
import type { ClassDatePreset } from "@/server/classes/filter-presets";

export interface ClassSearchFormProps {
  dateFrom?: string;
  dateTo?: string;
  status: ClassListStatus;
  presetHrefs: Record<ClassDatePreset, string>;
  activePreset?: ClassDatePreset;
}

const PRESET_LABEL: Record<ClassDatePreset, string> = {
  today: "오늘",
  week: "이번 주",
  month: "이번 달",
};

/**
 * 클래스 검색 폼. ADR-021: 검색은 날짜(기간)와 상태 2개뿐이다.
 * 필드가 3개(시작일/종료일/상태)뿐이라 접을 이유가 없어 Disclosure를 쓰지 않는다.
 */
export function ClassSearchForm({ dateFrom, dateTo, status, presetHrefs, activePreset }: ClassSearchFormProps) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABEL) as ClassDatePreset[]).map((preset) => {
          const active = activePreset === preset;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                buttonVariants(),
                "h-9 px-3",
                !active && "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
              href={presetHrefs[preset]}
              key={preset}
            >
              {PRESET_LABEL[preset]}
            </Link>
          );
        })}
      </div>

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
    </section>
  );
}
