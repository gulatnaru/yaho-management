import { z } from "zod";

export const passwordSchema = z.string().min(8).max(128);

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: passwordSchema,
});

export const loginSchema = credentialsSchema;

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "새 비밀번호가 일치하지 않습니다.",
      });
    }
  });

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
