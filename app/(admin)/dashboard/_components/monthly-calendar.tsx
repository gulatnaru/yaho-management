import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardCalendarCell, DashboardCalendarDayMetric } from "@/server/dashboard/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dashboardHref(month: string, date?: string) {
  const query = new URLSearchParams({ month });
  if (date) query.set("date", date);
  return `/dashboard?${query.toString()}`;
}

export function MonthlyCalendar({
  month,
  previousMonth,
  nextMonth,
  today,
  selectedDate,
  cells,
  metrics,
}: {
  month: string;
  previousMonth: string;
  nextMonth: string;
  today: string;
  selectedDate?: string;
  cells: DashboardCalendarCell[];
  metrics: DashboardCalendarDayMetric[];
}) {
  const [year, monthNumber] = month.split("-");
  const metricByDate = new Map(metrics.map((metric) => [metric.date, metric]));

  return (
    <section aria-labelledby="calendar-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" id="calendar-heading">이번 달 수업 일정</h2>
          <p className="text-sm text-slate-500">날짜를 누르면 해당 날의 수업과 예약자를 볼 수 있습니다.</p>
        </div>
        <nav aria-label="캘린더 월 이동" className="flex items-center gap-2 text-sm">
          <Link className="rounded-md border bg-white px-3 py-2 hover:bg-slate-50" href={dashboardHref(previousMonth)}>
            이전 달
          </Link>
          <Link
            className="rounded-md border bg-white px-3 py-2 hover:bg-slate-50"
            href={dashboardHref(today.slice(0, 7), today)}
          >
            오늘
          </Link>
          <Link className="rounded-md border bg-white px-3 py-2 hover:bg-slate-50" href={dashboardHref(nextMonth)}>
            다음 달
          </Link>
        </nav>
      </div>

      <div className="rounded-lg border bg-white shadow-sm" data-testid="monthly-calendar">
        <p className="border-b px-3 py-3 text-center font-semibold tabular-nums">{year}년 {Number(monthNumber)}월</p>
        <div className="grid grid-cols-7" role="row">
          {WEEKDAYS.map((weekday, index) => (
            <div
              className={cn(
                "border-b py-2 text-center text-xs font-medium text-slate-500",
                index === 0 && "text-red-600",
                index === 6 && "text-blue-600",
              )}
              key={weekday}
              role="columnheader"
            >
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const metric = metricByDate.get(cell.date) ?? {
              classCount: 0,
              operationReservationCount: 0,
            };
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDate;
            const content = (
              <>
                <span className="text-xs font-semibold tabular-nums sm:text-sm">{cell.day}</span>
                {cell.inCurrentMonth && metric.classCount > 0 ? (
                  <span className="mt-1 space-y-0.5 text-[10px] leading-tight text-slate-600 sm:text-xs">
                    <span className="block tabular-nums">{metric.classCount}수업</span>
                    <span className="block tabular-nums">{metric.operationReservationCount}명</span>
                  </span>
                ) : null}
              </>
            );

            return cell.inCurrentMonth ? (
              <Link
                aria-current={isSelected ? "date" : undefined}
                aria-label={
                  metric.classCount > 0
                    ? `${cell.date}, 수업 ${metric.classCount}개, 예약 ${metric.operationReservationCount}명`
                    : cell.date
                }
                className={cn(
                  "min-h-20 border-b border-r p-1.5 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900 sm:min-h-28 sm:p-2",
                  isToday && "bg-amber-50 ring-1 ring-inset ring-amber-400",
                  isSelected && "bg-slate-100 ring-2 ring-inset ring-slate-900",
                )}
                data-date={cell.date}
                href={dashboardHref(month, cell.date)}
                key={cell.date}
              >
                {content}
              </Link>
            ) : (
              <div
                aria-hidden="true"
                className="min-h-20 border-b border-r bg-slate-50 p-1.5 text-slate-300 sm:min-h-28 sm:p-2"
                key={cell.date}
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
