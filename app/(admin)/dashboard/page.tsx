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

function formatSelectedDateTitle(value: string) {
  const [, month, day] = value.split("-").map(Number);
  return `${month}월 ${day}일 예약 현황`;
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
        <p className="mt-1 text-sm text-slate-500">오늘 운영 현황과 이번 달 수업 일정을 한눈에 확인하세요.</p>
      </div>

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
          emptyMessage="이날 예정된 수업이 없습니다."
          showReservations
          title={formatSelectedDateTitle(period.selectedDate)}
        />
      ) : (
        <section className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">
          날짜를 누르면 해당 날의 수업과 예약자를 볼 수 있습니다.
        </section>
      )}

      <DashboardSummary metrics={todayMetrics} today={period.today} />

      <DashboardClassList
        classes={todayClasses}
        description="오늘 예정된 수업과 예약 현황입니다."
        emptyMessage="오늘 예정된 수업이 없습니다."
        showReservations={false}
        title="오늘 수업"
      />
    </section>
  );
}
