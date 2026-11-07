import { describe, expect, it } from "vitest";
import { getBudgetSummary, calculateSyntheticReconciliation, evaluateSyntheticSendCost } from "@/server/kakao/budget";
import { reconcileCost, correctPurgedPrismaCost, correctionBinding, reserveSyntheticLookup, syntheticLookupBinding } from "@/server/kakao/budget";
import { PrismaDispatchRepository, purgePrismaCostSummary, summaryPurgeBinding, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";

const quote = { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true };
const exposure = { dayRequests: 19, monthRequests: 199, message: 2985000, total: 4985000 };
describe("synthetic budget preflight", () => {
  it("includes exact ceilings and rejects any overage", () => {
    expect(evaluateSyntheticSendCost({ quote, exposure })).toEqual({ ok: true, amount: 15000 });
    expect(evaluateSyntheticSendCost({ quote, exposure: { ...exposure, message: 2985001 } })).toEqual({ ok: false });
    expect(evaluateSyntheticSendCost({ quote, exposure: { ...exposure, dayRequests: 20 } })).toEqual({ ok: false });
    expect(evaluateSyntheticSendCost({ quote: { ...quote, requiredRequestFee: 500 }, exposure })).toEqual({ ok: false });
  });
  it("fails closed for unknown, unapproved and unsafe cost inputs", () => {
    for (const patch of [{ lookup: null }, { monthlyPlan: null }, { planApproved: false }, { setup: 1 }, { lookup: -1 }, { send: 0.5 }, { send: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(evaluateSyntheticSendCost({ quote: { ...quote, ...patch }, exposure })).toEqual({ ok: false });
    }
  });
  it("warns at the request or exposure threshold", () => {
    expect(getBudgetSummary({ dayRequests: 0, monthRequests: 159, message: 2399999, total: 2399999 })?.warning).toBe(false);
    expect(getBudgetSummary({ dayRequests: 0, monthRequests: 160, message: 2399999, total: 2399999 })?.warning).toBe(true);
    expect(getBudgetSummary({ dayRequests: 0, monthRequests: 0, message: 2400000, total: 2400000 })?.warning).toBe(true);
  });
  it("retains the difference absent non-billable evidence", () => {
    expect(calculateSyntheticReconciliation({ reserved: 15000, confirmed: 14300, nonBillableEvidence: false })).toEqual({ confirmed: 14300, reserved: 700 });
    expect(calculateSyntheticReconciliation({ reserved: 15000, confirmed: 14300, nonBillableEvidence: true })).toEqual({ confirmed: 14300, reserved: 0 });
    expect(calculateSyntheticReconciliation({ reserved: 15000, confirmed: 0, nonBillableEvidence: false })).toEqual({ confirmed: 0, reserved: 15000 });
  });
});

it("rejects an absolute target after cost summary purge without recreating the detail", async () => {
  const responses: unknown[][] = [
    [{ ownerId: "owner", costExecutorId: "actor", policyVersion: "v1", revision: 1 }],
    [{ dispatchId: "dispatch", outboxId: "outbox", recipientId: "recipient" }],
    [{ id: "outbox" }], [{ userId: "recipient_user" }],
    ["owner", "actor"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false })),
    [{ id: "recipient" }], [{ id: "dispatch", outboxId: "outbox", recipientId: "recipient", auditSequence: 0 }],
    [{ actorId: "owner", slotId: "slot", commandId: "command", evidenceId: "evidence" }], [],
    [{ id: "slot", dispatchId: "dispatch", dayKey: "2026-10-28", monthKey: "2026-10", reservedMilliKrw: 0n, confirmedMilliKrw: null, adjustmentMilliKrw: 0n, adjustmentCommandId: "command", adjustmentApprovalId: "approval", adjustmentEvidenceId: "evidence", costState: "summary_purged", detailPurgedAt: new Date("2026-10-28T00:00:00Z") }],
    [{ id: "daily", reservedMilliKrw: 0n, confirmedMilliKrw: 14300n }],
    [{ id: "monthly", reservedMilliKrw: 0n, confirmedMilliKrw: 14300n }], [{ count: 0n }], [],
  ];
  const writes: string[] = [];
  const tx: PrismaGuardTransaction = {
    async $queryRaw<T>(): Promise<T> { const next = responses.shift(); if (!next) throw new Error("Unexpected query"); return next as T; },
    async $executeRaw(strings) { writes.push(strings.join("?")); return 1; },
  };
  const client: PrismaGuardClient = { async $transaction(work) { return work(tx); } };
  const command = { commandId: "command", slotId: "slot", actorId: "actor", approvalId: "approval", evidenceId: "evidence", confirmed: 0, nonBillableEvidence: true, at: new Date("2026-10-28T00:00:00Z") };
  await expect(reconcileCost(new PrismaDispatchRepository(client), command)).rejects.toThrow();
  expect(writes).toEqual([]);
});

it("archives and nulls completed Prisma cost in one synthetic transaction", async () => {
  const due = new Date("2027-10-28T00:00:00Z");
  const command = { commandId: "purgecost", dispatchId: "dispatch", actorId: "actor", approvalId: "approval", evidenceId: "evidence", periodRevisions: { "day:2026-10-28": 0, "month:2026-10": 0 }, costRevisions: { slot: 0 }, at: due };
  type State = { cost: { reservedMilliKrw: bigint | null; confirmedMilliKrw: bigint | null; adjustmentMilliKrw: bigint | null; costState: string; costSummaryPurgedAt: Date | null }; periods: { id: string; confirmedMilliKrw: bigint; archivedConfirmedMilliKrw: bigint; revision: number }[]; audit: boolean };
  const initial: State = { cost: { reservedMilliKrw: 0n, confirmedMilliKrw: 14300n, adjustmentMilliKrw: -700n, costState: "settled", costSummaryPurgedAt: null }, periods: [{ id: "day", confirmedMilliKrw: 14300n, archivedConfirmedMilliKrw: 0n, revision: 0 }, { id: "month", confirmedMilliKrw: 14300n, archivedConfirmedMilliKrw: 0n, revision: 0 }], audit: false };
  function adapter(failAt?: number) {
    let state = structuredClone(initial); let writes = 0;
    const client: PrismaGuardClient = { async $transaction(work) {
      const candidate = structuredClone(state);
      const tx: PrismaGuardTransaction = {
        async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
          const sql = strings.join("?"); let result: unknown[];
          if (sql.includes('FROM "NotificationRuntimeConfig"')) result = [{ ownerId: "owner", purgeExecutorId: "actor", policyVersion: "v1", revision: 1 }];
          else if (sql.includes('FROM "NotificationDispatch"') && sql.includes('"environment" =')) result = [{ outboxId: "outbox", recipientId: "recipient" }];
          else if (sql.includes('FROM "NotificationOutbox"')) result = [{ id: "outbox" }];
          else if (sql.includes('SELECT "userId" FROM "NotificationRecipientRegistration"')) result = [{ userId: "recipient_user" }];
          else if (sql.includes('FROM "User"')) result = ["owner", "actor"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false }));
          else if (sql.includes('FROM "NotificationRecipientRegistration"')) result = [{ id: "recipient" }];
          else if (sql.includes('FROM "NotificationDispatch"')) result = [{ id: "dispatch", outboxId: "outbox", recipientId: "recipient", slotCount: 1, auditSequence: 0, completedAt: new Date("2026-10-28T00:00:00Z"), purgeDueAt: due }];
          else if (sql.includes("cost_summary_purge_approved")) result = [{ actorId: "owner", dispatchId: "dispatch", commandId: "purgecost", evidenceId: "evidence", payloadBinding: summaryPurgeBinding(command) }];
          else if (sql.includes('FROM "NotificationAudit"')) result = candidate.audit ? [{ eventType: "cost_summary_purged", dispatchId: "dispatch", actorId: "actor", approvalId: "approval", evidenceId: "evidence", payloadBinding: summaryPurgeBinding(command) }] : [];
          else if (sql.includes('FROM "NotificationCostReservation"')) result = [{ id: "slot", entryKind: "SEND_SLOT", dayKey: "2026-10-28", monthKey: "2026-10", revision: 0, ...candidate.cost }];
          else if (sql.includes('FROM "NotificationBudgetPeriod"')) result = [candidate.periods.find((p) => p.id === values[0])!];
          else throw new Error("Unexpected query");
          return result as T;
        },
        async $executeRaw(strings, ...values) {
          writes++; if (writes === failAt) throw new Error("injected write failure");
          const sql = strings.join("?");
          if (sql.includes('UPDATE "NotificationBudgetPeriod"')) { const period = candidate.periods.find((p) => p.id === values[1])!; period.archivedConfirmedMilliKrw += values[0] as bigint; period.revision++; }
          else if (sql.includes('UPDATE "NotificationCostReservation"')) Object.assign(candidate.cost, { reservedMilliKrw: null, confirmedMilliKrw: null, adjustmentMilliKrw: null, costState: "summary_purged", costSummaryPurgedAt: due });
          else if (sql.includes('INSERT INTO "NotificationAudit"')) candidate.audit = true;
          return 1;
        },
      };
      const result = await work(tx); state = candidate; return result;
    } };
    return { client, snapshot: () => structuredClone(state) };
  }
  const normal = adapter(); const repo = new PrismaDispatchRepository(normal.client);
  await purgePrismaCostSummary(repo, command); await purgePrismaCostSummary(repo, command);
  expect(normal.snapshot().cost).toEqual({ reservedMilliKrw: null, confirmedMilliKrw: null, adjustmentMilliKrw: null, costState: "summary_purged", costSummaryPurgedAt: due });
  expect(normal.snapshot().periods.map((period) => [period.confirmedMilliKrw, period.archivedConfirmedMilliKrw, period.revision])).toEqual([[14300n, 14300n, 1], [14300n, 14300n, 1]]);
  const failing = adapter(3); await expect(purgePrismaCostSummary(new PrismaDispatchRepository(failing.client), command)).rejects.toThrow("injected write failure");
  expect(failing.snapshot()).toEqual(initial);
});

