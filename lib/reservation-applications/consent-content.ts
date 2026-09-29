/**
 * 예약 신청서의 확인·동의 문구(ADR-054, ADR-055). 원문은 운영자가 확정한다.
 *
 * - version: 신청마다 저장되어 어떤 문구에 동의했는지 남는다. 문구를 바꾸면 반드시 새 값으로 바꾼다.
 * - isPlaceholder: 임시 문구이면 true.
 * - pendingDecisions: 아직 사용자 결정이 남아 신청서에 넣지 못한 항목. 하나라도 있으면 Production 은 접수하지 않는다.
 *
 * 프로그램 이용사항·법정대리인·취소 및 환불규정 확인은 신청 시점의 확인 기록으로 신청에만 저장한다.
 * 개인정보·사진 공유·홍보 활용은 확정 시 ChildConsent 로 옮긴다.
 *
 * 클라이언트 컴포넌트에서도 import 하므로 다른 모듈을 import 하지 않는다.
 */

export type ApplicationConsentKey =
  | "programTerms"
  | "privacyConsent"
  | "legalGuardianConfirmation"
  | "photoShareConsent"
  | "photoMarketingConsent"
  | "refundTerms";

export type ApplicationConsentItem = {
  key: ApplicationConsentKey;
  title: string;
  required: boolean;
  /** 체크박스 옆에 보이는 확인 문구. */
  checkLabel: string;
  /** "내용 보기"로 펼쳐 보는 본문. 한 줄이 한 항목이다. */
  body: string[];
};

export type ApplicationConsentContent = {
  version: string;
  isPlaceholder: boolean;
  pendingDecisions: string[];
  items: ApplicationConsentItem[];
};

