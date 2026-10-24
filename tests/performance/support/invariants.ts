import { isDeepStrictEqual as equal } from "node:util";
import { validateLedgerAllocations } from "../../../lib/reservation-applications/ledger";
import { summarizeDetailLedger, type LedgerSummary } from "../../../lib/reservation-applications/ledger-summary";
import { emptyCodes, requireFact, SafeFailure, type CodeCounters, type Invariant } from "./contract";
import type { Fixture, Snapshot } from "./fixtures";

export class AssertionGate {
  readonly counts = emptyCodes();
  constructor(readonly expected: readonly Invariant[]) {
    requireFact(new Set(expected).size === expected.length && expected.length > 0, "ASSERTION_MISSING");
    for (const code of expected) this.counts[code].expected++;
  }
  check(code: Invariant, fact: boolean): void {
    requireFact(this.expected.includes(code) && this.counts[code].executed === 0, "ASSERTION_MISSING");
    this.counts[code].executed++;
    if (!fact) { this.counts[code].fail++; throw new SafeFailure(code); }
    this.counts[code].pass++;
  }
  finish(): CodeCounters {
    requireFact(this.expected.every((code) => this.counts[code].expected === 1 && this.counts[code].executed === 1 && this.counts[code].pass === 1 && this.counts[code].fail === 0), "ASSERTION_MISSING");
    return this.counts;
  }
}
export type Facts = Partial<Record<Invariant, boolean>>;
export function assertFacts(gate: AssertionGate, facts: Facts): CodeCounters {
  for (const code of gate.expected) if (Object.hasOwn(facts, code)) gate.check(code, facts[code] === true);
  return gate.finish();
}
export function ledger(s: Snapshot): LedgerSummary {
  try {
    validateLedgerAllocations(s.deposits, s.allocations, s.obligations);
    return summarizeDetailLedger({
      applications: s.apps.map((a) => { const m = s.mappings.find((m) => m.applicationId === a.id); const item = s.items.find((i) => i.id === m?.paymentItemId); return { id: a.id, status: a.status, quotedAmount: a.quotedAmount, paymentMapping: m && item ? { id: m.id, paymentItem: { paidAmount: item.paidAmount } } : null }; }),
      deposits: s.deposits.map((d) => ({ ...d, allocations: s.allocations.filter((a) => a.depositId === d.id) })),
      returnObligations: s.obligations.map((o) => ({ ...o, returns: s.returns.filter((r) => r.returnObligationId === o.id) })),
    });
  } catch { return { state: "unavailable" }; }
}
const sorted = (values: readonly string[]) => [...values].sort();
const idsEqual = (a: readonly string[], b: readonly string[]) => equal(sorted(a), sorted(b));
const total = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
function isConserved(value: LedgerSummary): boolean { return value.state === "available" && [value.D, value.A, value.P, value.R, value.T].every((v) => Number.isSafeInteger(v) && v >= 0) && value.D === value.A + value.P + value.R + value.T; }
export function expectedInvariants(f: Fixture): Invariant[] {
  const common: Invariant[] = ["LEDGER", "AVAILABLE_BACKING", "SELECTION_ISOLATION", "FIXED_QUOTES", "HELD_FUNDS", "CHILD_STATE", "CONSENT_APPEND", "DEVICE_SCOPE", "NO_REFUND"];
  if (f.cell.expected !== "SUCCESS") return [...common, "ROLLBACK_STATE"];
  return [...common, "EXACT_LINKAGE", "NO_RECONFIRMATION", "FIFO", ...(f.cell.scenario === "SAME-SUBMISSION RACE" ? ["RACE_SINGLE_WINNER" as const] : [])];
}
export function deriveFacts(f: Fixture, before: Snapshot, after: Snapshot, actor: string, replayUnchanged: boolean, raceSingleWinner: boolean): Facts {
  const selectedIds = f.apps.slice(0, f.cell.selected), selectedSet = new Set(selectedIds);
  const selected = after.apps.filter((a) => selectedSet.has(a.id));
  const unselected = (s: Snapshot) => s.apps.filter((a) => !selectedSet.has(a.id));
  const beforeLedger = ledger(before), afterLedger = ledger(after);
  const success = f.cell.expected === "SUCCESS";
  const quoteTotal = total(f.quotes.slice(0, f.cell.selected));
  const newReservations = after.reservations.filter((r) => !before.reservations.some((b) => b.id === r.id));
  const newPayments = after.payments.filter((r) => !before.payments.some((b) => b.id === r.id));
  const newItems = after.items.filter((r) => !before.items.some((b) => b.id === r.id));
  const newMappings = after.mappings.filter((r) => !before.mappings.some((b) => b.id === r.id));
  const selectedChildIds = selected.flatMap((a) => a.childId ? [a.childId] : []);
  const originalChildrenUnchanged = before.children.every((child) => equal(child, after.children.find((a) => a.id === child.id)));
  const expectedNewChildren = success && f.cell.mode === "NEW" ? f.cell.selected : 0;
  const actualNewChildren = after.children.filter((a) => !before.children.some((b) => b.id === a.id));
  const appChildrenCorrect = success && selected.every((a) => { const child = after.children.find((c) => c.id === a.childId); return child && child.name === a.childName && equal(child.birthDate, a.childBirthDate) && child.gender === a.childGender && child.guardianName === f.guardianName && child.guardianPhone === f.guardianPhone && child.isActive && child.personalDataPurgedAt === null && (f.cell.mode !== "EXISTING" || a.childId === a.requestedChildId); });
  const appendedConsents = after.consents.filter((a) => !before.consents.some((b) => b.id === a.id));
  const priorConsentsPreserved = before.consents.every((c) => equal(c, after.consents.find((a) => a.id === c.id)));
  const consentFieldsPreserved = before.apps.every((a) => {
    const stored = after.apps.find((b) => b.id === a.id);
    return stored && equal(stored.submittedAt, a.submittedAt) && stored.consentVersion === a.consentVersion;
  });
  const selectedBefore = before.apps.filter((a) => selectedSet.has(a.id));
  const consentValid = consentFieldsPreserved && priorConsentsPreserved && appendedConsents.length === (success ? 3 * f.cell.selected : 0) && (!success || selectedBefore.length === f.cell.selected && selectedBefore.every((a) => {
    const stored = after.apps.find((b) => b.id === a.id);
    const records = appendedConsents.filter((c) => c.reservationApplicationId === a.id);
    return records.length === 3 && ["PRIVACY", "PHOTO_SHARE", "PHOTO_MARKETING"].every((kind) => {
      const matches = records.filter((c) => c.consentType === kind);
      const c = matches[0];
      return matches.length === 1 && c && stored && c.childId === stored.childId && c.action === (kind === "PRIVACY" ? "AGREED" : f.cell.mode === "NEW" ? "DECLINED" : "REVOKED") && equal(c.recordedAt, a.submittedAt) && c.consentVersion === a.consentVersion && c.recordedById === actor && c.memo === null;
    });
  }));
  const deviceValid = equal(before.devices, after.devices) && equal(before.deviceSubmissions, after.deviceSubmissions) && (success ? after.deviceChildren.length === f.deviceIds.length * f.cell.selected && after.deviceChildren.every((d) => f.deviceIds.includes(d.deviceId) && selectedChildIds.includes(d.childId)) && f.deviceIds.every((id) => idsEqual(after.deviceChildren.filter((d) => d.deviceId === id).map((d) => d.childId), selectedChildIds)) : equal(before.deviceChildren, after.deviceChildren));
  const holdAllocations = (s: Snapshot) => s.allocations.filter((a) => a.returnObligationId !== null);
  const protectedHolds = equal(before.obligations, after.obligations) && equal(before.returns, after.returns) && equal(holdAllocations(before), holdAllocations(after)) && beforeLedger.state === "available" && afterLedger.state === "available" && beforeLedger.R === afterLedger.R && beforeLedger.T === afterLedger.T;
  const exactLinkage = newPayments.length === 1 && newPayments[0]!.totalAmount === quoteTotal && newPayments[0]!.status === "PAID" && newPayments[0]!.method === "TRANSFER" && newPayments[0]!.payerType === "GUARDIAN" && newItems.length === f.cell.selected && newMappings.length === f.cell.selected && newReservations.length === f.cell.selected && new Set(selectedChildIds).size === f.cell.selected && new Set(newItems.map((i) => i.reservationId)).size === f.cell.selected && selected.every((a) => {
    const mapping = newMappings.find((m) => m.applicationId === a.id);
    const item = newItems.find((i) => i.id === mapping?.paymentItemId);
    const reservation = newReservations.find((r) => r.id === a.reservationId);
    return mapping && item && reservation && reservation.childId === a.childId && reservation.classScheduleId === a.classScheduleId && reservation.status === "RESERVED" && reservation.memo === null && item.reservationId === reservation.id && item.paymentId === newPayments[0]!.id && item.amount === a.quotedAmount && item.paidAmount === a.quotedAmount && item.discountAmount === 0 && item.refundedAmount === 0 && total(after.allocations.filter((alloc) => alloc.paymentMappingId === mapping.id).map((alloc) => alloc.amount)) === a.quotedAmount;
  });
  const availableBacking = beforeLedger.state === "available" && afterLedger.state === "available" && equal(before.deposits, after.deposits) && (success ? afterLedger.P - beforeLedger.P === quoteTotal && quoteTotal <= beforeLedger.A && afterLedger.A === beforeLedger.A - quoteTotal : equal(beforeLedger, afterLedger));
  const selectionValid = equal(unselected(before), unselected(after)) && (success ? idsEqual(after.apps.filter((a) => a.status === "CONFIRMED").map((a) => a.id), selectedIds) && selected.every((a) => a.resolvedById === actor && equal(a.resolvedAt, f.now)) && newMappings.every((m) => selectedSet.has(m.applicationId)) && appendedConsents.every((c) => c.reservationApplicationId !== null && selectedSet.has(c.reservationApplicationId)) && after.deviceChildren.every((d) => selectedChildIds.includes(d.childId)) : equal(before.apps, after.apps));
  const quotesValid = before.apps.length === f.cell.n && after.apps.length === f.cell.n && before.apps.every((a) => a.quotedAmount === after.apps.find((b) => b.id === a.id)?.quotedAmount && a.quotedAmount === f.quotes[f.apps.indexOf(a.id)]) && after.classes.every((c) => c.applicationPrice === f.quotes[f.classes.indexOf(c.id)]! + 1000) && equal(before.classes, after.classes);
  let fifo = true;
  const used = new Map<string, number>();
  for (const a of before.allocations) used.set(a.depositId, (used.get(a.depositId) ?? 0) + a.amount);
  for (const appId of selectedIds) {
    const app = after.apps.find((a) => a.id === appId)!;
    const mapping = after.mappings.find((m) => m.applicationId === appId);
    let remaining = app?.quotedAmount ?? 0;
    const expected: Array<{ depositId: string; amount: number }> = [];
    for (const d of before.deposits) { const take = Math.min(d.amount - (used.get(d.id) ?? 0), remaining); if (take > 0) { expected.push({ depositId: d.id, amount: take }); used.set(d.id, (used.get(d.id) ?? 0) + take); remaining -= take; } }
    const actual = after.allocations.filter((a) => a.paymentMappingId === mapping?.id).map(({ depositId, amount }) => ({ depositId, amount })).sort((a, b) => a.depositId.localeCompare(b.depositId));
    fifo &&= remaining === 0 && equal(expected.sort((a, b) => a.depositId.localeCompare(b.depositId)), actual);
  }
  if (f.cell.scenario === "FRAGMENTED") {
    const first = after.mappings.find((m) => m.applicationId === selectedIds[0]);
    const allocations = after.allocations.filter((a) => a.paymentMappingId === first?.id);
    fifo &&= allocations.length === 2 && allocations.some((a) => a.depositId === before.deposits[0]?.id && a.amount === 30000) && allocations.some((a) => a.depositId === before.deposits[1]?.id && a.amount === 10000);
  }
  return {
    LEDGER: isConserved(beforeLedger) && isConserved(afterLedger), AVAILABLE_BACKING: availableBacking,
    EXACT_LINKAGE: exactLinkage, SELECTION_ISOLATION: selectionValid, FIXED_QUOTES: quotesValid, NO_RECONFIRMATION: replayUnchanged,
    HELD_FUNDS: protectedHolds, CHILD_STATE: originalChildrenUnchanged && actualNewChildren.length === expectedNewChildren && (success ? appChildrenCorrect && (f.cell.mode === "EXISTING" || idsEqual(actualNewChildren.map((c) => c.id), selectedChildIds)) : equal(before.children, after.children)),
    CONSENT_APPEND: consentValid, DEVICE_SCOPE: deviceValid, NO_REFUND: before.refunds.length === 0 && after.refunds.length === 0,
    ROLLBACK_STATE: equal(before, after), FIFO: fifo, RACE_SINGLE_WINNER: raceSingleWinner && exactLinkage,
  };
}
