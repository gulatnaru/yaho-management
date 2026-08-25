import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().max(max).optional());

export const childSafetyInfoInputSchema = z.object({
  allergies: optionalText(2000),
  emergencyNotes: optionalText(2000),
  emergencyContactName: optionalText(100),
  emergencyContactPhone: optionalText(50),
  emergencyContactRelation: optionalText(100),
});

export type ChildSafetyInfoInput = z.infer<typeof childSafetyInfoInputSchema>;
