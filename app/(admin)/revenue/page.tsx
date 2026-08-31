import { revenueFilterSchema } from "@/lib/validation/revenue";
import { getKstMonthRange, getKstWeekRange, resolveRevenuePeriod } from "@/server/revenue/period";
import { getRevenueReport, listRevenueProgramOptions } from "@/server/revenue/queries";
import type { RevenueQueryFilters } from "@/server/revenue/types";
import { ClassRevenueList } from "./_components/class-revenue-list";
import { ProgramRevenueList } from "./_components/program-revenue-list";
import { RevenueFilterForm } from "./_components/revenue-filter-form";
import { RevenueSummary } from "./_components/revenue-summary";
import { formatKstDate } from "@/lib/classes/datetime";

export const dynamic = "force-dynamic";

interface RevenuePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildPresetHref(
  range: { dateFrom: string; dateTo: string },
  filters: { programId?: string; paymentMethod: string; refundState: string },
) {
  const query = new URLSearchParams(range);
  if (filters.programId) query.set("programId", filters.programId);
  if (filters.paymentMethod !== "all") query.set("paymentMethod", filters.paymentMethod);
  if (filters.refundState !== "all") query.set("refundState", filters.refundState);
  return `/revenue?${query.toString()}`;
}

export default async function RevenuePage({ searchParams }: RevenuePageProps) {
  const raw = await searchParams;
  const parsed = revenueFilterSchema.safeParse({
    dateFrom: firstValue(raw.dateFrom),
    dateTo: firstValue(raw.dateTo),
    programId: firstValue(raw.programId),
    classScheduleId: firstValue(raw.classScheduleId),
    paymentMethod: firstValue(raw.paymentMethod),
    refundState: firstValue(raw.refundState),
  });
  const values = parsed.success
    ? parsed.data
    : revenueFilterSchema.parse({ paymentMethod: firstValue(raw.paymentMethod), refundState: firstValue(raw.refundState) });
  const now = new Date();
  const period = resolveRevenuePeriod(values.dateFrom, values.dateTo, now);
  const filters: RevenueQueryFilters = {
    ...period,
    programId: values.programId,
    classScheduleId: values.classScheduleId,
    paymentMethod: values.paymentMethod === "all" ? undefined : values.paymentMethod,
    refundState: values.refundState === "all" ? undefined : values.refundState,
  };
  const [report, programs] = await Promise.all([getRevenueReport(filters), listRevenueProgramOptions()]);
  const today = formatKstDate(now);
  const sharedPresetFilters = {
    programId: values.programId,
    paymentMethod: values.paymentMethod,
    refundState: values.refundState,
  };

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">매출 집계</h1>
        <p className="mt-1 text-sm text-slate-500">
          {period.dateFrom} ~ {period.dateTo} · 예약·참여는 클래스일, 결제는 결제일, 환불은 환불 처리일 기준입니다.
        </p>
      </div>

      <RevenueFilterForm
        presetHrefs={{
          today: buildPresetHref({ dateFrom: today, dateTo: today }, sharedPresetFilters),
          week: buildPresetHref(getKstWeekRange(now), sharedPresetFilters),
          month: buildPresetHref(getKstMonthRange(now), sharedPresetFilters),
        }}
        programs={programs}
        values={{
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          programId: values.programId,
          paymentMethod: values.paymentMethod,
          refundState: values.refundState,
        }}
      />

      <RevenueSummary metrics={report.summary} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">프로그램별 집계</h2>
          <p className="text-sm text-slate-500">프로그램 단위로 운영 지표와 금액을 비교합니다.</p>
        </div>
        <ProgramRevenueList rows={report.programs} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">클래스별 집계</h2>
          <p className="text-sm text-slate-500">세 시간축 중 하나라도 조회 기간에 포함된 클래스입니다.</p>
        </div>
        <ClassRevenueList rows={report.classes} />
      </section>
    </section>
  );
}
