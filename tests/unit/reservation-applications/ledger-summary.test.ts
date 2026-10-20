import { describe, expect, it } from "vitest";
import { listDepositSummary, summarizeLedger, type LedgerTotals } from "@/lib/reservation-applications/ledger-summary";
const totals: LedgerTotals = { quote: 12000, deposits: 20000, paymentAllocated: 6000, returnFunded: 5000, returned: 2000, valid: true };
describe("read-only family ledger projection", () => {
  it("preserves D=A+P+R+T without subtracting completed returns twice", () => expect(summarizeLedger("submission", totals)).toEqual({ state: "available", Q: 12000, D: 20000, P: 6000, R: 3000, T: 2000, A: 9000 }));
  it.each([{ quote: null }, { quote: 0 }, { valid: false }, { deposits: 1000 }, { returned: 5001 }, { paymentAllocated: -1 }, { deposits: Number.MAX_SAFE_INTEGER + 1 }])("reports unavailable for invalid totals %j", (change) => expect(summarizeLedger("submission", { ...totals, ...change })).toEqual({ state: "unavailable" }));
  it("distinguishes missing reads and legacy amount-unrecorded from zero", () => {
    expect(summarizeLedger("submission")).toEqual({ state: "unavailable" });
    expect(summarizeLedger("legacy")).toEqual({ state: "amount-unrecorded" });
  });
  it("only exposes key deposit state and action flag to list consumers", () => expect(listDepositSummary(summarizeLedger("submission", totals))).toEqual({ state: "available", depositedAmount: 20000, hasOutstandingReturn: true }));
});
