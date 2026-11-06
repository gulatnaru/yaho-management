import { z } from "zod";

export const ACCOUNT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "TEACHER", "STAFF"] as const;
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

/**
 * P2 (OQ-8): 임시 비밀번호 경로 폐지. 직접 등록은 비밀번호 없이 생성되며
 * 계정은 비활성 상태로 초대 수락(P3)을 통해서만 활성화된다. 따라서 생성 스키마에
 * 비밀번호 입력이 없다. 기존 계정의 인증정보 재설정은 adminPasswordResetSchema 경유로
 * 별도 유지한다 (발급 경로가 아니라 지원 기능).
 */
export const accountCreateSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(ACCOUNT_ROLES),
    teacherId: teacherIdSchema,
    isActive: z.boolean(),
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

/**
 * P3 초대 발급 스키마. 단순화 결정(ADR-071): SUPER_ADMIN도 일반 초대 경로의 역할
 * 선택지에 포함되며, zod enum(ACCOUNT_ROLES)도 SUPER_ADMIN을 허용한다.
 * TEACHER면 teacherId 필수, 비-TEACHER면 teacherId 금지 (validateRoleTeacher).
 */
export const invitationIssueSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(ACCOUNT_ROLES),
    teacherId: teacherIdSchema,
  })
  .superRefine(validateRoleTeacher);

/**
 * P3 초대 수락 비밀번호 스키마. 기존 기준(8~128자)을 따르며, 본인이 직접
 * 설정하는 초기 비밀번호이다 (임시 비밀번호 발급 경로가 아니다 — OQ-8 폐지 유지).
 */
export const invitationAcceptSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "새 비밀번호를 다시 입력해주세요").max(128),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "새 비밀번호가 일치하지 않습니다",
      });
    }
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
export type InvitationIssueInput = z.infer<typeof invitationIssueSchema>;
export type InvitationAcceptInput = z.infer<typeof invitationAcceptSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