export const APPLICATION_CONSENT_CONTENT: ApplicationConsentContent = {
  // 2026-09-30 세 번째 개정: 확정 고객 보유기간 5년과 보관 목적, 보유기간 경과 후 파기 방식 반영(ADR-057)
  version: "2026-09-30-r3",
  isPlaceholder: false,
  pendingDecisions: [],
  items: [
    {
      key: "programTerms",
      title: "프로그램 안전 및 이용사항 확인",
      required: true,
      checkLabel: "위 안전 및 프로그램 이용사항을 확인하였습니다.",
      body: [
        "자연 속에서 진행하는 활동 특성상 벌레 물림, 긁힘, 넘어짐 등이 발생할 수 있습니다.",
        "보호자는 아이의 건강 상태를 고려해 참가 여부를 결정해 주세요.",
        "감기나 전염성 질환 증상이 있으면 참여를 자제해 주세요.",
        "활동 중에는 운영진의 안전 지시를 따라 주세요.",
        "다른 참가자에게 위험하거나 피해를 주는 행동은 삼가 주세요. 위험한 행동이나 활동 방해가 반복되면 참가가 제한될 수 있습니다.",
        "알레르기 등 특이사항은 수업 전에 운영자에게 미리 알려 주세요.",
        "응급상황이 발생하면 보호자에게 연락드립니다. 필요한 경우 응급조치를 하고 인근 의료기관으로 이송할 수 있습니다.",
        "기상 악화 등 불가피한 사유로 일정이 변경되거나 취소될 수 있습니다.",
      ],
    },
    {
      key: "privacyConsent",
      title: "개인정보 수집·이용 동의",
      required: true,
      checkLabel: "개인정보 수집·이용에 동의합니다.",
      body: [
        "수집 항목: 아동 이름, 아동 생년월일, 아동 성별, 보호자 이름, 보호자 연락처, 아이와의 관계, 예약 요청사항(작성한 경우)",
        "수집·이용 목적: 프로그램 예약 신청 및 확정, 참가자 확인, 프로그램 운영, 보호자 연락, 예약 및 고객 관리, 재방문 고객 관리",
        "보유 및 이용기간(예약이 확정되지 않았거나 반려·취소된 신청): 해당 수업일로부터 1년",
        "보유 및 이용기간(예약이 확정된 경우): 마지막 예약 수업일로부터 5년. 재방문 고객 관리와 고객·예약 이력의 연속적인 운영을 위해 보관하며, 동의 이력도 같은 기간 보관합니다.",
        "보유기간이 지나면 아동·보호자 정보를 알아볼 수 없게 처리하고 동의 이력·안전 정보를 삭제합니다.",
        "계약·결제·환불 등 관련 법령에 따라 보존해야 하는 거래 기록은 위 고객 정보 보유기간과 별도로 해당 법령에서 정한 기간 동안 보관합니다.",
        "동의를 거부할 권리가 있습니다. 다만 필수 개인정보 수집·이용에 동의하지 않으면 예약 신청을 진행할 수 없습니다.",
      ],
    },
    {
      key: "legalGuardianConfirmation",
      title: "법정대리인 확인",
      required: true,
      checkLabel: "본인은 위 아동의 법정대리인이며, 프로그램 신청 및 개인정보 처리에 동의합니다.",
      body: ["아동의 예약 신청과 개인정보 처리 동의는 아동의 법정대리인이 해야 합니다."],
    },
    {
      key: "photoShareConsent",
      title: "활동 사진·영상 촬영 및 참여 보호자 공유 동의",
      required: false,
      checkLabel: "활동 사진·영상 촬영 및 참여 보호자 공유에 동의합니다.",
      body: [
        "프로그램 진행 중 아이의 사진과 영상이 촬영될 수 있습니다.",
        "촬영한 사진과 영상은 해당 수업에 참여한 아동의 보호자들이 함께 있는 단체 대화방 또는 이에 준하는 공유 공간에 제공될 수 있습니다.",
        "목적: 수업 활동 기록 및 보호자 공유",
        "제공 대상: 해당 수업에 참여한 아동의 보호자",
        "제공 항목: 아이의 사진 및 영상",
        "선택 동의이며, 동의하지 않아도 프로그램 참가에 제한이 없습니다.",
        "동의하지 않은 아이는 가능한 범위에서 촬영·공유 대상에서 제외합니다.",
        "공유한 뒤 다른 보호자의 기기에 저장된 사본은 YAHO가 삭제할 수 없을 수 있습니다.",
      ],
    },
    {
      key: "photoMarketingConsent",
      title: "사진·영상 YAHO 홍보 활용 동의",
      required: false,
      checkLabel: "사진·영상 YAHO 홍보 활용에 동의합니다.",
      body: [
        "목적: YAHO 프로그램 소개 및 홍보",
        "사용 채널: Instagram, 블로그, 기타 YAHO 공식 온라인 채널",
        "이용 항목: 활동 중 촬영한 아이의 사진 및 영상",
        "보유 및 이용기간: 동의를 철회할 때까지 또는 홍보 목적이 종료될 때까지. 철회하지 않았더라도 홍보 목적이 종료되면 추가로 활용하지 않습니다.",
        "선택 동의이며, 동의하지 않아도 프로그램 참가에 제한이 없습니다.",
        "동의는 언제든지 철회할 수 있습니다. 철회 요청 이후에는 해당 아동의 사진·영상을 새로운 홍보물에 사용하지 않습니다.",
        "YAHO가 직접 관리하는 Instagram, 블로그 등 온라인 게시물은 철회 요청 시 가능한 범위에서 삭제하거나 비공개 처리합니다.",
        "이미 제작·배포된 인쇄물은 회수가 어려울 수 있습니다.",
        "제3자가 이미 저장하거나 공유한 사진·영상 사본은 YAHO가 삭제할 수 없을 수 있습니다.",
      ],
    },
    {
      key: "refundTerms",
      title: "취소 및 환불규정 확인",
      required: true,
      checkLabel: "취소 및 환불규정을 확인하였습니다.",
      body: [
        "수업일 7일 전까지 취소: 전액 환불",
        "수업일 6일 전부터 4일 전까지 취소: 실제 결제금액(할인 반영 후)의 50% 환불",
        "수업일 3일 전부터 수업 당일까지 취소: 환불 불가",
        "모집 인원 미달로 YAHO가 클래스를 취소한 경우: 전액 환불",
        "YAHO 운영 사정으로 클래스를 취소한 경우: 전액 환불",
        "기상 악화·안전 문제 등으로 YAHO가 클래스 자체를 취소한 경우: 전액 환불",
        "클래스가 정상 운영되는 상태에서 우천 등을 이유로 개별 취소하는 경우: 환불 불가",
      ],
    },
  ],
};

/**
 * Production 에서는 확정 원문이고 남은 결정이 없을 때만 접수한다.
 * 로컬·테스트 환경은 개발·E2E 를 위해 그대로 동작한다(Preview 는 availability 에서 따로 닫는다).
 */
export function isConsentContentReady(
  vercelEnv: string | undefined,
  content: Pick<ApplicationConsentContent, "isPlaceholder" | "pendingDecisions"> = APPLICATION_CONSENT_CONTENT,
): boolean {
  if (vercelEnv === "production") return !content.isPlaceholder && content.pendingDecisions.length === 0;
  return true;
}
