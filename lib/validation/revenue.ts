import { z } from "zod";

export const REVENUE_PAYMENT_METHODS = ["CARD", "TRANSFER", "CASH", "OTHER"] as const;
export const REVENUE_REFUND_STATES = ["NONE", "PARTIAL", "FULL"] as const;

const optionalId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.string().min(1).optional(),
);

const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
);

export const revenueFilterSchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
  programId: optionalId,
  classScheduleId: optionalId,
  paymentMethod: z.enum(["all", ...REVENUE_PAYMENT_METHODS]).catch("all").default("all"),
  refundState: z.enum(["all", ...REVENUE_REFUND_STATES]).catch("all").default("all"),
});

export type RevenueFilterInput = z.infer<typeof revenueFilterSchema>;
