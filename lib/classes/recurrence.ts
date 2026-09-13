import { formatKstDate } from "@/lib/classes/datetime";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const CLASS_WEEKDAY_OPTIONS = [
  { value: 0, label: "일요일" },
  { value: 1, label: "월요일" },
  { value: 2, label: "화요일" },
  { value: 3, label: "수요일" },
  { value: 4, label: "목요일" },
  { value: 5, label: "금요일" },
  { value: 6, label: "토요일" },
] as const;

export type ClassWeekday = (typeof CLASS_WEEKDAY_OPTIONS)[number]["value"];

type CalendarDate = {
  year: number;
  month: number;
  day: number;
  utcMs: number;
};

export type RecurrenceDateErrorCode =
  | "INVALID_START_DATE"
  | "INVALID_END_DATE"
  | "START_AFTER_END"
  | "CROSS_MONTH"
  | "NO_WEEKDAY"
  | "INVALID_WEEKDAY"
  | "NO_MATCHING_DATE";

export type RecurrenceDateResult =
  | {
      success: true;
      dates: string[];
      weekdays: ClassWeekday[];
    }
  | {
      success: false;
      code: RecurrenceDateErrorCode;
      field: "repeatStartDate" | "repeatEndDate" | "weekdays";
      message: string;
    };

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, utcMs };
}

function formatCalendarDate(utcMs: number): string {
  const date = new Date(utcMs);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeWeekdays(values: readonly number[]): ClassWeekday[] | null {
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 6)) {
    return null;
  }

  return [...new Set(values)].sort((left, right) => left - right) as ClassWeekday[];
}

/**
 * 반복 범위 안에서 선택한 요일에 해당하는 날짜를 계산한다.
 * 캘린더 전용 값은 Date.UTC/getUTC* 로만 다뤄 서버 프로세스의 TZ 설정에 영향을 받지 않는다.
 */
export function generateRecurringClassDates(input: {
  repeatStartDate: string;
  repeatEndDate: string;
  weekdays: readonly number[];
}): RecurrenceDateResult {
  const start = parseCalendarDate(input.repeatStartDate);
  if (!start) {
    return {
      success: false,
      code: "INVALID_START_DATE",
      field: "repeatStartDate",
      message: "유효한 시작일을 입력해주세요",
    };
  }

  const end = parseCalendarDate(input.repeatEndDate);
  if (!end) {
    return {
      success: false,
      code: "INVALID_END_DATE",
      field: "repeatEndDate",
      message: "유효한 종료일을 입력해주세요",
    };
  }

  if (start.utcMs > end.utcMs) {
    return {
      success: false,
      code: "START_AFTER_END",
      field: "repeatEndDate",
      message: "종료일은 시작일과 같거나 나중이어야 합니다",
    };
  }

  if (start.year !== end.year || start.month !== end.month) {
    return {
      success: false,
      code: "CROSS_MONTH",
      field: "repeatEndDate",
      message: "반복 시작일과 종료일은 같은 달이어야 합니다",
    };
  }

  if (input.weekdays.length === 0) {
    return {
      success: false,
      code: "NO_WEEKDAY",
      field: "weekdays",
      message: "요일을 1개 이상 선택해주세요",
    };
  }

  const weekdays = normalizeWeekdays(input.weekdays);
  if (!weekdays) {
    return {
      success: false,
      code: "INVALID_WEEKDAY",
      field: "weekdays",
      message: "유효한 요일을 선택해주세요",
    };
  }

  const weekdaySet = new Set<number>(weekdays);
  const dates: string[] = [];
  for (let current = start.utcMs; current <= end.utcMs; current += DAY_IN_MS) {
    if (weekdaySet.has(new Date(current).getUTCDay())) {
      dates.push(formatCalendarDate(current));
    }
  }

  if (dates.length === 0) {
    return {
      success: false,
      code: "NO_MATCHING_DATE",
      field: "weekdays",
      message: "선택한 기간과 요일에 생성할 날짜가 없습니다",
    };
  }

  return { success: true, dates, weekdays };
}

/** 한 요청에서 전달받은 동일한 now를 기준으로 KST 오늘보다 이른 생성 날짜만 반환한다. */
export function findPastRecurringClassDates(dates: readonly string[], now: Date): string[] {
  const today = formatKstDate(now);
  return dates.filter((date) => date < today);
}
