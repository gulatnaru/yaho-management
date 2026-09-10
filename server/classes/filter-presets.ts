import { formatKstDate } from "@/lib/classes/datetime";
import type { ClassListStatus } from "@/lib/classes/query-builder";
import { getKstMonthRange, getKstWeekRange } from "@/server/revenue/period";

export type ClassDatePreset = "today" | "week" | "month";
export type ClassDateRange = { dateFrom: string; dateTo: string };

export function getClassDatePresets(now = new Date()): Record<ClassDatePreset, ClassDateRange> {
  const today = formatKstDate(now);
  return {
    today: { dateFrom: today, dateTo: today },
    week: getKstWeekRange(now),
    month: getKstMonthRange(now),
  };
}

export function getActiveClassDatePreset(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  presets: Record<ClassDatePreset, ClassDateRange>,
): ClassDatePreset | undefined {
  if (!dateFrom || !dateTo) return undefined;

  return (Object.entries(presets) as Array<[ClassDatePreset, ClassDateRange]>).find(
    ([, range]) => range.dateFrom === dateFrom && range.dateTo === dateTo,
  )?.[0];
}

export function buildClassListHref(params: {
  dateFrom?: string;
  dateTo?: string;
  status: ClassListStatus;
  page?: number;
}) {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.status !== "SCHEDULED") query.set("status", params.status);
  if (params.page !== undefined) query.set("page", String(params.page));
  const suffix = query.toString();
  return suffix ? `/classes?${suffix}` : "/classes";
}
