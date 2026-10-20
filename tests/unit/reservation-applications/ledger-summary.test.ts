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

import { summarizeDetailLedger, type DetailLedgerRecords } from "@/lib/reservation-applications/ledger-summary";
const detailRecords = (): DetailLedgerRecords => ({
  applications: [
    { id: "a1", status: "CONFIRMED", quotedAmount: 6000, paymentMapping: { id: "m1", paymentItem: { paidAmount: 6000 } } },
    { id: "a2", status: "SUBMITTED", quotedAmount: 6000, paymentMapping: null },
  ],
  deposits: [
    { id: "d1", amount: 10000, confirmedAt: new Date(0), allocations: [{ depositId: "d1", amount: 6000, paymentMappingId: "m1", returnObligationId: null }] },
    { id: "d2", amount: 10000, confirmedAt: new Date(1), allocations: [{ depositId: "d2", amount: 5000, paymentMappingId: null, returnObligationId: "r1" }] },
  ],
  returnObligations: [{ id: "r1", amount: 5000, returnedAmount: 2000, returns: [{ amount: 2000 }] }],
});
describe("transaction-level detail ledger validation", () => {
  it("handles partial deposits, partial confirmation and partial returns with original Q including all siblings", () => {
    expect(summarizeDetailLedger(detailRecords())).toEqual({ state: "available", Q: 12000, D: 20000, P: 6000, R: 3000, T: 2000, A: 9000 });
    const partial = detailRecords(); partial.deposits = [{ id: "d1", amount: 1000, confirmedAt: new Date(), allocations: [] }]; partial.returnObligations = []; partial.applications = partial.applications.map((row) => ({ ...row, status: "SUBMITTED", paymentMapping: null }));
    expect(summarizeDetailLedger(partial)).toMatchObject({ D: 1000, Q: 12000, P: 0, A: 1000 });
  });
  it("rejects per-source overdrawing even if aggregate deposits would cover it", () => {
    const data = detailRecords(); data.deposits[0]!.allocations.push({ depositId: "d1", amount: 5000, paymentMappingId: null, returnObligationId: "r1" }); data.deposits[1]!.allocations = [];
    expect(summarizeDetailLedger(data)).toEqual({ state: "unavailable" });
  });
  it.each(["unknown-payment", "unknown-return", "incomplete-payment", "missing-mapping", "unconfirmed-mapping", "return-history-mismatch", "over-return", "missing-quote"])("fails closed for %s", (kind) => {
    const data = detailRecords();
    if (kind === "unknown-payment") data.deposits[0]!.allocations[0]!.paymentMappingId = "foreign";
    if (kind === "unknown-return") data.deposits[1]!.allocations[0]!.returnObligationId = "foreign";
    if (kind === "incomplete-payment") data.deposits[0]!.allocations[0]!.amount = 5000;
    if (kind === "missing-mapping") data.applications[0]!.paymentMapping = null;
    if (kind === "unconfirmed-mapping") data.applications[0]!.status = "SUBMITTED";
    if (kind === "return-history-mismatch") data.returnObligations[0]!.returns = [];
    if (kind === "over-return") data.returnObligations[0]!.returnedAmount = 6000;
    if (kind === "missing-quote") data.applications[1]!.quotedAmount = null;
    expect(summarizeDetailLedger(data)).toEqual({ state: "unavailable" });
  });
  it("a post-confirmation full Refund never replenishes A or removes P", () => {
    const data = detailRecords();
    const withRefund = { ...data, applications: data.applications.map((row) => row.paymentMapping ? { ...row, paymentMapping: { ...row.paymentMapping, paymentItem: { ...row.paymentMapping.paymentItem, refundedAmount: 6000, refunds: [{ amount: 6000, status: "COMPLETED" }] } } } : row) };
    expect(summarizeDetailLedger(withRefund)).toEqual(summarizeDetailLedger(data));
    expect(summarizeDetailLedger(withRefund)).toMatchObject({ P: 6000, A: 9000 });
  });
});
