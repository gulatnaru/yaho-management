/**
 * 예약 등록 폼의 ?classScheduleId=/?childId= 프리필이 후보 목록에 없을 때 보여줄 사유 문자열을
 * 판단하는 순수 함수 모음. DB 접근 없이 이미 조회된 상세 결과만으로 판단한다.
 *
 * app/(admin)/reservations/new/page.tsx 가 이 함수들을 호출하는 흐름:
 * 1. 후보 목록(listScheduledClassCandidatesWithCapacity / listActiveChildCandidates)에 프리필 id가
 *    없으면 getClassDetail/getChildDetail 로 실제 상태를 조회한다.
 * 2. 조회 결과를 이 함수에 넘겨 구체적인 사유 문자열을 얻는다.
 * 경고일 뿐 폼 제출 자체를 막지 않는다 — 사용자가 다른 값을 선택하면 정상 제출된다.
 */

export type ClassPrefillDetail = { status: string; endsAt: Date } | null;
export type ChildPrefillDetail = { isActive: boolean } | null;

/**
 * classScheduleId 프리필이 클래스 후보 목록에 없는 이유를 판단한다.
 * - 조회 결과 없음: 클래스를 찾을 수 없다.
 * - status !== "SCHEDULED": 취소되었거나 완료됐다.
 * - status === "SCHEDULED" 인데 endsAt 이 이미 지났으면(ADR-026, 표시상 ENDED): 이미 종료됐다
 *   (listScheduledClassCandidatesWithCapacity 가 표시상 ENDED 인 클래스도 후보에서 제외하므로).
 * - 그 외(=표시상 SCHEDULED인데 후보에 없음): 정원이 가득 찼다는 뜻이다.
 */
export function resolveClassPrefillWarning(classDetail: ClassPrefillDetail, now: Date = new Date()): string | null {
  if (classDetail === null) {
    return "선택한 클래스를 찾을 수 없습니다.";
  }
  if (classDetail.status !== "SCHEDULED") {
    return "선택한 클래스는 이미 취소되었거나 완료되었습니다.";
  }
  if (classDetail.endsAt < now) {
    return "선택한 클래스는 이미 종료되었습니다.";
  }
  return "선택한 클래스는 정원이 가득 찼습니다.";
}

/**
 * childId 프리필이 아이 후보 목록에 없는 이유를 판단한다.
 * - 조회 결과 없음: 아이를 찾을 수 없다.
 * - isActive === false: 비활성 상태다.
 * - 그 외(=활성인데 후보에 없음): listActiveChildCandidates 는 모든 활성 아이를 페이지네이션 없이
 *   반환하므로 정상적으로는 발생하지 않는다. 알려진 사유가 없으므로 경고를 표시하지 않는다.
 */
export function resolveChildPrefillWarning(childDetail: ChildPrefillDetail): string | null {
  if (childDetail === null) {
    return "선택한 아이를 찾을 수 없습니다.";
  }
  if (childDetail.isActive === false) {
    return "선택한 아이는 비활성 상태입니다.";
  }
  return null;
}
