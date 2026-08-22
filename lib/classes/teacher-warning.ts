/**
 * ADR-019: 클래스 선생님 배정 최소 인원은 1명(서버가 강제)이지만, 원칙은 2명이다.
 * 2명 미만이면 상세 화면에 경고 배너를 표시한다(차단이 아니라 경고).
 */
export const RECOMMENDED_TEACHER_COUNT = 2;

export function isUnderStaffed(teacherCount: number): boolean {
  return teacherCount < RECOMMENDED_TEACHER_COUNT;
}
