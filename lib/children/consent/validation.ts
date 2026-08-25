import { z } from "zod";

export const consentTypeSchema = z.enum(["PRIVACY", "SENSITIVE_INFO", "PHOTO_SHARE", "PHOTO_MARKETING"]);
export const consentActionSchema = z.enum(["AGREED", "REVOKED"]);

export const childConsentInputSchema = z.object({
  consentType: consentTypeSchema,
  action: consentActionSchema,
  memo: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(1000).optional(),
  ),
});

export type ConsentType = z.infer<typeof consentTypeSchema>;
export type ConsentAction = z.infer<typeof consentActionSchema>;
