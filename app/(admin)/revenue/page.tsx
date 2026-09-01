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
  const todayRange = { dateFrom: today, dateTo: today };
  const weekRange = getKstWeekRange(now);
  const monthRange = getKstMonthRange(now);
  const activePreset =
    period.dateFrom === todayRange.dateFrom && period.dateTo === todayRange.dateTo
      ? "today"
      : period.dateFrom === weekRange.dateFrom && period.dateTo === weekRange.dateTo
        ? "week"
        : period.dateFrom === monthRange.dateFrom && period.dateTo === monthRange.dateTo
          ? "month"
          : undefined;
  const sharedPresetFilters = {
    programId: values.programId,
    paymentMethod: values.paymentMethod,
    refundState: values.refundState,
  };

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">매출 현황</h1>
        <p className="mt-1 text-sm text-slate-500">기간별 예약, 참여, 결제와 환불 현황을 확인하세요.</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          예약·참여는 수업 날짜, 결제는 결제한 날짜, 환불은 환불 처리한 날짜를 기준으로 집계됩니다.
        </p>
      </div>

      <RevenueFilterForm
        activePreset={activePreset}
        key={`${period.dateFrom}:${period.dateTo}`}
        presetHrefs={{
          today: buildPresetHref(todayRange, sharedPresetFilters),
          week: buildPresetHref(weekRange, sharedPresetFilters),
          month: buildPresetHref(monthRange, sharedPresetFilters),
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
          <h2 className="text-lg font-semibold">프로그램별 현황</h2>
          <p className="text-sm text-slate-500">프로그램별 예약·참여와 매출을 확인하세요.</p>
        </div>
        <ProgramRevenueList rows={report.programs} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">수업별 현황</h2>
          <p className="text-sm text-slate-500">선택한 기간의 수업별 예약·참여와 매출을 확인하세요.</p>
        </div>
        <ClassRevenueList rows={report.classes} />
      </section>
    </section>
  );
}
