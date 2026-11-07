import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { evaluateSendGate, isExplicitSendDisabled, readSendConfig } from "@/lib/kakao/send-config";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";

// Synthetic isolated-restore experiment (G2 R-01, store level only).
// No real database, no real number, no real key, no real personal data.
// The "backup" is a v8-serialized snapshot of the in-memory repository;
// the "restore" is a fresh repository seeded from those bytes.
// Permit/nonce/approval helpers below are experiment-side comparison rules,
// not product code: the product enforcement points are the real send gate
// (send-config) and the real dispatch guard (proven separately in PG).

const at0 = new Date("2026-10-28T00:00:00Z");
const at1 = new Date("2026-10-28T01:00:00Z");

const sendPolicy = {
  mode: "single_synthetic_only" as const,
  activeEnvironment: "preview" as const,
  otherEnvironmentActive: false as const,
  arrangement: "unresolved" as const,
  previewAllocation: null,
  productionAllocation: null,
};

function backupTimeState(): CoreState {
  return {
    outboxes: [],
    dispatches: [
      {
        id: "syn_d1",
        outboxId: "syn_o1",
        clientKey: "syn_client_1",
        context: {
          event: "application.received",
          audience: "admin",
          dedupeKey: `application.received:${"a".repeat(64)}`,
          recipientId: "syn_r1",
          recipientVersion: "syn_v1",
          submittedAt: at0,
          templateId: "mock_application_received_v1",
          templateVersion: "g2-v1",
          variables: { 접수시각: "2026-10-28 09:00" },
        },
        slotCount: 1,
        auditSequence: 1,
        state: "in_flight",
        unknownSince: null,
      },
    ],
    slots: [
      {
        id: "syn_s1",
        dispatchId: "syn_d1",
        sequence: 1,
        month: "2026-10",
        day: "2026-10-28",
        status: "in_flight",
        reserved: 15000,
        confirmed: null,
        issuedAt: at0,
      },
    ],
    lookups: [
      { id: "syn_l1", slotId: "syn_s1", month: "2026-10", status: "in_flight", reserved: 500, confirmed: null },
    ],
    audits: [
      { eventId: "syn_audit_register_r1", eventType: "recipient_registered", registrationId: "syn_r1", occurredAt: at0 },
      { eventId: "syn_audit_register_r2", eventType: "recipient_registered", registrationId: "syn_r2", occurredAt: at0 },
    ],
    recipients: [
      { id: "syn_r1", version: "syn_v1", userId: "syn_u1", registration: { synthetic: true, id: "syn_r1" }, target: { synthetic: true, userId: "syn_u1" } },
      { id: "syn_r2", version: "syn_v1", userId: "syn_u2", registration: { synthetic: true, id: "syn_r2" }, target: { synthetic: true, userId: "syn_u2" } },
    ],
    runtime: {
      environment: "preview",
      provider: "solapi",
      namespace: "syn_restore_ns",
      blocked: false,
      activationEpoch: at0,
      revision: 1,
      keyVersion: "syn_kv_1",
      nonceHighWater: 100n,
      nonceCurrent: true,
      recoveryVerified: false,
      rotationComplete: false,
    },
    lookupApprovals: [],
    closureApprovals: [],
    purgeApprovals: [],
    costApprovals: [],
    recipientPurgeApprovals: [],
    budgetPeriods: [
      { type: "day", key: "2026-10-28", confirmed: 0, archivedConfirmed: 0, revision: 1 },
      { type: "month", key: "2026-10", confirmed: 0, archivedConfirmed: 0, revision: 1 },
    ],
    monthlyAdditionalCosts: {},
    nonceHighWaters: { syn_kv_1: 100n },
  };
}

function emptyState(): CoreState {
  return {
    outboxes: [],
    dispatches: [],
    slots: [],
    audits: [],
    recipients: [],
    runtime: null,
    lookupApprovals: [],
    lookups: [],
    closureApprovals: [],
    purgeApprovals: [],
    costApprovals: [],
    monthlyAdditionalCosts: {},
  };
}

