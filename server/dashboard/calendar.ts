import { parseKstDate, parseKstMonth } from "@/server/dashboard/period";
import type { DashboardCalendarCell } from "@/server/dashboard/types";
import { addKstDateDays } from "@/server/revenue/period";

export function buildMonthlyCalendar(month: string): DashboardCalendarCell[] {
  const parsed = parseKstMonth(month);
  if (!parsed) throw new Error(`잘못된 월 형식입니다: ${month}`);

  const firstDate = `${month}-01`;
  const firstDayOfWeek = new Date(Date.UTC(parsed.year, parsed.month - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  const requiredCells = firstDayOfWeek + lastDay;
  const cellCount = Math.max(35, Math.ceil(requiredCells / 7) * 7);
  const gridStart = addKstDateDays(firstDate, -firstDayOfWeek);

  return Array.from({ length: cellCount }, (_, index) => {
    const date = addKstDateDays(gridStart, index);
    const dateParts = parseKstDate(date);
    if (!dateParts) throw new Error(`캘린더 날짜를 계산하지 못했습니다: ${date}`);
    return {
      date,
      day: dateParts.day,
      inCurrentMonth: date.startsWith(`${month}-`),
    };
  });
}
