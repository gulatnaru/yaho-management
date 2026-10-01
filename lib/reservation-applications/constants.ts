/**
 * 예약 신청(Phase 18) 화면과 서버가 함께 쓰는 상수.
 * 클라이언트 컴포넌트에서도 import 하므로 서버 전용 모듈(@prisma/client, node:crypto 등)을 import 하지 않는다.
 */

/** 확정 폼에서 "신청 정보로 새 아이 등록"을 뜻하는 선택값. */
export const NEW_CHILD_CHOICE = "NEW";

/** 무효·중지·마감 링크에 공통으로 보여주는 문구. 사유와 클래스 존재 여부를 드러내지 않는다(ADR-052). */
export const APPLICATION_CLOSED_MESSAGE = "현재 신청을 받지 않는 링크입니다.";

export const APPLICATION_RETRY_MESSAGE = "잠시 후 다시 시도해 주세요.";

/** 요청사항 입력란 안내. 건강정보는 신청 단계에서 받지 않는다(ADR-054). */
export const APPLICATION_REQUEST_NOTE_GUIDE =
  "건강·알레르기 정보는 적지 말아 주세요. 필요한 안전 정보는 예약 확정 후 따로 여쭙니다.";

export const APPLICATION_NAME_MAX_LENGTH = 50;
export const APPLICATION_REQUEST_NOTE_MAX_LENGTH = 1000;
export const APPLICATION_RESOLUTION_NOTE_MAX_LENGTH = 500;
export const APPLICATION_RESERVATION_MEMO_MAX_LENGTH = 1000;

export const APPLICATION_GENDER_OPTIONS = [
  { value: "MALE", label: "남" },
  { value: "FEMALE", label: "여" },
  { value: "UNSPECIFIED", label: "선택 안 함" },
] as const;

/** 아이와의 관계(법정대리인 확인, ADR-055). */
export const GUARDIAN_RELATIONSHIP_OPTIONS = [
  { value: "FATHER", label: "부" },
  { value: "MOTHER", label: "모" },
  { value: "OTHER_LEGAL_GUARDIAN", label: "기타 법정대리인" },
] as const;

export const GUARDIAN_RELATIONSHIP_LABEL: Record<"FATHER" | "MOTHER" | "OTHER_LEGAL_GUARDIAN", string> = {
  FATHER: "부",
  MOTHER: "모",
  OTHER_LEGAL_GUARDIAN: "기타 법정대리인",
};

/** 보관기간 만료로 파기된 신청의 개인정보 자리 표시. */
export const PURGED_PERSONAL_DATA_LABEL = "(파기됨)";

export const APPLICATION_GENDER_LABEL: Record<"MALE" | "FEMALE" | "UNSPECIFIED", string> = {
  MALE: "남",
  FEMALE: "여",
  UNSPECIFIED: "선택 안 함",
};

export const APPLICATION_STATUS_LABEL: Record<"SUBMITTED" | "CONFIRMED" | "REJECTED" | "CANCELLED", string> = {
  SUBMITTED: "처리 대기",
  CONFIRMED: "확정",
  REJECTED: "반려",
  CANCELLED: "취소",
};