// Backup bundle: the serialized state plus the send configuration that was
// in force at backup time. OFF travels with the backup; it is never inferred.
type BackupBundle = { bytes: Buffer; config: unknown };
async function takeBackup(origin: InMemoryDispatchRepository, config: unknown): Promise<BackupBundle> {
  return { bytes: Buffer.from(serialize(await origin.snapshot())), config };
}
function restoreIntoFresh(bundle: BackupBundle): InMemoryDispatchRepository {
  return new InMemoryDispatchRepository(deserialize(bundle.bytes) as CoreState);
}

type EvidenceComparison = {
  missingRevocations: string[];
  missingPurges: string[];
  slotDiverged: boolean;
  budgetDiverged: boolean;
  nonceBehind: boolean;
  status: "latest_evidence_ok" | "latest_evidence_missing";
};

function compareLatestEvidence(origin: CoreState, restored: CoreState): EvidenceComparison {
  const originRevoked = new Set(origin.audits.filter((a) => a.eventType === "recipient_revoked").map((a) => a.registrationId));
  const restoredRevoked = new Set(restored.audits.filter((a) => a.eventType === "recipient_revoked").map((a) => a.registrationId));
  const originPurged = new Set(origin.audits.filter((a) => a.eventType === "recipient_purged").map((a) => a.registrationId));
  const restoredPurged = new Set(restored.audits.filter((a) => a.eventType === "recipient_purged").map((a) => a.registrationId));
  const missingRevocations = [...originRevoked].filter((id) => id && !restoredRevoked.has(id)) as string[];
  const missingPurges = [...originPurged].filter((id) => id && !restoredPurged.has(id)) as string[];
  const slotOf = (s: CoreState, id: string) => s.slots.find((slot) => slot.id === id);
  const slotDiverged = JSON.stringify(slotOf(origin, "syn_s1")) !== JSON.stringify(slotOf(restored, "syn_s1"));
  const budgetOf = (s: CoreState, key: string) => s.budgetPeriods?.find((p) => p.type === "month" && p.key === key);
  const budgetDiverged = JSON.stringify(budgetOf(origin, "2026-10")) !== JSON.stringify(budgetOf(restored, "2026-10"));
  const originNonce = origin.nonceHighWaters?.["syn_kv_1"] ?? 0n;
  const restoredNonce = restored.nonceHighWaters?.["syn_kv_1"] ?? 0n;
  const nonceBehind = restoredNonce < originNonce;
  const missing = missingRevocations.length > 0 || missingPurges.length > 0 || slotDiverged || budgetDiverged || nonceBehind;
  return { missingRevocations, missingPurges, slotDiverged, budgetDiverged, nonceBehind, status: missing ? "latest_evidence_missing" : "latest_evidence_ok" };
}

// Experiment rule: a diverged restore issues no permit. This mirrors the
// R-01 rule (latest evidence required before any send); the real guard
// (acquireDispatchPermit) and the real send gate are the product enforcers.
function permitAllowedByComparison(comparison: EvidenceComparison): boolean {
  return comparison.status === "latest_evidence_ok";
}

// Experiment rule: the ONLY path from OFF to ON is explicit approval evidence
// AND an explicitly live+enabled config. Approval alone never enables sends,
// and no automatic path exists.
function requestSendEnable(approval: { approvalId: string } | null, config: unknown): boolean {
  if (!approval) return false;
  return !isExplicitSendDisabled(config, sendPolicy);
}

