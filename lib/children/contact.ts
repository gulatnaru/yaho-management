/**
 * 전화번호 문자열을 tel: 스킴 href 로 정규화하는 순수 함수.
 * 화면에 보이는 텍스트는 원본 형식(하이픈 포함 등)을 유지하고, href만 이 함수로 정규화한다.
 * 숫자와 선행 "+" 만 남기고 나머지(하이픈, 공백 등)는 제거한다.
 */
export function toTelHref(phone: string): string {
  const trimmed = phone.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return `tel:${hasLeadingPlus ? "+" : ""}${digits}`;
}
