import type { ConsentAction, ConsentType } from "@prisma/client";

export type PlannedConsentRecord = { consentType: ConsentType; action: ConsentAction };

/**
 * 선택 동의 한 종류의 기록 행동(ADR-055).
 * - 신청에서 동의 → AGREED
 * - 동의하지 않았고 기존 현재 상태가 AGREED → REVOKED(기존 동의 철회, ADR-054)
 * - 동의하지 않았고 기존 동의가 없거나 이미 철회·미동의 → DECLINED(미동의)
 * 현재 상태는 기존 규칙대로 가장 최근 기록으로 판단한다(20-1.4).
 */
export function planOptionalConsentAction(agreed: boolean, currentAction: ConsentAction | null): ConsentAction {
  if (agreed) return "AGREED";
  return currentAction === "AGREED" ? "REVOKED" : "DECLINED";
}

/**
 * 신청을 확정할 때 해당 아이의 ChildConsent 에 추가할 행(append-only, ADR-054/055).
 * 개인정보 수집·이용은 필수 동의라 항상 AGREED 이고, 선택 동의 두 종류는 동의·미동의를 모두 기록한다.
 * 프로그램 이용사항·법정대리인 확인은 동의 이력이 아니라 신청의 확인 기록으로 남는다.
 */
export function planApplicationConsentRecords(input: {
  photoShareConsentAgreed: boolean;
  photoMarketingConsentAgreed: boolean;
  currentPhotoShareAction: ConsentAction | null;
  currentPhotoMarketingAction: ConsentAction | null;
}): PlannedConsentRecord[] {
  return [
    { consentType: "PRIVACY", action: "AGREED" },
    {
      consentType: "PHOTO_SHARE",
      action: planOptionalConsentAction(input.photoShareConsentAgreed, input.currentPhotoShareAction),
    },
    {
      consentType: "PHOTO_MARKETING",
      action: planOptionalConsentAction(input.photoMarketingConsentAgreed, input.currentPhotoMarketingAction),
    },
  ];
}
