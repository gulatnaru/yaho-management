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

export type DetailLedgerRecords = {
  applications: ReadonlyArray<{ id: string; status: string; quotedAmount: number | null; paymentMapping: { id: string; paymentItem: { paidAmount: number } } | null }>;
  deposits: Array<{ id: string; amount: number; confirmedAt: Date; allocations: Array<{ depositId: string; amount: number; paymentMappingId: string | null; returnObligationId: string | null }> }>;
  returnObligations: Array<{ id: string; amount: number; returnedAmount: number; returns: Array<{ amount: number }> }>;
};

/** Validate individual sources/targets before reusing the Phase 3 projection. Refunds are
 * deliberately not an input: an existing Payment refund never replenishes this ledger. */
export function summarizeDetailLedger(records: DetailLedgerRecords): LedgerSummary {
  try {
    const positive = (amount: number | null): amount is number => amount !== null && Number.isSafeInteger(amount) && amount > 0;
    if (!records.applications.length || records.applications.some((row) => !positive(row.quotedAmount))) return { state: "unavailable" };
    const { deposits, returnObligations: obligations } = records;
    const allocations = deposits.flatMap((row) => row.allocations);
    if (deposits.some((row) => !positive(row.amount)) || allocations.some((row) => !positive(row.amount))) return { state: "unavailable" };
    validateLedgerAllocations(deposits, allocations, obligations);
    const mappings = new Map(records.applications.flatMap((row) => row.paymentMapping ? [[row.paymentMapping.id, row.paymentMapping] as const] : []));
    const obligationIds = new Set(obligations.map((row) => row.id));
    if (allocations.some((row) => row.paymentMappingId ? !mappings.has(row.paymentMappingId) : !obligationIds.has(row.returnObligationId!))) return { state: "unavailable" };
    for (const row of records.applications) {
      if (row.status === "CONFIRMED" && !row.paymentMapping) return { state: "unavailable" };
      if (row.paymentMapping) {
        if (row.status !== "CONFIRMED") return { state: "unavailable" };
        const funded = sumAmounts(allocations.filter((allocation) => allocation.paymentMappingId === row.paymentMapping!.id));
        if (funded !== row.quotedAmount || funded !== row.paymentMapping.paymentItem.paidAmount) return { state: "unavailable" };
      }
    }
    for (const obligation of obligations) {
      if (obligation.returns.some((row) => !positive(row.amount)) || sumAmounts(obligation.returns) !== obligation.returnedAmount) return { state: "unavailable" };
    }
    return summarizeLedger("submission", {
      quote: sumAmounts(records.applications.map((row) => ({ amount: row.quotedAmount! }))),
      deposits: sumAmounts(deposits),
      paymentAllocated: sumAmounts(allocations.filter((row) => row.paymentMappingId)),
      returnFunded: sumAmounts(allocations.filter((row) => row.returnObligationId)),
      returned: sumAmounts(obligations.map((row) => ({ amount: row.returnedAmount }))),
      valid: true,
    });
  } catch { return { state: "unavailable" }; }
}
