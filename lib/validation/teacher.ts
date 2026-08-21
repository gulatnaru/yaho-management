import { z } from "zod";

const phoneRegex = /^[0-9-]{9,20}$/;
const MIN_PHONE_DIGIT_COUNT = 9;

export const teacherInputSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해주세요"),
  phone: z
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

export type TeacherInput = z.infer<typeof teacherInputSchema>;
