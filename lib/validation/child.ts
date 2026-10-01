import { z } from "zod";
import { Gender } from "@prisma/client";

// Phase 18 예약 신청서도 같은 연락처 규칙을 재사용한다.
export const phoneRegex = /^[0-9-]{9,20}$/;
export const MIN_PHONE_DIGIT_COUNT = 9;

export const childInputSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해주세요"),
  birthDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "유효한 날짜가 아닙니다")
    .refine((v) => !v || new Date(v) <= new Date(), "미래 날짜는 입력할 수 없습니다"),
  gender: z.nativeEnum(Gender).default(Gender.UNSPECIFIED),
  guardianName: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : undefined))
    .refine((v) => v === undefined || v.length > 0, "보호자 이름은 공백일 수 없습니다"),
  guardianPhone: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || phoneRegex.test(v), "전화번호 형식이 올바르지 않습니다 (숫자, 하이픈만 가능)")
    .refine(
      (v) => !v || (v.match(/[0-9]/g)?.length ?? 0) >= MIN_PHONE_DIGIT_COUNT,
      "전화번호는 숫자를 9자 이상 포함해야 합니다",
    ),
  memo: z.string().optional(),
});

export type ChildInput = z.infer<typeof childInputSchema>;
