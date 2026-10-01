import type { ReservationApplicationStatus } from "@prisma/client";
import { normalizePersonName, toPhoneDigits } from "./normalize";

export type DuplicateCheckApplication = {
  id: string;
  classScheduleId: string;
  childName: string;
  guardianPhone: string;
  status: ReservationApplicationStatus;
};

/** 처리 대기이거나 확정된 신청끼리만 중복 가능성을 본다. 반려·취소된 신청은 제외한다. */
const DUPLICATE_RELEVANT_STATUSES: ReadonlySet<ReservationApplicationStatus> = new Set<ReservationApplicationStatus>([
  "SUBMITTED",
  "CONFIRMED",
]);

export function toApplicantKey(childName: string, guardianPhone: string): string {
  return `${normalizePersonName(childName).toLowerCase()}|${toPhoneDigits(guardianPhone)}`;
}

/**
 * 같은 클래스에 같은 아이로 보이는(아이 이름·보호자 연락처 숫자가 같은) 신청 id 를 돌려준다.
 * 중복 신청도 접수하되 목록·상세에서 표시만 한다(ADR-053). 판정은 참고용 휴리스틱이다.
 */
export function findDuplicateApplicationIds(applications: DuplicateCheckApplication[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const application of applications) {
    if (!DUPLICATE_RELEVANT_STATUSES.has(application.status)) continue;
    const key = `${application.classScheduleId}|${toApplicantKey(application.childName, application.guardianPhone)}`;
    const ids = groups.get(key);
    if (ids) {
      ids.push(application.id);
    } else {
      groups.set(key, [application.id]);
    }
  }

  const duplicates = new Set<string>();
  for (const ids of groups.values()) {
    if (ids.length > 1) {
      for (const id of ids) duplicates.add(id);
    }
  }
  return duplicates;
}
