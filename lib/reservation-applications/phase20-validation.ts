import { z } from "zod";
import { GuardianRelationship, Gender } from "@prisma/client";
import { MIN_PHONE_DIGIT_COUNT, phoneRegex } from "@/lib/validation/child";
import { isCalendarDate } from "@/lib/validation/reservation-application";
import { combineKstToUtc } from "@/lib/classes/datetime";

/** PostgreSQL `integer` is signed 32-bit. Financial writes must fit the column and totals. */
export const MAX_POSTGRES_INTEGER = 2_147_483_647;

const requiredText = (message: string, maximum = 100) => z.string().trim().min(1, message).max(maximum);
const httpsUrl = z.string().trim().url().refine((value) => value.startsWith("https://"), "HTTPS 주소만 사용할 수 있습니다");
const agreed = (message: string) => z.preprocess((value) => value === "on" || value === true, z.literal(true, { errorMap: () => ({ message }) }));
const optionalChecked = z.preprocess((value) => value === "on" || value === true, z.boolean());

const positiveMoney = (message: string) => z.coerce.number()
  .int(message)
  .positive(message)
  .max(MAX_POSTGRES_INTEGER, `${message} (최대 ${MAX_POSTGRES_INTEGER.toLocaleString("ko-KR")}원)`);

export const applicationPriceSchema = positiveMoney("신청 금액은 1원 이상의 정수여야 합니다");

/**
 * `datetime-local` has no timezone. Parse it as a real KST calendar value instead of allowing
 * the server process timezone to reinterpret it through `new Date(value)`.
 */
export function parseKstDateTime(value: unknown, now = new Date()): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!match || !isCalendarDate(match[1]!)) return null;
  const [hour, minute] = match[2]!.split(":").map(Number);
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) return null;
  const date = combineKstToUtc(match[1]!, match[2]!);
  return date.getTime() <= now.getTime() ? date : null;
}

const pastOrCurrentKstDateTime = (message: string) => z.string().trim().transform((value, ctx) => {
  const parsed = parseKstDateTime(value);
  if (!parsed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  }
  return parsed;
});

export const reservationApplicationSettingsSchema = z.object({
  bankName: requiredText("은행명을 입력해주세요", 100),
  accountNumber: requiredText("계좌번호를 입력해주세요", 100),
  accountHolder: requiredText("예금주를 입력해주세요", 100),
  blogUrl: httpsUrl,
  instagramUrl: httpsUrl,
  kakaoChannelUrl: httpsUrl,
});

export const groupClassInputSchema = z.object({
  classScheduleId: z.string().trim().min(1),
});

export const groupCreateSchema = z.object({
  classScheduleIds: z.array(z.string().trim().min(1)).min(1).max(100).refine((items) => new Set(items).size === items.length, "클래스를 중복 선택할 수 없습니다"),
});

const childSchema = z.object({
  classScheduleId: z.string().trim().min(1),
  requestedChildId: z.string().trim().min(1).optional(),
  childName: requiredText("아이 이름을 입력해주세요", 50),
  childBirthDate: z.string().refine(isCalendarDate, "유효한 날짜가 아닙니다").refine((value) => new Date(`${value}T00:00:00.000Z`).getTime() <= Date.now(), "미래 날짜는 입력할 수 없습니다"),
  childGender: z.nativeEnum(Gender),
  requestNote: z.string().trim().max(1000).optional().transform((value) => value || undefined),
  programTerms: agreed("프로그램 안전 및 이용사항을 확인해주세요"),
  privacyConsent: agreed("개인정보 수집·이용에 동의해주세요"),
  legalGuardianConfirmation: agreed("법정대리인 확인에 동의해주세요"),
  refundTerms: agreed("취소 및 환불규정을 확인해주세요"),
  photoShareConsent: optionalChecked,
  photoMarketingConsent: optionalChecked,
});

export const groupSubmissionSchema = z.object({
  guardianName: requiredText("보호자 이름을 입력해주세요", 50),
  guardianPhone: z.string().trim().regex(phoneRegex, "전화번호 형식이 올바르지 않습니다 (숫자, 하이픈만 가능)").refine((value) => value.replace(/[^0-9]/g, "").length >= MIN_PHONE_DIGIT_COUNT, "전화번호는 숫자를 9자 이상 포함해야 합니다"),
  guardianRelationship: z.nativeEnum(GuardianRelationship),
  declaredPayerName: requiredText("입금자명을 입력해주세요", 50),
  children: z.array(childSchema).min(1).max(10).refine((items) => new Set(items.map((item) => item.requestedChildId).filter(Boolean)).size === items.filter((item) => item.requestedChildId).length, "같은 아이를 중복 선택할 수 없습니다"),
});

export const depositInputSchema = z.object({
  amount: positiveMoney("입금액은 1원 이상의 정수여야 합니다"),
  payerName: requiredText("실제 입금자명을 입력해주세요", 50),
  depositedAt: pastOrCurrentKstDateTime("실제 KST 입금일시를 확인해주세요"),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
});

export const returnInputSchema = z.object({
  amount: positiveMoney("반환 금액은 1원 이상의 정수여야 합니다"),
  reason: requiredText("반환 사유를 입력해주세요", 500),
  returnedAt: pastOrCurrentKstDateTime("실제 KST 반환일시를 확인해주세요"),
  idempotencyKey: z.string().trim().min(16).max(200),
});

export const submissionConfirmationSchema = z.object({
  submissionId: z.string().trim().min(1),
  choices: z.array(z.object({
    applicationId: z.string().trim().min(1),
    childId: z.string().trim().min(1).optional(),
    newChild: z.boolean().optional(),
    memo: z.string().trim().max(1000).optional(),
    confirmOverbooking: z.boolean().optional(),
    overbookingConfirmation: z.object({
      applicationId: z.string().trim().min(1),
      classScheduleId: z.string().trim().min(1),
      childChoice: z.string().trim().min(1),
      selectionFingerprint: z.string().trim().min(2).max(5_000),
    }).optional(),
  }).refine((choice) => Boolean(choice.childId) !== Boolean(choice.newChild), "아이 선택이 필요합니다")).min(1).max(10)
    .refine((choices) => new Set(choices.map((choice) => choice.applicationId)).size === choices.length, "아이별 신청은 한 번만 선택할 수 있습니다"),
});
