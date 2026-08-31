import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RevenueFilterInput } from "@/lib/validation/revenue";

interface RevenueFilterFormProps {
  values: Required<Pick<RevenueFilterInput, "dateFrom" | "dateTo" | "paymentMethod" | "refundState">> & {
    programId?: string;
  };
  programs: Array<{ id: string; name: string }>;
  presetHrefs: { today: string; week: string; month: string };
}

export function RevenueFilterForm({ values, programs, presetHrefs }: RevenueFilterFormProps) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap gap-2">
        <Link className={cn(buttonVariants(), "h-9 bg-slate-100 px-3 text-slate-700 hover:bg-slate-200")} href={presetHrefs.today}>
          오늘
        </Link>
        <Link className={cn(buttonVariants(), "h-9 bg-slate-100 px-3 text-slate-700 hover:bg-slate-200")} href={presetHrefs.week}>
          이번 주
        </Link>
        <Link className={cn(buttonVariants(), "h-9 bg-slate-100 px-3 text-slate-700 hover:bg-slate-200")} href={presetHrefs.month}>
          이번 달
        </Link>
      </div>

      <form action="/revenue" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6" method="get">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="dateFrom">시작일</Label>
          <Input defaultValue={values.dateFrom} id="dateFrom" name="dateFrom" type="date" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="dateTo">종료일</Label>
          <Input defaultValue={values.dateTo} id="dateTo" name="dateTo" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="programId">프로그램</Label>
          <Select defaultValue={values.programId ?? ""} id="programId" name="programId">
            <option value="">전체</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paymentMethod">결제수단</Label>
          <Select defaultValue={values.paymentMethod} id="paymentMethod" name="paymentMethod">
            <option value="all">전체</option>
            <option value="CARD">카드</option>
            <option value="TRANSFER">계좌이체</option>
            <option value="CASH">현금</option>
            <option value="OTHER">기타</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="refundState">환불 여부</Label>
          <Select defaultValue={values.refundState} id="refundState" name="refundState">
            <option value="all">전체</option>
            <option value="NONE">환불 없음</option>
            <option value="PARTIAL">부분 환불</option>
            <option value="FULL">전액 환불</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button className="w-full" type="submit">
            조회
          </Button>
        </div>
      </form>

      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        결제수단·환불 여부는 금액 지표에만 적용됩니다. 예약 수와 참여 인원은 기간·프로그램 조건만 적용합니다.
      </p>
    </section>
  );
}
