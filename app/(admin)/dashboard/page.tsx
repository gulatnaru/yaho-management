import { requireAdmin } from "@/lib/auth/authorization";
import { dashboardSearchSchema } from "@/lib/validation/dashboard";
import { buildMonthlyCalendar } from "@/server/dashboard/calendar";
import { addKstMonths, getKstDayPeriod, resolveDashboardPeriod } from "@/server/dashboard/period";
import {
  getDashboardClasses,
  getMonthlyCalendarMetrics,
  getTodayCancellationCount,
  getTodayFinancialMetrics,
} from "@/server/dashboard/queries";
import { DashboardClassList } from "./_components/dashboard-class-list";
import { DashboardSummary } from "./_components/dashboard-summary";
import { MonthlyCalendar } from "./_components/monthly-calendar";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireAdmin();
  const raw = await searchParams;
  const search = dashboardSearchSchema.parse({
    month: firstValue(raw.month),
    date: firstValue(raw.date),
  });
  const period = resolveDashboardPeriod(search);
  const todayRange = { startUtc: period.todayStartUtc, endExclusiveUtc: period.tomorrowStartUtc };
  const todayClassesPromise = getDashboardClasses(todayRange);
  const selectedClassesPromise = period.selectedDate
    ? period.selectedDate === period.today
      ? todayClassesPromise
      : getDashboardClasses(getKstDayPeriod(period.selectedDate))
    : Promise.resolve(undefined);

  const [calendarMetrics, todayClasses, cancellationCount, financialMetrics, selectedClasses] = await Promise.all([
    getMonthlyCalendarMetrics(period),
    todayClassesPromise,
    getTodayCancellationCount(todayRange),
    getTodayFinancialMetrics(todayRange),
    selectedClassesPromise,
  ]);
  const todayMetrics = {
    classCount: todayClasses.length,
    operationReservationCount: todayClasses.reduce(
      (total, classItem) => total + classItem.operationReservationCount,
      0,
    ),
    cancellationCount,
    ...financialMetrics,
  };

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">관리자 홈</h1>
        <p className="mt-1 text-sm text-slate-500">오늘의 운영 현황과 월간 예약 일정을 확인합니다.</p>
      </div>

      <DashboardSummary metrics={todayMetrics} />

      <DashboardClassList
        classes={todayClasses}
        description="오늘 KST에 시작하는 취소되지 않은 클래스입니다."
        emptyMessage="오늘 예정된 클래스가 없습니다."
        showReservations={false}
        title="오늘 클래스"
      />

      <MonthlyCalendar
        cells={buildMonthlyCalendar(period.month)}
        metrics={calendarMetrics}
        month={period.month}
        nextMonth={addKstMonths(period.month, 1)}
        previousMonth={addKstMonths(period.month, -1)}
        selectedDate={period.selectedDate}
        today={period.today}
      />

      {period.selectedDate ? (
        <DashboardClassList
          classes={selectedClasses ?? []}
          description="출결 없는 사전 취소는 제외하고 운영 이력이 있는 예약만 표시합니다."
          emptyMessage="선택한 날짜에 운영할 클래스가 없습니다."
          showReservations
          title={`${period.selectedDate} 예약자 명단`}
        />
      ) : (
        <section className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">
          날짜를 선택하면 클래스별 예약자 명단이 표시됩니다.
        </section>
      )}
    </section>
  );
}
