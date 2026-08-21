/**
 * 만 나이를 계산한다. birthDate가 없으면 null을 반환한다.
 */
export function calculateAge(birthDate: Date | null, today: Date = new Date()): number | null {
  if (!birthDate) {
    return null;
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}