it("applies a verified Prisma correction without writing the purged source", async () => {
  const command = { commandId: "correction", slotId: "slot", actorId: "actor", approvalId: "approval", evidenceId: "evidence", day: "2026-10-28", month: "2026-10", delta: -14300, version: "v1", costRevision: 1, periodRevisions: { "day:2026-10-28": 1, "month:2026-10": 1 }, at: new Date("2027-10-28T00:00:00Z") };
  const responses: unknown[][] = [
    [{ ownerId: "owner", costExecutorId: "actor", policyVersion: "v1", revision: 1 }],
    [{ dispatchId: "dispatch", outboxId: "outbox", recipientId: "recipient" }], [{ id: "outbox" }], [{ userId: "recipient_user" }],
    ["owner", "actor"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false })), [{ id: "recipient" }],
    [{ id: "dispatch", outboxId: "outbox", recipientId: "recipient", auditSequence: 0 }],
    [{ id: "slot", dayKey: "2026-10-28", monthKey: "2026-10", costState: "summary_purged", costSummaryPurgedAt: command.at, reservedMilliKrw: null, confirmedMilliKrw: null, adjustmentMilliKrw: null, revision: 1 }],
    [{ id: "proposal", sourceSlotId: "slot", sourceCostId: "slot", adjustmentMilliKrw: -14300n, adjustmentCommandId: "correction", adjustmentApprovalId: "approval", adjustmentEvidenceId: "evidence", correctionVersion: "v1", evidenceVerifiedAt: command.at, expectedCostRevision: 1, status: "proposed", costState: "proposed" }],
    [{ actorId: "owner", slotId: "slot", costOperationId: "proposal", commandId: "correction", evidenceId: "evidence", payloadBinding: correctionBinding(command) }], [],
    [{ id: "day", confirmedMilliKrw: 14300n, archivedConfirmedMilliKrw: 14300n, revision: 1 }],
    [{ id: "month", confirmedMilliKrw: 14300n, archivedConfirmedMilliKrw: 14300n, revision: 1 }],
  ];
  const writes: { sql: string; values: unknown[] }[] = [];
  const tx: PrismaGuardTransaction = {
    async $queryRaw<T>(): Promise<T> { const next = responses.shift(); if (!next) throw new Error("Unexpected query"); return next as T; },
    async $executeRaw(strings, ...values) { writes.push({ sql: strings.join("?"), values }); return 1; },
  };
  const client: PrismaGuardClient = { async $transaction(work) { return work(tx); } };
  await correctPurgedPrismaCost(new PrismaDispatchRepository(client), command);
  expect(writes.filter((w) => w.sql.includes('UPDATE "NotificationBudgetPeriod"'))).toHaveLength(2);
  expect(writes.filter((w) => w.sql.includes('UPDATE "NotificationBudgetPeriod"')).every((w) => w.values[0] === -14300n && w.values[1] === -14300n)).toBe(true);
  const costWrites = writes.filter((w) => w.sql.includes('UPDATE "NotificationCostReservation"'));
  expect(costWrites).toHaveLength(1); expect(costWrites[0].values).toContain("proposal"); expect(costWrites[0].values).not.toContain("slot");
  const audit = writes.find((w) => w.sql.includes('INSERT INTO "NotificationAudit"'))!;
  expect(audit.values).not.toContain(-14300n); expect(audit.values).toContain("proposal");
});

