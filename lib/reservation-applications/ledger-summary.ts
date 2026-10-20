import { availableDepositAmount, sumAmounts, validateLedgerAllocations } from "./ledger";

export type LedgerTotals = { quote: number | null; deposits: number; paymentAllocated: number; returnFunded: number; returned: number; valid: boolean };
export type LedgerSummary = { state: "available"; Q: number; D: number; P: number; R: number; T: number; A: number } | { state: "unavailable" } | { state: "amount-unrecorded" };

/** Read projection only. Return funding already includes completed returns; never subtract twice. */
export function summarizeLedger(kind: "submission" | "legacy", totals?: LedgerTotals): LedgerSummary {
  if (kind === "legacy") return { state: "amount-unrecorded" };
  if (!totals || !totals.valid || totals.quote === null) return { state: "unavailable" };
  const { quote: Q, deposits: D, paymentAllocated: P, returnFunded: funded, returned: T } = totals;
  if (![Q, D, P, funded, T].every((amount) => Number.isSafeInteger(amount) && amount >= 0) || Q <= 0 || T > funded) return { state: "unavailable" };
  try {
    const deposits = [{ id: "aggregate", amount: D, confirmedAt: new Date(0) }];
    const allocations = [
      ...(P > 0 ? [{ depositId: "aggregate", amount: P, paymentMappingId: "payment", returnObligationId: null }] : []),
      ...(funded > 0 ? [{ depositId: "aggregate", amount: funded, paymentMappingId: null, returnObligationId: "return" }] : []),
    ];
    validateLedgerAllocations(deposits, allocations, funded > 0 ? [{ id: "return", amount: funded, returnedAmount: T }] : []);
    const used = sumAmounts([{ amount: P }, { amount: funded }]);
    const A = availableDepositAmount([{ id: "aggregate", amount: D, confirmedAt: new Date(0) }], [{ depositId: "aggregate", amount: used, paymentMappingId: "aggregate", returnObligationId: null }]);
    const R = funded - T;
    if (A < 0 || !Number.isSafeInteger(A) || D !== A + P + R + T) return { state: "unavailable" };
    return { state: "available", Q, D, P, R, T, A };
  } catch { return { state: "unavailable" }; }
}

/** Only this reduced projection may leave the list query; no allocation/return ledger DTO. */
export function listDepositSummary(summary: LedgerSummary) {
  if (summary.state !== "available") return { state: summary.state };
  return { state: "available" as const, depositedAmount: summary.D, hasOutstandingReturn: summary.R > 0 };
}
export type ListDepositSummary = ReturnType<typeof listDepositSummary>;
