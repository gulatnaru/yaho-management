import { z } from "zod";
import { Gender, GuardianRelationship } from "@prisma/client";
import {
  APPLICATION_NAME_MAX_LENGTH,
  APPLICATION_REQUEST_NOTE_MAX_LENGTH,
  APPLICATION_RESERVATION_MEMO_MAX_LENGTH,
  APPLICATION_RESOLUTION_NOTE_MAX_LENGTH,
} from "@/lib/reservation-applications/constants";
import { MIN_PHONE_DIGIT_COUNT, phoneRegex } from "@/lib/validation/child";

/** "YYYY-MM-DD"가 실제로 존재하는 날짜인지 확인한다(예: 2019-02-30 거부). */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requiredText(message: string, maxLength: number, maxMessage: string) {
  return z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message)
    .max(maxLength, maxMessage);
}

function optionalText(maxLength: number, maxMessage: string) {
  return z.preprocess(
    (value) =>
      value === null || value === undefined || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().max(maxLength, maxMessage).optional(),
  );
}

/** 체크박스는 체크되면 "on", 아니면 FormData 에 값이 없다. 필수 동의는 true 만 통과한다. */
function agreedCheckbox(message: string) {
  return z.preprocess(
    (value) => value === "on" || value === true,
    z.literal(true, { errorMap: () => ({ message }) }),
  );
}

const optionalCheckbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

/**
 * 비로그인 보호자의 예약 신청서(ADR-054, ADR-055).
 * 필수 입력: 아이 이름·생년월일·성별(선택 안 함 허용)·보호자 이름·보호자 연락처·아이와의 관계, 선택: 요청사항.
 * 필수 확인: 프로그램 안전 및 이용사항, 개인정보 수집·이용, 법정대리인 확인, 취소 및 환불규정(ADR-056).
 * 선택 동의: 사진·영상 촬영 및 참여 보호자 공유, 사진·영상 홍보 활용.
 * 연락처와 생년월일 규칙은 관리자 아이 등록(lib/validation/child.ts)과 같다.
 */
export const reservationApplicationSubmissionSchema = z.object({
  childName: requiredText(
    "아이 이름을 입력해주세요",
    APPLICATION_NAME_MAX_LENGTH,
    `아이 이름은 ${APPLICATION_NAME_MAX_LENGTH}자 이하로 입력해주세요`,
  ),
  childBirthDate: z
    .string({ required_error: "생년월일을 입력해주세요", invalid_type_error: "생년월일을 입력해주세요" })
    .trim()
    .min(1, "생년월일을 입력해주세요")
    .refine(isCalendarDate, "유효한 날짜가 아닙니다")
    .refine((value) => new Date(value) <= new Date(), "미래 날짜는 입력할 수 없습니다"),
  childGender: z.nativeEnum(Gender, { errorMap: () => ({ message: "성별을 선택해주세요" }) }),
  guardianName: requiredText(
    "보호자 이름을 입력해주세요",
    APPLICATION_NAME_MAX_LENGTH,
    `보호자 이름은 ${APPLICATION_NAME_MAX_LENGTH}자 이하로 입력해주세요`,
  ),
  guardianPhone: z
    .string({ required_error: "보호자 연락처를 입력해주세요", invalid_type_error: "보호자 연락처를 입력해주세요" })
    .trim()
    .min(1, "보호자 연락처를 입력해주세요")
    .refine((value) => phoneRegex.test(value), "전화번호 형식이 올바르지 않습니다 (숫자, 하이픈만 가능)")
    .refine(
      (value) => (value.match(/[0-9]/g)?.length ?? 0) >= MIN_PHONE_DIGIT_COUNT,
      "전화번호는 숫자를 9자 이상 포함해야 합니다",
    ),
  guardianRelationship: z.nativeEnum(GuardianRelationship, {
    errorMap: () => ({ message: "아이와의 관계를 선택해주세요" }),
  }),
  requestNote: optionalText(
    APPLICATION_REQUEST_NOTE_MAX_LENGTH,
    `요청사항은 ${APPLICATION_REQUEST_NOTE_MAX_LENGTH}자 이하로 입력해주세요`,
  ),
  programTerms: agreedCheckbox("프로그램 안전 및 이용사항을 확인해주세요"),
  privacyConsent: agreedCheckbox("개인정보 수집·이용에 동의해주세요"),
  legalGuardianConfirmation: agreedCheckbox("법정대리인 확인에 동의해주세요"),
  photoShareConsent: optionalCheckbox,
  photoMarketingConsent: optionalCheckbox,
  refundTerms: agreedCheckbox("취소 및 환불규정을 확인해주세요"),
});

export type ReservationApplicationSubmission = z.infer<typeof reservationApplicationSubmissionSchema>;

/** 반려·취소 사유(ADR-053). */
export const applicationResolutionSchema = z.object({
  resolutionNote: requiredText(
    "사유를 입력해주세요",
    APPLICATION_RESOLUTION_NOTE_MAX_LENGTH,
    `사유는 ${APPLICATION_RESOLUTION_NOTE_MAX_LENGTH}자 이하로 입력해주세요`,
  ),
});

/**
 * 예약 확정 입력. childChoice 는 기존 아이 id 또는 NEW_CHILD_CHOICE 다.
 * 초과 예약 확인값은 (신청 id, 아이 선택)에 묶는다 — 새 아이는 재시도마다 id 가 달라지기 때문이다.
 */
export const applicationConfirmSchema = z.object({
  childChoice: z
    .string({ required_error: "연결할 아이를 선택해주세요", invalid_type_error: "연결할 아이를 선택해주세요" })
    .trim()
    .min(1, "연결할 아이를 선택해주세요"),
  memo: optionalText(
    APPLICATION_RESERVATION_MEMO_MAX_LENGTH,
    `예약 메모는 ${APPLICATION_RESERVATION_MEMO_MAX_LENGTH}자 이하로 입력해주세요`,
  ),
  confirmOverbooking: z.enum(["true"]).optional(),
  confirmedApplicationId: z.string().trim().min(1).optional(),
  confirmedChildChoice: z.string().trim().min(1).optional(),
});

export type ApplicationConfirmInput = z.infer<typeof applicationConfirmSchema>;
