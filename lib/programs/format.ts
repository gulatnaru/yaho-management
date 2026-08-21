/**
 * 프로그램 표시용 순수 포맷 함수 모음.
 * Date/타임존을 다루지 않는다 — 숫자/문자열 변환만 한다.
 */

export function formatTargetAgeRange(min: number | null, max: number | null): string {
  if (min === null && max === null) {
    return "제한 없음";
  }
  if (min !== null && max === null) {
    return `만 ${min}세 이상`;
  }
  if (min === null && max !== null) {
    return `만 ${max}세 이하`;
  }
  return `만 ${min}~${max}세`;
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) {
    return "–";
  }
  return `${minutes}분`;
}

export function formatPrice(amount: number): string {
  return `${amount.toLocaleString()}원`;
}
