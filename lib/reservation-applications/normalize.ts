/** 연락처에서 숫자만 남긴다. 하이픈·공백 등 표기 차이를 무시하고 비교하기 위해 쓴다. */
export function toPhoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

/** 이름 앞뒤 공백을 지우고 연속 공백을 하나로 줄인다. */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
