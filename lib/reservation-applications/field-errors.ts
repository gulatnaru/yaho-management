import type { ZodIssue } from "zod";

export type ApplicationFieldErrors = Record<string, string>;
const messages: Record<string, string> = {
  guardianName: "보호자 이름을 입력해주세요",
  guardianPhone: "전화번호 형식을 확인해주세요",
  guardianRelationship: "보호자와의 관계를 선택해주세요",
  declaredPayerName: "입금자명을 입력해주세요",
  children: "아이는 1명부터 10명까지 입력해주세요",
  childName: "아이 이름을 입력해주세요",
  childBirthDate: "아이 생년월일을 확인해주세요. 미래 날짜는 입력할 수 없습니다",
  childGender: "아이 성별을 선택해주세요",
  classScheduleId: "아이의 클래스를 선택해주세요",
  requestedChildId: "이 기기에서 확인할 수 있는 아이를 다시 선택해주세요",
  requestNote: "요청사항은 1,000자 이내로 입력해주세요",
  programTerms: "프로그램 안전 및 이용사항을 확인해주세요",
  privacyConsent: "개인정보 수집·이용에 동의해주세요",
  legalGuardianConfirmation: "법정대리인 확인에 동의해주세요",
  refundTerms: "취소 및 환불규정을 확인해주세요",
  reviewedPriceProof: "최신 신청 금액을 다시 확인해주세요",
  consentVersion: "최신 필수 확인·동의 내용을 다시 확인해주세요",
};
const guardianFields = new Set(["guardianName", "guardianPhone", "guardianRelationship", "declaredPayerName", "children", "reviewedPriceProof", "consentVersion"]);
const childFields = new Set(["childName", "childBirthDate", "childGender", "classScheduleId", "requestedChildId", "requestNote", "programTerms", "privacyConsent", "legalGuardianConfirmation", "refundTerms"]);
/** Public responses contain fixed allowlisted messages, never a submitted value or a Zod message. */
export function mapApplicationFieldErrors(issues: readonly Pick<ZodIssue, "path">[]): ApplicationFieldErrors {
  const errors: ApplicationFieldErrors = {};
  for (const { path } of issues) {
    if (path.length === 1 && typeof path[0] === "string" && guardianFields.has(path[0])) errors[path[0]] = messages[path[0]]!;
    if (path.length !== 3 || path[0] !== "children" || typeof path[1] !== "number" || !Number.isInteger(path[1]) || path[1] < 0 || path[1] >= 10 || typeof path[2] !== "string" || !childFields.has(path[2])) continue;
    errors[`children.${path[1]}.${path[2]}`] = messages[path[2]]!;
  }
  return errors;
}

/** Phase 18 has flat child paths; it uses the same bounded fixed-message contract. */
export function mapLegacyApplicationFieldErrors(issues: readonly Pick<ZodIssue, "path">[]): ApplicationFieldErrors {
  const normalized = issues.map(({ path }) => ({ path: path.length === 1 && typeof path[0] === "string" && childFields.has(path[0]) ? ["children", 0, ...path] : path }));
  return Object.fromEntries(Object.entries(mapApplicationFieldErrors(normalized)).map(([path, message]) => [path.replace(/^children\.0\./, ""), message]));
}
