import { z } from "zod";

export const ACCOUNT_ROLES = ["ADMIN", "MANAGER", "TEACHER"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const emailSchema = z.string().trim().email("올바른 이메일 주소를 입력해주세요").max(320);
const nameSchema = z.string().trim().min(1, "이름을 입력해주세요").max(100, "이름은 100자 이하여야 합니다");
const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다")
  .max(128, "비밀번호는 128자 이하여야 합니다");
const teacherIdSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => value || null);

function validateRoleTeacher(
  value: { role: AccountRole; teacherId?: string | null },
  context: z.RefinementCtx,
) {
  if (value.role === "TEACHER" && !value.teacherId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["teacherId"],
      message: "선생님 계정에 연결할 선생님을 선택해주세요",
    });
  }

  if (value.role !== "TEACHER" && value.teacherId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["teacherId"],
      message: "관리자와 준관리자 계정에는 선생님을 연결할 수 없습니다",
    });
  }
}

export const accountCreateSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(ACCOUNT_ROLES),
    teacherId: teacherIdSchema,
    isActive: z.boolean(),
    temporaryPassword: passwordSchema,
  })
  .superRefine(validateRoleTeacher);

export const accountUpdateSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(ACCOUNT_ROLES),
    teacherId: teacherIdSchema,
    isActive: z.boolean(),
  })
  .superRefine(validateRoleTeacher);

export const adminPasswordResetSchema = z.object({
  temporaryPassword: passwordSchema,
});

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "현재 비밀번호를 입력해주세요").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "새 비밀번호를 다시 입력해주세요").max(128),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "새 비밀번호가 일치하지 않습니다",
      });
    }
  });

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type AdminPasswordResetInput = z.infer<typeof adminPasswordResetSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
