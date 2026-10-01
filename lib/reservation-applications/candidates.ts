import { normalizePersonName, toPhoneDigits } from "./normalize";

export type ChildCandidateRow = {
  id: string;
  name: string;
  birthDate: Date | null;
  guardianName: string | null;
  guardianPhone: string | null;
  isActive: boolean;
};

export type ApplicationChildCandidate = ChildCandidateRow & {
  matchesName: boolean;
  matchesPhone: boolean;
};

function score(candidate: ApplicationChildCandidate): number {
  return (candidate.matchesName ? 2 : 0) + (candidate.matchesPhone ? 1 : 0);
}

/**
 * 확정 폼의 기존 아이 후보(ADR-053). 이름 또는 보호자 연락처가 같은 아이를 후보로 두고,
 * 둘 다 같은 아이를 먼저 보여준다. 자동으로 연결하지 않으며 ADMIN 이 직접 고른다.
 */
export function rankChildCandidates(
  rows: ChildCandidateRow[],
  application: { childName: string; guardianPhone: string },
): ApplicationChildCandidate[] {
  const name = normalizePersonName(application.childName);
  const phoneDigits = toPhoneDigits(application.guardianPhone);

  return rows
    .map((row) => ({
      ...row,
      matchesName: normalizePersonName(row.name) === name,
      matchesPhone: phoneDigits.length > 0 && toPhoneDigits(row.guardianPhone) === phoneDigits,
    }))
    .filter((candidate) => candidate.matchesName || candidate.matchesPhone)
    .sort((a, b) => score(b) - score(a));
}
