import { z } from "zod";

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const runIdSchema = z.string().uuid();
const id = z.string().uuid();
export const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveMoney = moneySchema.refine((n) => n > 0);
export const runBodySchema = z.object({ runId: runIdSchema }).strict();
export const bootstrapSchema = z.object({ syntheticBootstrapSecret: z.string().min(32).max(256) }).strict();
export const exchangeSchema = runBodySchema.extend({ grant: tokenSchema }).strict();
export const classSchema = runBodySchema.extend({
  capacity: z.number().int().min(1).max(99).default(8),
  teacherIds: z.array(z.enum(["teacher-1", "teacher-2"])).min(1)
    .refine((ids) => new Set(ids).size === ids.length),
  quotedAmount: moneySchema,
  startsAt: z.number().int().nonnegative().max(8.64e15),
  endsAt: z.number().int().nonnegative().max(8.64e15),
}).strict().refine((value) => value.startsAt < value.endsAt);
export const linkSchema = runBodySchema.extend({ classId: id }).strict();
export const submissionSchema = runBodySchema.extend({ childId: z.string().regex(/^child-(?:[1-9]|1[0-2])$/) }).strict();
export const depositSchema = runBodySchema.extend({ applicationId: id, amount: positiveMoney, requestKey: id }).strict();
export const confirmSchema = runBodySchema.extend({ applicationId: id, confirmOverbooking: z.boolean().default(false) }).strict();
export const paymentSchema = runBodySchema.extend({ reservationId: id, amount: moneySchema, requestKey: id }).strict();
export const refundSchema = runBodySchema.extend({
  paymentId: id, amount: positiveMoney, requestKey: id,
  reason: z.enum(["CUSTOMER_REQUEST", "CLASS_CANCELLED", "OTHER"]),
  // Synthetic codes only: no free-form names, phone numbers or real customer notes.
  detail: z.enum(["SYNTHETIC_NO_SHOW_APPROVAL", "SYNTHETIC_OTHER_APPROVAL"]).optional(),
}).strict();
