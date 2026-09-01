import { combineKstToUtc, formatKstDate } from "@/lib/classes/datetime";
import type { DashboardSearchInput } from "@/lib/validation/dashboard";
import type { DashboardPeriod } from "@/server/dashboard/types";
import { addKstDateDays } from "@/server/revenue/period";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function makeUtcCalendarDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function parseKstDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000) return null;
  const candidate = makeUtcCalendarDate(year, month - 1, day);

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function parseKstMonth(value: string) {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1000 || month < 1 || month > 12) return null;
  return { year, month };
}

function formatMonth(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function addKstMonths(value: string, months: number): string {
  const parsed = parseKstMonth(value);
  if (!parsed) throw new Error(`잘못된 월 형식입니다: ${value}`);
  const shifted = makeUtcCalendarDate(parsed.year, parsed.month - 1 + months, 1);
  return formatMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

export function resolveDashboardPeriod(input: DashboardSearchInput, now = new Date()): DashboardPeriod {
  const today = formatKstDate(now);
  const currentMonth = today.slice(0, 7);
  const month = input.month && parseKstMonth(input.month) ? input.month : currentMonth;
  const selectedDate =
    input.date && parseKstDate(input.date) && input.date.startsWith(`${month}-`) ? input.date : undefined;
  const monthStart = `${month}-01`;
  const nextMonthStart = `${addKstMonths(month, 1)}-01`;

  return {
    month,
    selectedDate,
    today,
    startUtc: combineKstToUtc(monthStart, "00:00"),
    endExclusiveUtc: combineKstToUtc(nextMonthStart, "00:00"),
    todayStartUtc: combineKstToUtc(today, "00:00"),
    tomorrowStartUtc: combineKstToUtc(addKstDateDays(today, 1), "00:00"),
  };
}

export function getKstDayPeriod(date: string) {
  if (!parseKstDate(date)) throw new Error(`잘못된 날짜 형식입니다: ${date}`);
  return {
    startUtc: combineKstToUtc(date, "00:00"),
    endExclusiveUtc: combineKstToUtc(addKstDateDays(date, 1), "00:00"),
  };
}