async function setup() {
  const origin = new InMemoryDispatchRepository(backupTimeState());
  const offConfig = { mode: "dry-run" as const, enabled: false, provider: "solapi" as const, environment: "preview" as const };
  const bundle = await takeBackup(origin, offConfig);
  const backupSnapshot = await origin.snapshot();
  // Post-backup origin changes: revoke syn_r2, purge syn_r1, advance the
  // nonce, and settle the slot plus the monthly budget.
  await origin.transaction(async (state) => {
    state.audits.push({ eventId: "syn_audit_revoke_r2", eventType: "recipient_revoked", registrationId: "syn_r2", occurredAt: at1 });
    state.audits.push({ eventId: "syn_audit_purge_r1", eventType: "recipient_purged", registrationId: "syn_r1", occurredAt: at1 });
    state.recipientPurgeApprovals = [{ registrationId: "syn_r1", actorId: "syn_actor", commandId: "syn_cmd_purge_r1", approvalId: "syn_appr_purge_r1", evidenceId: "syn_ev_purge_r1" }];
    state.nonceHighWaters = { syn_kv_1: 101n };
    if (state.runtime) state.runtime.nonceHighWater = 101n;
    state.audits.push({ eventId: "syn_audit_nonce_101", eventType: "nonce_consumed", keyVersion: "syn_kv_1", occurredAt: at1 });
    const slot = state.slots.find((s) => s.id === "syn_s1");
    if (slot) { slot.status = "accepted"; slot.reserved = 0; slot.confirmed = 15000; }
    const month = state.budgetPeriods?.find((p) => p.type === "month" && p.key === "2026-10");
    if (month) { month.confirmed = 15000; month.revision = 2; }
  });
  const restored = restoreIntoFresh(bundle);
  return { origin, restored, bundle, backupSnapshot, offConfig };
}

