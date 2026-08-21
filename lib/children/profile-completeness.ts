import type { Child } from "@prisma/client";

/**
 * ADR-010: birthDate/guardianName/guardianPhone은 선택 입력이다.
 * 셋 중 하나라도 비어 있으면 목록에서 "정보 미입력" 배지로 표시한다.
 * name은 항상 필수이므로 이 판단에 포함하지 않는다.
 */
export function isProfileIncomplete(
  child: Pick<Child, "birthDate" | "guardianName" | "guardianPhone">,
): boolean {
  return !child.birthDate || !child.guardianName || !child.guardianPhone;
}