it("reserves the synthetic lookup and plan in the persistent period without issuing a slot", async () => {
  const command = { commandId: "lookup1", slotId: "slot", actorId: "actor", approvalId: "approval", now: new Date("2026-10-28T00:00:00Z"), quote };
  const binding = syntheticLookupBinding({ ...command, day: "2026-10-28", month: "2026-10" });
  const responses: unknown[][] = [
    [{ ownerId: "owner", costExecutorId: "actor", policyVersion: "v1", revision: 0, blocked: false, recoveryVerified: true, nonceCurrent: true, rotationComplete: true }],
    [{ dispatchId: "dispatch", outboxId: "outbox", recipientId: "recipient" }], [{ id: "outbox" }], [{ userId: "recipient_user" }],
    ["owner", "actor", "recipient_user"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false })), [{ id: "recipient" }],
    [{ id: "dispatch", outboxId: "outbox", recipientId: "recipient", auditSequence: 0 }], [{ id: "slot", status: "unknown", detailPurgedAt: null }],
    [{ actorId: "owner", slotId: "slot", commandId: "lookup1", payloadBinding: binding }], [],
    [{ id: "month", revision: 0, planApplied: false, otherMilliKrw: 0n, reservedMilliKrw: 15000n, confirmedMilliKrw: 0n, lookupReservedMilliKrw: 0n, lookupConfirmedMilliKrw: 0n }], [{ message: 0n, lookup: 0n }],
  ];
  const writes: { sql: string; values: unknown[] }[] = [];
  const tx: PrismaGuardTransaction = {
    async $queryRaw<T>(): Promise<T> { const next = responses.shift(); if (!next) throw new Error("Unexpected query"); return next as T; },
    async $executeRaw(strings, ...values) { writes.push({ sql: strings.join("?"), values }); return 1; },
  };
  const client: PrismaGuardClient = { async $transaction(work) { return work(tx); } };
  expect(await reserveSyntheticLookup(new PrismaDispatchRepository(client), command)).toMatchObject({ id: expect.any(String) });
  const inserted = writes.find((write) => write.sql.includes('INSERT INTO "NotificationCostReservation"'))!;
  expect(inserted.sql).toContain("'LOOKUP_COST'"); expect(inserted.values).toContain(500n);
  const updated = writes.find((write) => write.sql.includes('UPDATE "NotificationBudgetPeriod"'))!;
  expect(updated.values).toContain(500n); expect(updated.values).toContain(1000000n);
  expect(15000n + 500n + 1000000n).toBe(1015500n);
  expect(writes.some((write) => write.sql.includes('"slotCount" ='))).toBe(false);
});