describe("synthetic isolated restore", () => {
  it("backup snapshot captures OFF mode, revocation state, purge state, slot/budget reservations and nonce high-water", async () => {
    const { backupSnapshot, offConfig } = await setup();
    expect(readSendConfig(offConfig)).toMatchObject({ mode: "dry-run", enabled: false });
    expect(isExplicitSendDisabled(offConfig, sendPolicy)).toBe(true);
    // The gate validates a minimal runtime shape (strict schema), not the
    // full CoreRuntime row: blocked flag + activation epoch are its inputs.
    const gateRuntime = { blocked: false as const, environment: "preview" as const, provider: "solapi" as const, activationEpoch: at0 };
    expect(evaluateSendGate({ config: offConfig, runtime: gateRuntime, policy: sendPolicy, occurredAt: at0 })).toEqual({ allowed: false, reason: "send_disabled" });
    expect(backupSnapshot.runtime).toMatchObject({ blocked: false, keyVersion: "syn_kv_1", nonceHighWater: 100n, recoveryVerified: false });
    expect(backupSnapshot.nonceHighWaters).toEqual({ syn_kv_1: 100n });
    expect(backupSnapshot.recipients.map((r) => r.id).sort()).toEqual(["syn_r1", "syn_r2"]);
    expect(backupSnapshot.recipientPurgeApprovals).toEqual([]);
    expect(backupSnapshot.slots).toMatchObject([{ id: "syn_s1", status: "in_flight", reserved: 15000, confirmed: null }]);
    expect(backupSnapshot.budgetPeriods).toMatchObject([
      { type: "day", key: "2026-10-28", confirmed: 0 },
      { type: "month", key: "2026-10", confirmed: 0 },
    ]);
  });

  it("serialized backup restores into a fresh repository with identical state and leaves the empty store untouched", async () => {
    const { restored, backupSnapshot, bundle } = await setup();
    const empty = new InMemoryDispatchRepository(emptyState());
    expect((await empty.snapshot()).recipients).toEqual([]);
    expect((await empty.snapshot()).slots).toEqual([]);
    const restoredSnapshot = await restored.snapshot();
    expect(restoredSnapshot).toEqual(backupSnapshot);
    expect(createHash("sha256").update(serialize(restoredSnapshot)).digest("hex")).toBe(
      createHash("sha256").update(bundle.bytes).digest("hex"),
    );
    expect(await empty.snapshot()).toEqual(emptyState());
  });

  it("restored mode is OFF", async () => {
    const { restored, bundle, offConfig } = await setup();
    const snap = await restored.snapshot();
    expect(snap.runtime).toMatchObject({ blocked: false });
    expect(isExplicitSendDisabled(bundle.config, sendPolicy)).toBe(true);
    const gateRuntime = { blocked: false as const, environment: "preview" as const, provider: "solapi" as const, activationEpoch: at0 };
    expect(evaluateSendGate({ config: bundle.config, runtime: gateRuntime, policy: sendPolicy, occurredAt: at0 })).toEqual({ allowed: false, reason: "send_disabled" });
    expect(readSendConfig(offConfig)).toMatchObject({ mode: "dry-run", enabled: false });
  });

  it("post-backup origin revocations and purges are absent from the restored copy and recorded as latest evidence missing", async () => {
    const { origin, restored } = await setup();
    const comparison = compareLatestEvidence(await origin.snapshot(), await restored.snapshot());
    expect(comparison.missingRevocations).toEqual(["syn_r2"]);
    expect(comparison.missingPurges).toEqual(["syn_r1"]);
    expect(comparison.status).toBe("latest_evidence_missing");
  });

  it("diverged restored slots and budget forbid permit issuance", async () => {
    const { origin, restored } = await setup();
    const comparison = compareLatestEvidence(await origin.snapshot(), await restored.snapshot());
    expect(comparison.slotDiverged).toBe(true);
    expect(comparison.budgetDiverged).toBe(true);
    expect(permitAllowedByComparison(comparison)).toBe(false);
  });

  it("restored nonce behind origin blocks new-key verification and restore does not self-certify recovery", async () => {
    const { origin, restored } = await setup();
    const comparison = compareLatestEvidence(await origin.snapshot(), await restored.snapshot());
    expect(comparison.nonceBehind).toBe(true);
    const snap = await restored.snapshot();
    expect(snap.nonceHighWaters).toEqual({ syn_kv_1: 100n });
    expect(snap.runtime).toMatchObject({ nonceHighWater: 100n, recoveryVerified: false });
  });

  it("re-applying origin-latest revocations and purges to the restored copy leaves no purged fields", async () => {
    const { restored } = await setup();
    await restored.transaction(async (state) => {
      state.audits.push({ eventId: "syn_audit_revoke_r2", eventType: "recipient_revoked", registrationId: "syn_r2", occurredAt: at1 });
      state.audits.push({ eventId: "syn_audit_purge_r1", eventType: "recipient_purged", registrationId: "syn_r1", occurredAt: at1 });
      state.recipientPurgeApprovals = [{ registrationId: "syn_r1", actorId: "syn_actor", commandId: "syn_cmd_purge_r1", approvalId: "syn_appr_purge_r1", evidenceId: "syn_ev_purge_r1" }];
      const target = state.recipients.find((r) => r.id === "syn_r1");
      if (target) { target.registration = null; target.target = null; }
    });
    const snap = await restored.snapshot();
    const purged = snap.recipients.find((r) => r.id === "syn_r1");
    expect(purged).toMatchObject({ registration: null, target: null });
    expect(snap.audits.some((a) => a.eventType === "recipient_purged" && a.registrationId === "syn_r1")).toBe(true);
    expect(snap.audits.some((a) => a.eventType === "recipient_revoked" && a.registrationId === "syn_r2")).toBe(true);
    // Re-application does not flip the mode: still OFF.
    expect(isExplicitSendDisabled({ mode: "dry-run", enabled: false, provider: "solapi", environment: "preview" }, sendPolicy)).toBe(true);
  });

  it("no automatic path transitions OFF to ON without explicit approval evidence", async () => {
    const { offConfig } = await setup();
    expect(requestSendEnable(null, offConfig)).toBe(false);
    // Approval alone never enables sends while the config stays dry-run/disabled.
    expect(requestSendEnable({ approvalId: "syn_appr_on" }, offConfig)).toBe(false);
    // Only explicit approval AND an explicitly live+enabled config enable.
    expect(requestSendEnable({ approvalId: "syn_appr_on" }, { mode: "live", enabled: true, provider: "solapi", environment: "preview" })).toBe(true);
    // The experiment never mutates the backed-up OFF config.
    expect(offConfig).toMatchObject({ mode: "dry-run", enabled: false });
  });
});
