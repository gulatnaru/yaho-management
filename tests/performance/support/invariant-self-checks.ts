import { CELLS, INVARIANTS, requireFact, type Invariant } from "./contract";
import { manifest, runRoots, type Fixture, type Snapshot } from "./fixtures";
import { deriveFacts } from "./invariants";

// These private reduced rows exercise the production-facing predicates without a database.
function reduced(scenario: "FRAGMENTED" | "RETURN-HOLD" | "INSUFFICIENT"): { f: Fixture; before: Snapshot; after: Snapshot } {
  const cell = CELLS.find((c) => c.scenario === scenario && c.n === 2 && c.mode === "NEW")!;
  const f = manifest(runRoots(), cell, 1);
  const apps = f.apps.map((id, i) => ({ id, classScheduleId: f.classes[i], quotedAmount: f.quotes[i], status: cell.hold !== "NONE" && i === 1 ? "REJECTED" : "SUBMITTED", childName: f.childNames[i], childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", requestedChildId: null, childId: null, reservationId: null, consentVersion: "self-check", submittedAt: f.now, resolvedAt: null, resolvedById: null }));
  const deposits = (scenario === "FRAGMENTED" ? [30000, 70000] : [scenario === "INSUFFICIENT" ? 99999 : 100000]).map((amount, i) => ({ id: `deposit-${i}`, amount, confirmedAt: new Date(i) }));
  const obligation = { id: "hold", amount: 60000, returnedAmount: 20000 };
  const before = {
    apps, classes: f.classes.map((id, i) => ({ id, applicationPrice: f.quotes[i]! + 1000 })), children: [], consents: [], reservations: [], items: [], mappings: [], payments: [], refunds: [], deposits,
    obligations: scenario === "RETURN-HOLD" ? [obligation] : [], returns: scenario === "RETURN-HOLD" ? [{ id: "return", returnObligationId: "hold", amount: 20000 }] : [],
    allocations: scenario === "RETURN-HOLD" ? [{ id: "held", depositId: "deposit-0", paymentMappingId: null, returnObligationId: "hold", amount: 60000 }] : [],
    devices: [{ id: f.deviceIds[0] }], deviceSubmissions: [{ id: "device-submission", deviceId: f.deviceIds[0], submissionId: f.id }], deviceChildren: [], submission: { id: f.id },
  } as unknown as Snapshot;
  const after = structuredClone(before);
  if (scenario === "INSUFFICIENT") return { f, before, after };
  const paymentId = "payment";
  after.payments.push({ id: paymentId, totalAmount: f.quotes.slice(0, cell.selected).reduce((a, b) => a + b, 0), status: "PAID", method: "TRANSFER", payerType: "GUARDIAN" } as Snapshot["payments"][number]);
  for (let i = 0; i < cell.selected; i++) {
    const app = after.apps[i]!, childId = `child-${i}`, reservationId = `reservation-${i}`, itemId = `item-${i}`, mappingId = `mapping-${i}`;
    Object.assign(app, { status: "CONFIRMED", childId, reservationId, resolvedAt: f.now, resolvedById: f.roots.actors[0] });
    after.children.push({ id: childId, name: app.childName!, birthDate: app.childBirthDate, gender: "UNSPECIFIED", guardianName: f.guardianName, guardianPhone: f.guardianPhone, isActive: true, personalDataPurgedAt: null } as Snapshot["children"][number]);
    after.reservations.push({ id: reservationId, childId, classScheduleId: app.classScheduleId, status: "RESERVED", memo: null } as Snapshot["reservations"][number]);
    after.items.push({ id: itemId, paymentId, reservationId, amount: app.quotedAmount!, paidAmount: app.quotedAmount!, discountAmount: 0, refundedAmount: 0 } as Snapshot["items"][number]);
    after.mappings.push({ id: mappingId, applicationId: app.id, paymentItemId: itemId } as Snapshot["mappings"][number]);
    after.deviceChildren.push({ id: `device-child-${i}`, deviceId: f.deviceIds[0]!, childId } as Snapshot["deviceChildren"][number]);
    for (const consentType of ["PRIVACY", "PHOTO_SHARE", "PHOTO_MARKETING"] as const) after.consents.push({ id: `consent-${i}-${consentType}`, childId, consentType, action: consentType === "PRIVACY" ? "AGREED" : "DECLINED", recordedAt: app.submittedAt, recordedById: f.roots.actors[0], reservationApplicationId: app.id, consentVersion: app.consentVersion, memo: null } as Snapshot["consents"][number]);
    const pieces = scenario === "FRAGMENTED" ? i === 0 ? [["deposit-0", 30000], ["deposit-1", 10000]] as const : [["deposit-1", 60000]] as const : [["deposit-0", 40000]] as const;
    for (const [depositId, amount] of pieces) after.allocations.push({ id: `${mappingId}-${depositId}`, depositId, amount, paymentMappingId: mappingId, returnObligationId: null } as Snapshot["allocations"][number]);
  }
  return { f, before, after };
}
export function invariantMutationChecks(): number {
  const base = reduced("FRAGMENTED"), hold = reduced("RETURN-HOLD"), rejection = reduced("INSUFFICIENT");
  const run = (value: typeof base, code: Invariant, mutate: (before: Snapshot, after: Snapshot) => void, replay = true, race = true) => {
    const before = structuredClone(value.before), after = structuredClone(value.after);
    mutate(before, after);
    const facts = deriveFacts(value.f, before, after, value.f.roots.actors[0], replay, race);
    requireFact(facts[code] === false, "CALIBRATION");
  };
  const good = deriveFacts(base.f, base.before, base.after, base.f.roots.actors[0], true, true);
  requireFact(INVARIANTS.filter((code) => code !== "ROLLBACK_STATE").every((code) => good[code] === true), "CALIBRATION");
  const holdGood = deriveFacts(hold.f, hold.before, hold.after, hold.f.roots.actors[0], true, true);
  requireFact(holdGood.HELD_FUNDS && holdGood.SELECTION_ISOLATION && holdGood.LEDGER && holdGood.FIFO, "CALIBRATION");
  const bad = deriveFacts(rejection.f, rejection.before, rejection.after, rejection.f.roots.actors[0], false, false);
  requireFact(bad.ROLLBACK_STATE && bad.AVAILABLE_BACKING && bad.CHILD_STATE && bad.CONSENT_APPEND && bad.DEVICE_SCOPE, "CALIBRATION");
  run(base, "LEDGER", (_, a) => { a.allocations[0]!.amount = 30001; });
  run(base, "AVAILABLE_BACKING", (b) => { b.deposits[0]!.amount--; });
  run(base, "EXACT_LINKAGE", (_, a) => { a.items[0]!.reservationId = "unrelated"; });
  run(hold, "SELECTION_ISOLATION", (_, a) => { a.apps[1]!.requestNote = "changed"; });
  run(base, "FIXED_QUOTES", (_, a) => { a.apps[0]!.quotedAmount = 40001; });
  run(base, "NO_RECONFIRMATION", () => undefined, false);
  run(hold, "HELD_FUNDS", (_, a) => { a.returns[0]!.amount++; });
  run(base, "CHILD_STATE", (_, a) => { a.children[0]!.isActive = false; });
  run(base, "CONSENT_APPEND", (_, a) => { a.consents[0]!.recordedAt = new Date(0); });
  run(base, "CONSENT_APPEND", (_, a) => { a.apps[0]!.submittedAt = new Date(0); });
  run(base, "CONSENT_APPEND", (_, a) => { a.apps[0]!.consentVersion = "corrupt"; });
  for (const field of ["submittedAt", "consentVersion", "BOTH"] as const) run(base, "CONSENT_APPEND", (_, a) => {
    const app = a.apps[0]!;
    if (field !== "consentVersion") app.submittedAt = new Date(0);
    if (field !== "submittedAt") app.consentVersion = "corrupt";
    for (const consent of a.consents.filter((c) => c.reservationApplicationId === app.id)) {
      consent.recordedAt = app.submittedAt;
      consent.consentVersion = app.consentVersion;
    }
  });
  run(base, "DEVICE_SCOPE", (_, a) => { a.deviceChildren[0]!.childId = "unselected"; });
  run(base, "NO_REFUND", (_, a) => { a.refunds.push({ id: "refund" } as Snapshot["refunds"][number]); });
  run(rejection, "ROLLBACK_STATE", (_, a) => { a.apps[0]!.requestNote = "changed"; });
  run(base, "FIFO", (_, a) => { a.allocations[0]!.amount = 29999; a.allocations[1]!.amount = 10001; });
  run(base, "RACE_SINGLE_WINNER", () => undefined, true, false);
  return INVARIANTS.length + 8;
}
