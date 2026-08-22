/**
 * 클래스 일정의 날짜/시간을 KST(Asia/Seoul, 고정 +09:00) 기준으로 다루는 순수 함수 모음.
 *
 * ClassSchedule.startsAt/endsAt 은 DB 에 UTC 로 저장되지만, 운영자는 항상 KST 벽시계 시각으로
 * 입력하고 조회한다. 서버 프로세스의 로컬 타임존 설정(TZ 환경변수)과 무관하게 항상 같은 결과를
 * 내야 한다 — Phase 2 calculateAge() 류 타임존 버그(로컬 getter 의존) 재발 방지가 목적이다.
 *
 * - KST -> UTC 변환(combineKstToUtc)은 날짜/시간 문자열을 직접 파싱해 고정 오프셋(+09:00)으로
 *   계산한다. `new Date()`의 로컬 getter/setter 에 의존하지 않는다.
 * - UTC -> KST 표시(formatKst*)는 `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })` 을
 *   사용한다. 이 API 는 프로세스의 로컬 타임존 설정과 무관하게 항상 지정한 타임존 기준으로
 *   계산한다.
 */

const KST_OFFSET_MINUTES = 9 * 60;
const MS_PER_MINUTE = 60 * 1000;

/**
 * KST 벽시계 날짜/시간 문자열을 UTC Date 로 변환한다.
 * @param date "YYYY-MM-DD" 형식
 * @param time "HH:MM" 형식
 */
export function combineKstToUtc(date: string, time: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());

  if (!dateMatch || !timeMatch) {
    throw new Error(`잘못된 날짜/시간 형식입니다: date=${date}, time=${time}`);
  }

  const [, yearStr, monthStr, dayStr] = dateMatch;
  const [, hourStr, minuteStr] = timeMatch;

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // Date.UTC 로 "그 숫자들을 그대로 UTC 시각인 것처럼" 계산한 뒤, KST(UTC+9) 오프셋만큼 빼서
  // 실제 UTC 시각을 구한다. 로컬 타임존 getter/setter 를 전혀 사용하지 않는다.
  const asIfUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const utcMs = asIfUtcMs - KST_OFFSET_MINUTES * MS_PER_MINUTE;

  return new Date(utcMs);
}

type KstParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

const kstPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function getKstParts(d: Date): KstParts {
  const parts = kstPartsFormatter.formatToParts(d);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  // 일부 ICU 구현은 hour12:false 일 때 자정을 "24:00"으로 표기한다. "00:00"으로 정규화한다.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
  };
}

/** 저장된 UTC Date 를 KST 기준 "YYYY-MM-DD" 문자열로 변환한다. */
export function formatKstDate(d: Date): string {
  const { year, month, day } = getKstParts(d);
  return `${year}-${month}-${day}`;
}

/** 저장된 UTC Date 를 KST 기준 "HH:MM" 문자열로 변환한다. */
export function formatKstTime(d: Date): string {
  const { hour, minute } = getKstParts(d);
  return `${hour}:${minute}`;
}

/**
 * 시작/종료 시각을 KST 기준으로 사람이 읽기 좋은 범위 문자열로 만든다.
 * 같은 날이면 날짜를 한 번만 표기하고, 날짜가 다르면 양쪽 다 표기한다.
 * 예) "2026-09-05 09:00 ~ 11:00" / "2026-09-05 23:00 ~ 2026-09-06 01:00"
 */
export function formatKstDateTimeRange(startsAt: Date, endsAt: Date): string {
  const startDate = formatKstDate(startsAt);
  const endDate = formatKstDate(endsAt);
  const startTime = formatKstTime(startsAt);
  const endTime = formatKstTime(endsAt);

  if (startDate === endDate) {
    return `${startDate} ${startTime} ~ ${endTime}`;
  }

  return `${startDate} ${startTime} ~ ${endDate} ${endTime}`;
}
