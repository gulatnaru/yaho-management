import { combineKstToUtc, formatKstDate } from "@/lib/classes/datetime";
import type { RevenuePeriod } from "@/server/revenue/types";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateParts(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function addKstDateDays(value: string, days: number): string {
  const parts = parseDateParts(value);
  if (!parts) throw new Error(`잘못된 날짜 형식입니다: ${value}`);

  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getKstMonthRange(now = new Date()): { dateFrom: string; dateTo: string } {
  const current = parseDateParts(formatKstDate(now));
  if (!current) throw new Error("현재 KST 날짜를 계산하지 못했습니다.");

  const first = `${String(current.year).padStart(4, "0")}-${String(current.month).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(current.year, current.month, 1));
  const nextMonthFirst = [
    String(nextMonth.getUTCFullYear()).padStart(4, "0"),
    String(nextMonth.getUTCMonth() + 1).padStart(2, "0"),
    "01",
  ].join("-");

  return { dateFrom: first, dateTo: addKstDateDays(nextMonthFirst, -1) };
}

export function getKstWeekRange(now = new Date()): { dateFrom: string; dateTo: string } {
  const currentDate = formatKstDate(now);
  const parts = parseDateParts(currentDate);
  if (!parts) throw new Error("현재 KST 날짜를 계산하지 못했습니다.");

  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const dateFrom = addKstDateDays(currentDate, -daysSinceMonday);
  return { dateFrom, dateTo: addKstDateDays(dateFrom, 6) };
}

export function resolveRevenuePeriod(dateFrom?: string, dateTo?: string, now = new Date()): RevenuePeriod {
  const fallback = getKstMonthRange(now);
  const hasValidRange =
    dateFrom !== undefined &&
    dateTo !== undefined &&
    parseDateParts(dateFrom) !== null &&
    parseDateParts(dateTo) !== null &&
    dateFrom <= dateTo;
  const resolved = hasValidRange ? { dateFrom, dateTo } : fallback;

  return {
    ...resolved,
    startUtc: combineKstToUtc(resolved.dateFrom, "00:00"),
    endExclusiveUtc: combineKstToUtc(addKstDateDays(resolved.dateTo, 1), "00:00"),
  };
}
