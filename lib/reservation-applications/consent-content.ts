/**
 * 예약 신청서의 동의 문구(ADR-054). 원문은 운영자가 제공한다.
 *
 * 원문을 넣을 때:
 * 1. 각 항목의 body 를 운영자가 확정한 문구로 바꾼다.
 * 2. version 을 새 값(예: "2026-10-01")으로 바꾼다. 신청마다 이 값이 저장되어 어떤 문구에 동의했는지 남는다.
 * 3. isPlaceholder 를 false 로 바꾼다. Production 은 isPlaceholder 가 true 인 동안 신청을 받지 않는다.
 *
 * 클라이언트 컴포넌트에서도 import 하므로 다른 모듈을 import 하지 않는다.
 */

export type ApplicationConsentKey = "privacyConsent" | "photoShareConsent" | "photoMarketingConsent";

export type ApplicationConsentItem = {
  key: ApplicationConsentKey;
  title: string;
  required: boolean;
  body: string;
};

export type ApplicationConsentContent = {
  version: string;
  isPlaceholder: boolean;
  items: ApplicationConsentItem[];
};

const PLACEHOLDER_BODY =
  "동의 문구 원문이 아직 확정되지 않았습니다. 운영 환경에서는 이 문구로 신청을 받지 않습니다.";

export const APPLICATION_CONSENT_CONTENT: ApplicationConsentContent = {
  version: "placeholder",
  isPlaceholder: true,
  items: [
    { key: "privacyConsent", title: "개인정보 수집·이용 동의", required: true, body: PLACEHOLDER_BODY },
    {
      key: "photoShareConsent",
      title: "활동 사진 촬영 및 보호자 공유 동의",
      required: true,
      body: PLACEHOLDER_BODY,
    },
    {
      key: "photoMarketingConsent",
      title: "활동 사진 홍보·마케팅 활용 동의",
      required: false,
      body: PLACEHOLDER_BODY,
    },
  ],
};

/** Production 에서는 확정된 원문일 때만 접수한다. 로컬·테스트 환경은 임시 문구로도 동작한다. */
export function isConsentContentReady(
  vercelEnv: string | undefined,
  content: Pick<ApplicationConsentContent, "isPlaceholder"> = APPLICATION_CONSENT_CONTENT,
): boolean {
  if (vercelEnv === "production") return !content.isPlaceholder;
  return true;
}
