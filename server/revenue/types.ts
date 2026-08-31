import type { RevenueFilterInput } from "@/lib/validation/revenue";

export type RevenuePaymentMethod = Exclude<RevenueFilterInput["paymentMethod"], "all">;
export type RevenueRefundState = Exclude<RevenueFilterInput["refundState"], "all">;

export interface RevenuePeriod {
  dateFrom: string;
  dateTo: string;
  startUtc: Date;
  endExclusiveUtc: Date;
}

export interface RevenueQueryFilters extends RevenuePeriod {
  programId?: string;
  classScheduleId?: string;
  paymentMethod?: RevenuePaymentMethod;
  refundState?: RevenueRefundState;
}

export interface RevenueMetrics {
  reservationCount: number;
  cancellationCount: number;
  participantCount: number;
  amount: number;
  discountAmount: number;
  paidAmount: number;
  refundedAmount: number;
  netRevenue: number;
}

export interface RevenueClassContext {
  classScheduleId: string;
  programId: string;
  programName: string;
  startsAt: Date;
}

export interface OperationFact extends RevenueClassContext {
  reservationCount: number | bigint | string | null;
  cancellationCount: number | bigint | string | null;
  participantCount: number | bigint | string | null;
}

export interface PaymentFact extends RevenueClassContext {
  amount: number | bigint | string | null;
  discountAmount: number | bigint | string | null;
  paidAmount: number | bigint | string | null;
}

export interface RefundFact extends RevenueClassContext {
  refundedAmount: number | bigint | string | null;
}

export interface RevenueClassRow extends RevenueClassContext, RevenueMetrics {}

export interface RevenueProgramRow extends RevenueMetrics {
  programId: string;
  programName: string;
  classCount: number;
}

export interface RevenueReport {
  summary: RevenueMetrics;
  programs: RevenueProgramRow[];
  classes: RevenueClassRow[];
}
