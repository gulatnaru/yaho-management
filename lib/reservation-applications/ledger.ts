/**
 * Pure balance calculations for the pre-reservation ledger. Keeping this outside UI and Prisma
 * makes the conservation rule testable for partial deposits, excesses and partial returns.
 */
export type LedgerDeposit = { id: string; amount: number; confirmedAt: Date };
export type LedgerAllocation = { depositId: string; amount: number; paymentMappingId: string | null; returnObligationId: string | null };
export type LedgerReturnObligation = { id: string; amount: number; returnedAmount: number };

export function sumAmounts(rows: ReadonlyArray<{ amount: number }>): number {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error("ledger total exceeds safe integer range");
  return total;
}

export function validateLedgerAllocations(deposits: LedgerDeposit[], allocations: LedgerAllocation[], obligations: LedgerReturnObligation[]): void {
  const depositAmounts = new Map(deposits.map((deposit) => [deposit.id, deposit.amount]));
  const usedByDeposit = new Map<string, number>();
  for (const allocation of allocations) {
    if (allocation.amount <= 0 || !depositAmounts.has(allocation.depositId)) throw new Error("invalid allocation source");
    if (Number(Boolean(allocation.paymentMappingId)) + Number(Boolean(allocation.returnObligationId)) !== 1) throw new Error("invalid allocation target");
    usedByDeposit.set(allocation.depositId, (usedByDeposit.get(allocation.depositId) ?? 0) + allocation.amount);
  }
  for (const [depositId, used] of usedByDeposit) {
    if (used > (depositAmounts.get(depositId) ?? 0)) throw new Error("deposit overdrawn");
  }
  const usedByObligation = new Map<string, number>();
  for (const allocation of allocations.filter((row) => row.returnObligationId)) {
    const obligationId = allocation.returnObligationId!;
    usedByObligation.set(obligationId, (usedByObligation.get(obligationId) ?? 0) + allocation.amount);
  }
  for (const obligation of obligations) {
    if (obligation.amount <= 0 || obligation.returnedAmount < 0 || obligation.returnedAmount > obligation.amount) throw new Error("invalid return obligation");
    const allocated = usedByObligation.get(obligation.id) ?? 0;
    if (allocated !== obligation.amount) throw new Error("return obligation is not fully funded");
  }
}

export function availableDepositAmount(deposits: LedgerDeposit[], allocations: LedgerAllocation[]): number {
  return sumAmounts(deposits) - sumAmounts(allocations);
}

/** Oldest verified deposits are consumed first. */
export function allocateFifo(deposits: LedgerDeposit[], existingAllocations: LedgerAllocation[], amount: number): Array<{ depositId: string; amount: number }> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be positive");
  const used = new Map<string, number>();
  for (const allocation of existingAllocations) used.set(allocation.depositId, (used.get(allocation.depositId) ?? 0) + allocation.amount);
  let remaining = amount;
  const result: Array<{ depositId: string; amount: number }> = [];
  for (const deposit of [...deposits].sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime() || a.id.localeCompare(b.id))) {
    const available = deposit.amount - (used.get(deposit.id) ?? 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    result.push({ depositId: deposit.id, amount: take });
    remaining -= take;
    if (remaining === 0) return result;
  }
  throw new Error("insufficient available deposit");
}
