import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { acquireDispatchPermit, markDispatchUnknown } from "@/server/kakao/dispatch-guard";
import { reconcileCost, correctPurgedSyntheticCost, reserveSyntheticLookup, markSyntheticLookupUnknown, reconcileSyntheticLookup } from "@/server/kakao/budget";
import { InMemoryDispatchRepository, completeSyntheticDispatch, completionPurgeDeadline, purgeSyntheticDetails, purgeSyntheticCostSummary, closeSyntheticUnconfirmed, type CoreState } from "@/server/kakao/dispatch-repository";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { activateStoredSyntheticRecipient, decryptStoredSyntheticRecipient, registerStoredSyntheticRecipient, revokeStoredSyntheticRecipient, verifyStoredSyntheticRecipient } from "@/server/kakao/recipient-storage";
const at = new Date("2026-10-28T00:00:00Z");
const context = { event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`, recipientId: "r1", recipientVersion: "v1", submittedAt: at, templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } } as const;
const target = { id: "u1", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
const recipientKey = randomBytes(32);
const encrypted = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), recipientKey, 1n, { environment: "preview", registrationId: "r1", registrationVersion: "v1", keyVersion: "k1" }, { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true });
const registration = { environment: "preview", service: "application.received", id: "r1", version: "v1", userId: "u1", purposeVersion: "p1", policyVersion: "p1", state: "active", ciphertext: { ...encrypted, keyVersion: "k1", synthetic: true }, evidence: { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: "r1", version: "v1", verifiedAt: at, verifierId: "u1" } };
const initial: CoreState = { users: [target], ownershipEvidence: [registration.evidence], nonceHighWaters: { k1: 1n }, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], recipients: [{ id: "r1", version: "v1", userId: "u1", registration, target }], runtime: { environment: "preview", provider: "solapi", namespace: "preview_g2", blocked: false, activationEpoch: at, revision: 1, keyVersion: "k1", nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true }, outboxes: [{ id: "outbox1", dedupeKey: context.dedupeKey, occurredAt: at, status: "processing", claimToken: "claim1", leaseExpiresAt: new Date(at.getTime() + 300000) }], dispatches: [{ id: "dispatch1", outboxId: "outbox1", clientKey: `preview_g2:${context.dedupeKey}`, context, slotCount: 0, auditSequence: 0, state: "ready", unknownSince: null }], slots: [], audits: [], monthlyAdditionalCosts: {} };
const input = { recipientKey: { key: recipientKey, keyVersion: "k1", synthetic: true as const }, dispatchId: "dispatch1", claimToken: "claim1", context, now: at, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const };
describe("synthetic in-memory issuance", () => {
  it("does not retarget an existing dispatch when a replacement is activated", async () => {
    const replacementEvidence = { ...registration.evidence, registrationId: "r2", version: "v2" };
    const db = new InMemoryDispatchRepository({ ...initial, ownershipEvidence: [registration.evidence, replacementEvidence], nonceHighWaters: { k1: 1n }, runtime: { ...initial.runtime!, ownerId: target.id, nonceHighWater: 1n } });
    await revokeStoredSyntheticRecipient(db, { registrationId: "r1", actorId: "u1", reason: "replaced", at });
    await registerStoredSyntheticRecipient(db, { registrationId: "r2", version: "v2", userId: "u1", actorId: "u1", purposeVersion: "p1", policyVersion: "p1", key: input.recipientKey, at });
    await verifyStoredSyntheticRecipient(db, { registrationId: "r2", actorId: "u1", evidence: replacementEvidence, at });
    await activateStoredSyntheticRecipient(db, { registrationId: "r2", actorId: "u1", key: input.recipientKey, at });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
    const state = await db.snapshot(); expect(state.dispatches[0].context).toEqual(context); expect(state.slots).toHaveLength(0);
  });
  it("decrypts only for a current issued slot and refuses after withdrawal", async () => {
    const db = new InMemoryDispatchRepository({ ...initial, runtime: { ...initial.runtime!, ownerId: target.id, nonceHighWater: 1n } });
    const permit = await acquireDispatchPermit(db, input); expect(permit).not.toBeNull();
    const plaintext = await decryptStoredSyntheticRecipient(db, { permit, key: input.recipientKey, now: at });
    try { expect(plaintext.equals(Buffer.from("synthetic-recipient"))).toBe(true); } finally { plaintext.fill(0); }
    await revokeStoredSyntheticRecipient(db, { registrationId: "r1", actorId: "u1", reason: "withdrawn", at });
    await expect(decryptStoredSyntheticRecipient(db, { permit, key: input.recipientKey, now: at })).rejects.toThrow();
  });
  it("serializes revocation with permit issuance and blocks every later permit", async () => {
    const db = new InMemoryDispatchRepository({ ...initial, runtime: { ...initial.runtime!, ownerId: target.id, nonceHighWater: 1n } });
    const [permit, revoked] = await Promise.allSettled([acquireDispatchPermit(db, input), revokeStoredSyntheticRecipient(db, { registrationId: "r1", actorId: "u1", reason: "withdrawn", at })]);
    expect(revoked.status).toBe("fulfilled");
    expect(permit.status).toBe("fulfilled");
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "revoked", ciphertext: null });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
  });
  it.each([
    { role: "MANAGER" as const, isActive: true, mustChangePassword: false },
    { role: "ADMIN" as const, isActive: false, mustChangePassword: false },
    { role: "ADMIN" as const, isActive: true, mustChangePassword: true },
  ])("rejects a stale eligible recipient snapshot after the current user changes", async (change) => {
    const db = new InMemoryDispatchRepository({ ...initial, users: [{ ...target, ...change }] });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
    expect((await db.snapshot()).slots).toHaveLength(0);
  });
  it("fails closed when the recipient key is missing or incorrect", async () => {
    for (const recipientKey of [undefined, { key: randomBytes(32), keyVersion: "k1", synthetic: true as const }]) {
      const db = new InMemoryDispatchRepository(initial);
      expect(await acquireDispatchPermit(db, { ...input, recipientKey })).toBeNull();
      expect((await db.snapshot()).slots).toHaveLength(0);
    }
  });
  it("rejects an active recipient whose stored ownership observation is missing", async () => {
    const db = new InMemoryDispatchRepository({ ...initial, ownershipEvidence: [] });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
    expect((await db.snapshot()).slots).toHaveLength(0);
  });
  it("rejects an untrusted nonce high-water at permit and plaintext access", async () => {
    const stale = new InMemoryDispatchRepository({ ...initial, runtime: { ...initial.runtime!, nonceHighWater: 0n } });
    expect(await acquireDispatchPermit(stale, input)).toBeNull();
    const db = new InMemoryDispatchRepository(initial); const permit = await acquireDispatchPermit(db, input); expect(permit).not.toBeNull();
    await db.transaction(async (state) => { state.runtime!.nonceHighWater = 0n; });
    await expect(decryptStoredSyntheticRecipient(db, { permit, key: input.recipientKey, now: at })).rejects.toThrow();
  });
  it("does not expose a mutable transaction result as repository state", async () => {
    const db = new InMemoryDispatchRepository(initial);
    const row = await db.transaction(async (state) => state.outboxes[0]);
    row.status = "sent";
    expect((await db.snapshot()).outboxes[0].status).toBe("processing");
  });
  it("rolls back when a transaction result cannot be detached", async () => {
    const db = new InMemoryDispatchRepository(initial);
    await expect(db.transaction(async (state) => { state.outboxes[0].status = "sent"; return () => undefined; })).rejects.toThrow();
    expect(await db.snapshot()).toEqual(initial);
  });
  it("refuses to revalidate a correction after its numeric detail was purged", async () => {
    const command = { commandId: "correction1", slotId: "slot1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", day: "2026-10-28", month: "2026-10", delta: -700, version: "v1", costRevision: 1, periodRevisions: { "day:2026-10-28": 1, "month:2026-10": 1 }, at };
    const { at: appliedAt, ...stored } = command;
    const db = new InMemoryDispatchRepository({ ...initial, corrections: [{ ...stored, delta: null, appliedAt, completedAt: appliedAt, purgeDueAt: completionPurgeDeadline(appliedAt), contribution: "folded_archive", costSummaryPurgedAt: at }] });
    await expect(correctPurgedSyntheticCost(db, command)).rejects.toThrow("Applied correction detail purged.");
  });
  it("purges applied correction detail without applying its delta again", async () => {
    const due = new Date("2027-10-28T00:00:00Z");
    const original = { evidenceId: "evidence1", slotId: "slot1", day: "2026-10-28", month: "2026-10", delta: -14300, version: "v1" };
    const correction = { ...original, commandId: "correction1", actorId: "actor1", approvalId: "approval1", costRevision: 1, periodRevisions: { "day:2026-10-28": 1, "month:2026-10": 1 } };
    const purge = { commandId: "purge_correction", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval2", evidenceId: "evidence2", periodRevisions: {}, costRevisions: { slot1: 1, correction1: 0 } };
    const periods = [{ type: "day" as const, key: "2026-10-28", confirmed: 0, archivedConfirmed: 0, revision: 2 }, { type: "month" as const, key: "2026-10", confirmed: 0, archivedConfirmed: 0, revision: 2 }];
    const seeded: CoreState = { ...initial, summaryPurgeApprovals: [purge], correctionEvidence: [original], correctionApprovals: [correction], corrections: [{ ...correction, appliedAt: at, completedAt: at, purgeDueAt: due, contribution: "folded_archive", revision: 0 }], budgetPeriods: periods, dispatches: [{ ...initial.dispatches[0], slotCount: 1, completedAt: at, purgeDueAt: due }], slots: [{ id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "rejected", reserved: null, confirmed: null, adjustment: null, costState: "summary_purged", costSummaryPurgedAt: at, revision: 1, issuedAt: at }] };
    const db = new InMemoryDispatchRepository(seeded);
    await purgeSyntheticCostSummary(db, { ...purge, at: due });
    const state = await db.snapshot();
    expect(state.budgetPeriods).toEqual(periods);
    expect(state.corrections?.[0].delta).toBeNull();
    expect(state.correctionEvidence?.some((e) => e.delta === -14300)).toBe(false);
    expect(state.correctionApprovals?.some((e) => e.delta === -14300)).toBe(false);
  });
  it("archives a settled lookup in its own month as part of the approved inventory", async () => {
    const due = new Date("2027-10-28T00:00:00Z");
    const approval = { commandId: "purge_lookup", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", periodRevisions: { "day:2026-10-28": 0, "month:2026-10": 0, "month:2026-11": 0 }, costRevisions: { slot1: 0, lookup1: 0 } };
    const seeded: CoreState = { ...initial, summaryPurgeApprovals: [approval], budgetPeriods: [{ type: "day", key: "2026-10-28", confirmed: 14300, archivedConfirmed: 0, revision: 0 }, { type: "month", key: "2026-10", confirmed: 14300, archivedConfirmed: 0, revision: 0 }, { type: "month", key: "2026-11", confirmed: 0, archivedConfirmed: 0, lookupConfirmed: 500, lookupArchivedConfirmed: 0, revision: 0 }], dispatches: [{ ...initial.dispatches[0], slotCount: 1, completedAt: at, purgeDueAt: due }], slots: [{ id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "rejected", reserved: 0, confirmed: 14300, costState: "settled", revision: 0, issuedAt: at }], lookups: [{ id: "lookup1", slotId: "slot1", month: "2026-11", status: "resolved", reserved: 0, confirmed: 500, revision: 0, contribution: "live_summary" }] };
    const db = new InMemoryDispatchRepository(seeded);
    await purgeSyntheticCostSummary(db, { ...approval, at: due });
    const result = await db.snapshot();
    expect(result.lookups[0]).toMatchObject({ reserved: null, confirmed: null, slotId: "slot1" });
    expect(result.budgetPeriods?.find((p) => p.key === "2026-11")).toMatchObject({ lookupConfirmed: 500, lookupArchivedConfirmed: 500 });
  });
  it("commits outbox claims and audit in the injected dispatch repository", async () => {
    const db = new InMemoryDispatchRepository({ ...initial, outboxes: [], dispatches: [] });
    const store = Reflect.construct(InMemoryOutboxStore, [db]) as InMemoryOutboxStore;
    await store.enqueue({ eventKind: "application.received", entityId: `c${"a".repeat(24)}`, dedupeKey: context.dedupeKey, audience: "admin", occurredAt: at });
    const claimed = await store.claimDue(1, at);
    const state = await db.snapshot();
    expect(claimed).toHaveLength(1);
    expect(state.outboxes).toHaveLength(1);
    expect(state.outboxes[0].status).toBe("processing");
    expect(state.audits).toHaveLength(1);
  });
  it("applies a bound signed correction once without recreating the purged slot", async () => {
    const evidence = { evidenceId: "evidence1", slotId: "slot1", day: "2026-10-28", month: "2026-10", delta: -14300, version: "v1" };
    const approval = { ...evidence, commandId: "correction1", actorId: "actor1", approvalId: "approval1", costRevision: 1, periodRevisions: { "day:2026-10-28": 1, "month:2026-10": 1 } };
    const sameEvidence = { ...approval, commandId: "correction2", approvalId: "approval2" };
    const seeded: CoreState = { ...initial, correctionEvidence: [evidence], correctionApprovals: [approval, sameEvidence], budgetPeriods: [{ type: "day", key: "2026-10-28", confirmed: 14300, archivedConfirmed: 14300, revision: 1 }, { type: "month", key: "2026-10", confirmed: 14300, archivedConfirmed: 14300, revision: 1 }], dispatches: [{ ...initial.dispatches[0], slotCount: 1 }], slots: [{ id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "rejected", reserved: null, confirmed: null, adjustment: null, costState: "summary_purged", costSummaryPurgedAt: at, revision: 1, issuedAt: at }] };
    const db = new InMemoryDispatchRepository(seeded);
    await expect(correctPurgedSyntheticCost(db, { ...approval, delta: 0, at })).rejects.toThrow();
    await correctPurgedSyntheticCost(db, { ...approval, at }); await correctPurgedSyntheticCost(db, { ...approval, at });
    await expect(correctPurgedSyntheticCost(db, { ...sameEvidence, at })).rejects.toThrow();
    const state = await db.snapshot();
    expect(state.budgetPeriods?.map((p) => [p.confirmed, p.archivedConfirmed, p.revision])).toEqual([[0, 0, 2], [0, 0, 2]]);
    expect(state.slots[0]).toEqual(seeded.slots[0]); expect(state.dispatches[0].slotCount).toBe(1); expect(state.corrections).toHaveLength(1);
    expect(state.corrections?.[0]).toMatchObject({ completedAt: at, purgeDueAt: completionPurgeDeadline(at), contribution: "folded_archive", revision: 0 });
  });
  it("archives completed costs once while removing all slot cost numbers", async () => {
    const revisions = { "day:2026-10-28": 0, "month:2026-10": 0 };
    const approval = { commandId: "purgecost", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", periodRevisions: revisions, costRevisions: { slot1: 0 } };
    const due = new Date("2027-10-28T00:00:00Z");
    const seeded: CoreState = { ...initial, summaryPurgeApprovals: [approval], budgetPeriods: [{ type: "day", key: "2026-10-28", confirmed: 14300, archivedConfirmed: 0, revision: 0 }, { type: "month", key: "2026-10", confirmed: 14300, archivedConfirmed: 0, revision: 0 }], dispatches: [{ ...initial.dispatches[0], slotCount: 1, completedAt: at, purgeDueAt: due }], slots: [{ id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "rejected", reserved: 0, confirmed: 14300, adjustment: -700, costState: "settled", revision: 0, issuedAt: at }] };
    const command = { ...approval, at: due }; const db = new InMemoryDispatchRepository(seeded);
    await purgeSyntheticCostSummary(db, command); await purgeSyntheticCostSummary(db, command);
    const result = await db.snapshot();
    expect(result.slots[0]).toMatchObject({ id: "slot1", sequence: 1, status: "rejected", reserved: null, confirmed: null, adjustment: null, costState: "summary_purged", costSummaryPurgedAt: due });
    expect(result.budgetPeriods).toEqual(seeded.budgetPeriods!.map((period) => ({ ...period, archivedConfirmed: 14300, revision: 1 })));
    expect(result.dispatches[0].slotCount).toBe(1);
    expect(result.audits.filter((audit) => audit.eventType === "cost_summary_purged")).toHaveLength(1);
    const failing = new InMemoryDispatchRepository(seeded, () => { throw new Error("injected commit failure"); });
    await expect(purgeSyntheticCostSummary(failing, command)).rejects.toThrow();
    expect(await failing.snapshot()).toEqual(seeded);
  });

  it("archives the reconciliation result and rejects a stale absolute target after purge", async () => {
    const before = { "day:2026-10-28": 0, "month:2026-10": 0 }; const after = { "day:2026-10-28": 1, "month:2026-10": 1 };
    const cost = { commandId: "adjust", slotId: "slot1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", confirmed: 14300, periodRevisions: before, costRevision: 0 };
    const purge = { commandId: "purgecost", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval2", evidenceId: "evidence2", periodRevisions: after, costRevisions: { slot1: 1 } };
    const late = { commandId: "late", slotId: "slot1", actorId: "actor1", approvalId: "approval3", evidenceId: "evidence3", confirmed: 0, periodRevisions: after };
    const due = new Date("2027-10-28T00:00:00Z");
    const seeded: CoreState = { ...initial, costApprovals: [cost, late], summaryPurgeApprovals: [purge], budgetPeriods: [{ type: "day", key: "2026-10-28", confirmed: 0, archivedConfirmed: 0, revision: 0 }, { type: "month", key: "2026-10", confirmed: 0, archivedConfirmed: 0, revision: 0 }], outboxes: [{ ...initial.outboxes[0], status: "sent" }], dispatches: [{ ...initial.dispatches[0], slotCount: 1, finalStatus: "delivered", completionEvidenceId: "completion" }], slots: [{ id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "rejected", reserved: 15000, confirmed: 0, revision: 0, issuedAt: at }] };
    const db = new InMemoryDispatchRepository(seeded);
    await reconcileCost(db, { ...cost, nonBillableEvidence: true, at });
    await completeSyntheticDispatch(db, "dispatch1", at);
    await purgeSyntheticCostSummary(db, { ...purge, at: due });
    const beforeLate = await db.snapshot();
    await expect(reconcileCost(db, { ...late, nonBillableEvidence: true, at: due })).rejects.toThrow();
    expect(await db.snapshot()).toEqual(beforeLate);
    expect(beforeLate.budgetPeriods?.map((period) => [period.confirmed, period.archivedConfirmed])).toEqual([[14300, 14300], [14300, 14300]]);
    expect(beforeLate.slots[0]).toMatchObject({ reserved: null, confirmed: null, costState: "summary_purged" });
  });
  it("issues one permit under concurrent calls and stores slot, reservation and audit together", async () => {
    const network = vi.spyOn(globalThis, "fetch"); const db = new InMemoryDispatchRepository(initial);
    const results = await Promise.all([acquireDispatchPermit(db, input), acquireDispatchPermit(db, input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await db.snapshot(); expect(state.slots).toHaveLength(1); expect(state.slots[0].reserved).toBe(15000); expect(state.audits).toHaveLength(1);
    expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it("never commits or returns a permit if commit fails", async () => {
    const db = new InMemoryDispatchRepository(initial, () => { throw new Error("injected commit failure"); });
    await expect(acquireDispatchPermit(db, input)).rejects.toThrow();
    expect(await db.snapshot()).toEqual(initial);
  });
  it("rejects stale claims and fixed context changes", async () => {
    const db = new InMemoryDispatchRepository(initial);
    expect(await acquireDispatchPermit(db, { ...input, claimToken: "other" })).toBeNull();
    expect(await acquireDispatchPermit(db, { ...input, context: { ...context, recipientVersion: "v2" } })).toBeNull();
    expect((await db.snapshot()).slots).toHaveLength(0);
  });
  it("preserves the first unknown observation and blocks another request", async () => {
    const db = new InMemoryDispatchRepository(initial); const permit = await acquireDispatchPermit(db, input);
    if (!permit) throw new Error("Expected permit");
    await markDispatchUnknown(db, { dispatchId: permit.dispatchId, slotId: permit.slotId, at });
    await markDispatchUnknown(db, { dispatchId: permit.dispatchId, slotId: permit.slotId, at: new Date(at.getTime() + 1000) });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
    const state = await db.snapshot(); expect(state.dispatches[0].unknownSince).toEqual(at); expect(state.slots[0].reserved).toBe(15000); expect(state.slots).toHaveLength(1);
  });
  it("awards the final day and month slot to at most one dispatch", async () => {
    const second = { ...context, dedupeKey: `application.received:${"b".repeat(64)}` };
    const prior = Array.from({ length: 199 }, (_, i) => ({ id: `old_${i}`, dispatchId: `old_dispatch_${i}`, sequence: 1, month: "2026-10", day: i < 19 ? "2026-10-28" : "2026-10-27", status: "rejected" as const, reserved: 15000, confirmed: 0, issuedAt: at }));
    const seeded: CoreState = { ...initial, slots: prior, monthlyAdditionalCosts: { "2026-10": 2000000 }, outboxes: [...initial.outboxes, { ...initial.outboxes[0], id: "outbox2", dedupeKey: second.dedupeKey, claimToken: "claim2" }], dispatches: [...initial.dispatches, { ...initial.dispatches[0], id: "dispatch2", outboxId: "outbox2", clientKey: `preview_g2:${second.dedupeKey}`, context: second }] };
    const db = new InMemoryDispatchRepository(seeded);
    const permits = await Promise.all([acquireDispatchPermit(db, input), acquireDispatchPermit(db, { ...input, dispatchId: "dispatch2", claimToken: "claim2", context: second })]);
    expect(permits.filter(Boolean)).toHaveLength(1); expect((await db.snapshot()).slots).toHaveLength(200);
    const provider = new MockProvider({ code: "S_UNKNOWN" }); const send = vi.spyOn(provider, "send");
    await Promise.all(permits.filter((permit) => permit !== null).map((permit) => provider.send(permit)));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a prior month unknown reservation across restart", async () => {
    const now = new Date("2026-10-31T15:00:00.000Z");
    const novemberContext = { ...context, submittedAt: now, variables: { 접수시각: "2026-11-01 00:00" } };
    const seeded: CoreState = { ...initial, outboxes: [{ ...initial.outboxes[0], occurredAt: now, leaseExpiresAt: new Date(now.getTime() + 300000) }], dispatches: [{ ...initial.dispatches[0], context: novemberContext }], slots: [{ id: "unknown_old", dispatchId: "unknown_dispatch", sequence: 1, month: "2026-10", day: "2026-10-31", status: "unknown", reserved: 15000, confirmed: 0, issuedAt: at }], monthlyAdditionalCosts: {} };
    const first = new InMemoryDispatchRepository(seeded); const restarted = new InMemoryDispatchRepository(await first.snapshot());
    expect(await acquireDispatchPermit(restarted, { ...input, context: novemberContext, now })).not.toBeNull();
    const state = await restarted.snapshot(); expect(state.slots).toHaveLength(2); expect(state.slots.find((s) => s.id === "unknown_old")?.reserved).toBe(15000);
  });

  it("requires cost approval and never restores a slot after zero-cost reconciliation", async () => {
    const db = new InMemoryDispatchRepository(initial); const permit = await acquireDispatchPermit(db, input);
    if (!permit) throw new Error("Expected permit");
    const command = { commandId: "cmd1", slotId: permit.slotId, actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", confirmed: 0, nonBillableEvidence: true, at };
    await expect(reconcileCost(db, command)).rejects.toThrow();
    const snapshot = await db.snapshot(); snapshot.costApprovals.push({ commandId: "cmd1", slotId: permit.slotId, actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", confirmed: 0 });
    const approved = new InMemoryDispatchRepository(snapshot);
    await reconcileCost(approved, command); await reconcileCost(approved, command);
    const state = await approved.snapshot(); expect(state.slots).toHaveLength(1); expect(state.slots[0].reserved).toBe(0); expect(state.dispatches[0].slotCount).toBe(1);
    expect(state.audits.filter((a) => a.eventType === "cost_reconciled")).toHaveLength(1);
    expect(await acquireDispatchPermit(approved, input)).toBeNull();
  });

  it("fails closed when recovery or key freshness is unknown", async () => {
    const db = new InMemoryDispatchRepository({ ...initial, runtime: { ...initial.runtime!, recoveryVerified: false } });
    expect(await acquireDispatchPermit(db, input)).toBeNull();
    expect((await db.snapshot()).slots).toHaveLength(0);
  });

  it("does not treat provider acceptance or reserved cost as completion", async () => {
    const seeded: CoreState = { ...initial, outboxes: [{ ...initial.outboxes[0], status: "sent" }], dispatches: [{ ...initial.dispatches[0], state: "accepted" }] };
    const db = new InMemoryDispatchRepository(seeded);
    await expect(completeSyntheticDispatch(db, "dispatch1", at)).rejects.toThrow();
    expect((await db.snapshot()).dispatches[0].completedAt).toBeUndefined();
  });
  it("completes after an earlier sealed lookup purge without restoring its numbers", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "accepted" as const, reserved: 0, confirmed: 14300, issuedAt: at };
    const seeded: CoreState = { ...initial, budgetPeriods: [{ type: "month", key: "2026-10", confirmed: 14300, archivedConfirmed: 0, lookupConfirmed: 500, lookupArchivedConfirmed: 500, revision: 1 }], outboxes: [{ ...initial.outboxes[0], status: "sent" }], dispatches: [{ ...initial.dispatches[0], state: "accepted", slotCount: 1, finalStatus: "delivered", completionEvidenceId: "completion" }], slots: [slot], lookups: [{ id: "lookup1", slotId: slot.id, month: "2026-10", status: "resolved", reserved: null, confirmed: null, costSummaryPurgedAt: at, contribution: "folded_archive" }] };
    const db = new InMemoryDispatchRepository(seeded);
    await completeSyntheticDispatch(db, "dispatch1", at);
    const result = await db.snapshot();
    expect(result.lookups[0]).toMatchObject({ reserved: null, confirmed: null, completedAt: at, purgeDueAt: completionPurgeDeadline(at) });
    expect(result.dispatches[0].completedAt).toEqual(at);
    const missingPeriod = new InMemoryDispatchRepository({ ...seeded, budgetPeriods: [] });
    await expect(completeSyntheticDispatch(missingPeriod, "dispatch1", at)).rejects.toThrow("Cost remains unresolved.");
  });
  it("clamps UTC leap-day deadline and fixes completion exactly once", async () => {
    const completion = new Date("2024-02-29T12:34:56.789Z");
    expect(completionPurgeDeadline(completion).toISOString()).toBe("2025-02-28T12:34:56.789Z");
    const seeded: CoreState = { ...initial, outboxes: [{ ...initial.outboxes[0], status: "skipped" }], dispatches: [{ ...initial.dispatches[0], finalStatus: "not_sent", completionEvidenceId: "evidence1" }] };
    const db = new InMemoryDispatchRepository(seeded);
    await completeSyntheticDispatch(db, "dispatch1", completion); await completeSyntheticDispatch(db, "dispatch1", new Date("2025-01-01T00:00:00Z"));
    const state = await db.snapshot(); expect(state.dispatches[0].completedAt).toEqual(completion); expect(state.audits.filter((a) => a.eventType === "completed")).toHaveLength(1);
  });

  it("purges details without returning an unknown slot or reserved cost", async () => {
    const db = new InMemoryDispatchRepository(initial); const permit = await acquireDispatchPermit(db, input);
    if (!permit) throw new Error("Expected permit");
    await markDispatchUnknown(db, { dispatchId: permit.dispatchId, slotId: permit.slotId, at });
    const snapshot = await db.snapshot(); snapshot.purgeApprovals.push({ commandId: "purge1", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1" });
    snapshot.slots[0].providerRef = `g2ref_${"a".repeat(32)}`;
    const approved = new InMemoryDispatchRepository(snapshot);
    await expect(purgeSyntheticDetails(approved, { commandId: "purge1", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", at })).rejects.toThrow();
    const state = await approved.snapshot(); expect(state.slots[0]).toMatchObject({ providerRef: `g2ref_${"a".repeat(32)}`, reserved: 15000, status: "unknown" });
    expect(state.slots[0].detailPurgedAt).toBeUndefined();
    expect(state.dispatches[0].slotCount).toBe(1); expect(await acquireDispatchPermit(approved, input)).toBeNull();
  });

  it("requires 30 days and approval for closure without returning the reservation", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const approval = { commandId: "close1", dispatchId: "dispatch1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1" };
    const seeded: CoreState = { ...initial, closureApprovals: [approval], outboxes: [{ ...initial.outboxes[0], status: "failed" }], dispatches: [{ ...initial.dispatches[0], state: "unknown", unknownSince: at, reviewed7dAt: new Date(at.getTime() + 7 * 86400000), responsibilityReviewedAt: new Date(at.getTime() + 30 * 86400000), slotCount: 1 }], slots: [slot] };
    const db = new InMemoryDispatchRepository(seeded); const at30 = new Date(at.getTime() + 30 * 86400000);
    await expect(closeSyntheticUnconfirmed(db, { ...approval, at: new Date(at30.getTime() - 1), nextReviewAt: new Date(at30.getTime() + 86400000) })).rejects.toThrow();
    await closeSyntheticUnconfirmed(db, { ...approval, at: at30, nextReviewAt: new Date(at30.getTime() + 86400000) });
    const state = await db.snapshot(); expect(state.dispatches[0].state).toBe("closed_unconfirmed"); expect(state.slots[0]).toMatchObject({ status: "unknown", reserved: 15000 }); expect(state.outboxes[0].status).toBe("failed");
  });

  it("reserves lookup cost at the total limit, retaining unknown without restoring a send slot", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const seeded: CoreState = { ...initial, dispatches: [{ ...initial.dispatches[0], state: "unknown", unknownSince: at, slotCount: 1 }], slots: [slot], monthlyAdditionalCosts: { "2026-10": 4984500 } };
    const db = new InMemoryDispatchRepository(seeded); const request = { commandId: "lookup1", slotId: "slot1", now: at, quote: input.quote };
    expect(await reserveSyntheticLookup(db, request)).toEqual({ id: "lookup1" });
    expect(await reserveSyntheticLookup(db, request)).toBeNull();
    await markSyntheticLookupUnknown(db, "lookup1", at);
    const state = await db.snapshot(); expect(state.lookups[0]).toMatchObject({ status: "unknown", reserved: 500 }); expect(state.slots[0].reserved).toBe(15000); expect(state.dispatches[0].slotCount).toBe(1);
    expect(await reserveSyntheticLookup(db, { ...request, commandId: "lookup2" })).toBeNull();
  });
  it("blocks missing or unapproved synthetic lookup costs", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const db = new InMemoryDispatchRepository({ ...initial, slots: [slot] });
    for (const quote of [{ ...input.quote, lookup: null }, { ...input.quote, planApproved: false }, { ...input.quote, monthlyPlan: null }]) expect(await reserveSyntheticLookup(db, { commandId: "lookup1", slotId: "slot1", now: at, quote })).toBeNull();
    expect((await db.snapshot()).lookups).toHaveLength(0);
  });

  it("reconciles a lookup once without restoring the send slot", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const db = new InMemoryDispatchRepository({ ...initial, slots: [slot], dispatches: [{ ...initial.dispatches[0], state: "unknown", unknownSince: at, slotCount: 1 }] });
    await reserveSyntheticLookup(db, { commandId: "lookup1", slotId: "slot1", now: at, quote: input.quote }); await markSyntheticLookupUnknown(db, "lookup1", at);
    const state = await db.snapshot(); const approval = { commandId: "adjust1", lookupId: "lookup1", actorId: "actor1", approvalId: "approval1", evidenceId: "evidence1", confirmed: 0 }; state.lookupApprovals.push(approval);
    const approved = new InMemoryDispatchRepository(state); const command = { ...approval, nonBillableEvidence: true, at };
    await reconcileSyntheticLookup(approved, command); await reconcileSyntheticLookup(approved, command);
    const result = await approved.snapshot(); expect(result.lookups[0]).toMatchObject({ status: "resolved", reserved: 0, confirmed: 0 }); expect(result.slots[0].reserved).toBe(15000); expect(result.dispatches[0].slotCount).toBe(1);
  });

  it.each([[4999499, true], [4999500, true], [4999501, false]])("enforces lookup total boundary %i", async (before, allowed) => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const db = new InMemoryDispatchRepository({ ...initial, slots: [slot], monthlyAdditionalCosts: { "2026-10": before - 15000 } });
    expect(Boolean(await reserveSyntheticLookup(db, { commandId: "lookup1", slotId: "slot1", now: at, quote: input.quote }))).toBe(allowed);
  });
  it("does not issue a lookup right when atomic storage fails", async () => {
    const slot = { id: "slot1", dispatchId: "dispatch1", sequence: 1, month: "2026-10", day: "2026-10-28", status: "unknown" as const, reserved: 15000, confirmed: 0, issuedAt: at };
    const seeded: CoreState = { ...initial, slots: [slot] }; const db = new InMemoryDispatchRepository(seeded, () => { throw new Error("injected failure"); });
    await expect(reserveSyntheticLookup(db, { commandId: "lookup1", slotId: "slot1", now: at, quote: input.quote })).rejects.toThrow();
    expect(await db.snapshot()).toEqual(seeded);
  });

});
