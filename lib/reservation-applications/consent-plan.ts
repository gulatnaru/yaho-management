import type { ConsentAction, ConsentType } from "@prisma/client";

export type PlannedConsentRecord = { consentType: ConsentType; action: ConsentAction };

/**
 * 신청을 확정할 때 해당 아이의 ChildConsent 에 추가할 행을 계산한다(ADR-054, append-only).
 * - 개인정보 수집·이용, 활동 사진 촬영·공유는 신청 필수 동의이므로 항상 AGREED.
 * - 홍보 활용은 신청에서 동의했으면 AGREED.
 * - 홍보 활용에 동의하지 않았고 기존 아이의 현재 상태가 AGREED 이면 REVOKED 를 추가한다.
 *   현재 상태는 기존 규칙대로 가장 최근 기록으로 판단한다(20-1.4).
 */
export function planApplicationConsentRecords(input: {
  photoMarketingConsentAgreed: boolean;
  currentPhotoMarketingAction: ConsentAction | null;
}): PlannedConsentRecord[] {
  const records: PlannedConsentRecord[] = [
    { consentType: "PRIVACY", action: "AGREED" },
    { consentType: "PHOTO_SHARE", action: "AGREED" },
  ];

  if (input.photoMarketingConsentAgreed) {
    records.push({ consentType: "PHOTO_MARKETING", action: "AGREED" });
  } else if (input.currentPhotoMarketingAction === "AGREED") {
    records.push({ consentType: "PHOTO_MARKETING", action: "REVOKED" });
  }

  return records;
}
