import { encryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { MockProvider } from "@/lib/kakao/providers/mock";
import { buildOutboxInput, type OutboxRow } from "@/lib/kakao/outbox";
import { InMemoryOutboxStore } from "@/lib/kakao/outbox-store";
import { prepareSyntheticDispatch } from "@/server/kakao/dispatch-prepare";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";
import { randomBytes } from "node:crypto";

export const p5At = new Date("2026-10-28T00:00:00Z");
export async function createP5Fixture(mock: unknown) {
  const key = randomBytes(32);
  const state: CoreState = { outboxes: [], dispatches: [], slots: [], audits: [], recipients: [], runtime: null, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} };
  const repository = new InMemoryDispatchRepository(state); const store = new InMemoryOutboxStore(repository);
  const input = buildOutboxInput("application.received", `c${"3".repeat(24)}`, "created", "admin", p5At); await store.enqueue(input);
  const evidence = { id: "mock_ownership_v1" as const, method: "synthetic_call" as const, synthetic: true as const, success: true as const, registrationId: "r1", version: "v1", verifiedAt: p5At, verifierId: "u1" };
  const user = { id: "u1", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
  await repository.transaction(async (s) => {
    s.users = [user]; s.ownershipEvidence = [evidence]; s.nonceHighWaters = { k1: 1n };
    s.runtime = { environment: "preview", provider: "solapi", namespace: "preview_g2", blocked: false, activationEpoch: p5At, revision: 1, keyVersion: "k1", nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true };
  });
  const ciphertext = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), key, 1n, { environment: "preview", registrationId: "r1", registrationVersion: "v1", keyVersion: "k1" }, { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true });
  const registration = { environment: "preview", service: "application.received", id: "r1", version: "v1", userId: "u1", purposeVersion: "p1", policyVersion: "p1", state: "active", ciphertext: { ...ciphertext, keyVersion: "k1", synthetic: true }, evidence };
  await repository.transaction(async (s) => { s.recipients.push({ id: "r1", version: "v1", userId: "u1", registration, target: user }); });
  const safe = { repository, provider: new MockProvider(mock), clock: () => p5At, prepare: async (row: OutboxRow) => {
    const fixed = await prepareSyntheticDispatch(repository, { rowId: row.id, claimToken: row.claimToken!, submission: { id: row.entityId, submittedAt: p5At, personalDataPurgedAt: null } });
    if (!fixed) throw new Error("Synthetic dispatch unavailable.");
    return { ...fixed, syntheticKey: { key, keyVersion: "k1", synthetic: true as const }, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } as const };
  } };
  return { store, repository, input, safe };
}
