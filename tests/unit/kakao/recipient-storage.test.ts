import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryDispatchRepository, type CoreState } from "@/server/kakao/dispatch-repository";
import { activateStoredSyntheticRecipient, purgeStoredSyntheticRecipient, registerStoredSyntheticRecipient, revokeStoredSyntheticRecipient, setStoredSyntheticRecipientAssignment, verifyStoredSyntheticRecipient } from "@/server/kakao/recipient-storage";

const at = new Date("2026-10-28T00:00:00Z");
const key = { keyVersion: "key1", key: randomBytes(32), synthetic: true as const };
const user = { id: "owner1", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: "recipient1", version: "version1", verifierId: user.id, verifiedAt: at } as const;
function initial(): CoreState { return { users: [user], ownershipEvidence: [evidence], recipientPurgeApprovals: [{ registrationId: evidence.registrationId, actorId: user.id, commandId: "purge1", approvalId: "approval1", evidenceId: "evidence1" }], runtime: { environment: "preview", provider: "solapi", namespace: "preview_g2", blocked: true, activationEpoch: at, revision: 0, ownerId: user.id, purgeExecutorId: user.id, keyVersion: key.keyVersion, nonceHighWater: 0n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true }, recipients: [], outboxes: [], dispatches: [], slots: [], audits: [], lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], monthlyAdditionalCosts: {} }; }
const register = { registrationId: evidence.registrationId, version: evidence.version, userId: user.id, actorId: user.id, purposeVersion: "purpose1", policyVersion: "policy1", key, at };
const basic = { registrationId: evidence.registrationId, actorId: user.id, at };
describe("synthetic recipient storage", () => {
  it("commits transitions and number-free audits, retaining the registration after purge", async () => {
    const db = new InMemoryDispatchRepository(initial());
    await registerStoredSyntheticRecipient(db, register);
    await verifyStoredSyntheticRecipient(db, { ...basic, evidence });
    await activateStoredSyntheticRecipient(db, { ...basic, key });
    await revokeStoredSyntheticRecipient(db, { ...basic, reason: "replaced" });
    await purgeStoredSyntheticRecipient(db, { ...basic, commandId: "purge1", approvalId: "approval1", evidenceId: "evidence1" });
    const state = await db.snapshot();
    expect(state.runtime?.nonceHighWater).toBe(1n);
    expect(state.recipients[0].registration).toMatchObject({ id: evidence.registrationId, version: evidence.version, state: "purged", ciphertext: null });
    expect(state.audits.map((a) => a.eventType)).toEqual(["nonce_consumed", "recipient_registered", "recipient_verified", "recipient_activated", "recipient_revoked", "recipient_purged"]);
    expect(state.audits.find((a) => a.eventType === "recipient_revoked")?.code).toBe("replaced");
    const auditText = JSON.stringify(state.audits);
    expect(auditText).not.toMatch(/ciphertext|nonce\"|tag\"/);
    const allowed = ["eventId", "eventType", "actorId", "keyVersion", "occurredAt", "registrationId", "fromState", "toState", "evidenceId", "code", "commandId", "approvalId"];
    expect(state.audits.every((entry) => Object.keys(entry).every((field) => allowed.includes(field)))).toBe(true);
    expect(state.outboxes).toHaveLength(0);
  });
  it("rejects missing or forged ownership evidence", async () => {
    const state = initial(); state.ownershipEvidence = [];
    const db = new InMemoryDispatchRepository(state); await registerStoredSyntheticRecipient(db, register);
    await expect(verifyStoredSyntheticRecipient(db, { ...basic, evidence })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "verification_pending" });
  });
  it.each(["withdrawn", "replaced", "verification_stopped"] as const)("records the %s revocation reason", async (reason) => {
    const db = new InMemoryDispatchRepository(initial()); await registerStoredSyntheticRecipient(db, register);
    await revokeStoredSyntheticRecipient(db, { ...basic, reason });
    expect((await db.snapshot()).audits.find((a) => a.eventType === "recipient_revoked")?.code).toBe(reason);
  });
  it.each([
    { ...evidence, version: "other_version" },
    { ...evidence, verifierId: "other_user" },
    { ...evidence, verifiedAt: new Date(at.getTime() + 1) },
    { ...evidence, synthetic: false },
  ])("rejects evidence that is not bound to this registration and verifier", async (wrong) => {
    const db = new InMemoryDispatchRepository(initial()); await registerStoredSyntheticRecipient(db, register);
    await expect(verifyStoredSyntheticRecipient(db, { ...basic, evidence: wrong })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "verification_pending" });
  });
  it("burns the nonce but rolls back registration when its audit commit fails", async () => {
    const db = new InMemoryDispatchRepository(initial(), (state) => { if (state.audits.some((a) => a.eventType === "recipient_registered")) throw new Error("audit failure"); });
    await expect(registerStoredSyntheticRecipient(db, register)).rejects.toThrow();
    const state = await db.snapshot(); expect(state.runtime?.nonceHighWater).toBe(1n); expect(state.recipients).toHaveLength(0);
  });
  it("rejects an undesignated or deactivated actor before consuming a nonce", async () => {
    const state = initial(); state.users = [{ ...user, isActive: false }]; const db = new InMemoryDispatchRepository(state);
    await expect(registerStoredSyntheticRecipient(db, register)).rejects.toThrow();
    expect((await db.snapshot()).runtime?.nonceHighWater).toBe(0n);
  });
  it("authorizes a current owner-assigned registration and verification executor", async () => {
    const executor = { ...user, id: "executor1" }; const delegatedEvidence = { ...evidence, verifierId: executor.id };
    const state = initial(); state.users = [user, executor]; state.ownershipEvidence = [delegatedEvidence];
    const db = new InMemoryDispatchRepository(state);
    await expect(registerStoredSyntheticRecipient(db, { ...register, actorId: executor.id })).rejects.toThrow();
    await setStoredSyntheticRecipientAssignment(db, { commandId: "assign_register", actorId: user.id, executorId: executor.id, assignment: "register", active: true, at });
    await setStoredSyntheticRecipientAssignment(db, { commandId: "assign_verify", actorId: user.id, executorId: executor.id, assignment: "verify", active: true, at });
    await registerStoredSyntheticRecipient(db, { ...register, actorId: executor.id });
    await verifyStoredSyntheticRecipient(db, { ...basic, actorId: executor.id, evidence: delegatedEvidence });
    await setStoredSyntheticRecipientAssignment(db, { commandId: "unassign_register", actorId: user.id, executorId: executor.id, assignment: "register", active: false, at });
    await expect(registerStoredSyntheticRecipient(db, { ...register, registrationId: "recipient2", version: "version2", actorId: executor.id })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "verified_inactive" });
  });
  it("rolls back an assignment if its audit commit fails", async () => {
    const executor = { ...user, id: "executor1" }; const state = initial(); state.users = [user, executor];
    const db = new InMemoryDispatchRepository(state, (next) => { if (next.audits.some((a) => a.eventType === "recipient_assignment_granted")) throw new Error("audit failure"); });
    await expect(setStoredSyntheticRecipientAssignment(db, { commandId: "assign1", actorId: user.id, executorId: executor.id, assignment: "register", active: true, at })).rejects.toThrow();
    expect((await db.snapshot()).recipientAssignments).toBeUndefined();
  });
  it("invalidates delegated authority when the executor is disabled or the owner changes", async () => {
    const executor = { ...user, id: "executor1" }; const newOwner = { ...user, id: "owner2" };
    const state = initial(); state.users = [user, executor, newOwner]; const db = new InMemoryDispatchRepository(state);
    await setStoredSyntheticRecipientAssignment(db, { commandId: "assign1", actorId: user.id, executorId: executor.id, assignment: "register", active: true, at });
    await db.transaction(async (next) => { next.users!.find((u) => u.id === executor.id)!.isActive = false; });
    await expect(registerStoredSyntheticRecipient(db, { ...register, actorId: executor.id })).rejects.toThrow();
    await db.transaction(async (next) => { next.users!.find((u) => u.id === executor.id)!.isActive = true; next.runtime!.ownerId = newOwner.id; });
    await expect(registerStoredSyntheticRecipient(db, { ...register, actorId: executor.id })).rejects.toThrow();
  });
  it("rejects tampered ciphertext before activation", async () => {
    const db = new InMemoryDispatchRepository(initial()); await registerStoredSyntheticRecipient(db, register); await verifyStoredSyntheticRecipient(db, { ...basic, evidence });
    await db.transaction(async (state) => { const row = state.recipients[0].registration as { ciphertext: { tag: Buffer } }; row.ciphertext.tag[0] ^= 1; });
    await expect(activateStoredSyntheticRecipient(db, { ...basic, key })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "verified_inactive" });
  });
  it("serializes competing activations to one active registration", async () => {
    const secondEvidence = { ...evidence, registrationId: "recipient2", version: "version2" };
    const state = initial(); state.ownershipEvidence = [evidence, secondEvidence];
    const db = new InMemoryDispatchRepository(state);
    await Promise.all([registerStoredSyntheticRecipient(db, register), registerStoredSyntheticRecipient(db, { ...register, registrationId: secondEvidence.registrationId, version: secondEvidence.version })]);
    await verifyStoredSyntheticRecipient(db, { ...basic, evidence });
    await verifyStoredSyntheticRecipient(db, { ...basic, registrationId: secondEvidence.registrationId, evidence: secondEvidence });
    const results = await Promise.allSettled([activateStoredSyntheticRecipient(db, { ...basic, key }), activateStoredSyntheticRecipient(db, { ...basic, registrationId: secondEvidence.registrationId, key })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.snapshot()).recipients.filter((r) => (r.registration as { state: string }).state === "active")).toHaveLength(1);
  });
  it("rolls back revocation when its audit commit fails", async () => {
    const db = new InMemoryDispatchRepository(initial(), (state) => { if (state.audits.some((a) => a.eventType === "recipient_revoked")) throw new Error("audit failure"); });
    await registerStoredSyntheticRecipient(db, register); await verifyStoredSyntheticRecipient(db, { ...basic, evidence }); await activateStoredSyntheticRecipient(db, { ...basic, key });
    await expect(revokeStoredSyntheticRecipient(db, { ...basic, reason: "withdrawn" })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "active" });
  });
  it("does not purge without the assigned executor and matching owner approval", async () => {
    const db = new InMemoryDispatchRepository(initial());
    await registerStoredSyntheticRecipient(db, register); await revokeStoredSyntheticRecipient(db, { ...basic, reason: "verification_stopped" });
    await expect(purgeStoredSyntheticRecipient(db, { ...basic, commandId: "other", approvalId: "approval1", evidenceId: "evidence1" })).rejects.toThrow();
    expect((await db.snapshot()).recipients[0].registration).toMatchObject({ state: "revoked" });
  });
  it("rejects resetting a previously used key version after another version", async () => {
    const db = new InMemoryDispatchRepository(initial()); await registerStoredSyntheticRecipient(db, register);
    const nextKey = { keyVersion: "key2", key: randomBytes(32), synthetic: true as const };
    await db.transaction(async (state) => { state.runtime!.keyVersion = nextKey.keyVersion; state.runtime!.nonceHighWater = 0n; });
    await registerStoredSyntheticRecipient(db, { ...register, registrationId: "recipient2", version: "version2", key: nextKey });
    await db.transaction(async (state) => { state.runtime!.keyVersion = key.keyVersion; state.runtime!.nonceHighWater = 0n; });
    await expect(registerStoredSyntheticRecipient(db, { ...register, registrationId: "recipient3", version: "version3" })).rejects.toThrow("Nonce history unavailable.");
    expect((await db.snapshot()).nonceHighWaters).toEqual({ key1: 1n, key2: 1n });
  });
  it.each(["recipient_verified", "recipient_activated", "recipient_purged"] as const)("rolls back %s when audit commit fails", async (eventType) => {
    let fail = false;
    const db = new InMemoryDispatchRepository(initial(), (state) => { if (fail && state.audits.some((a) => a.eventType === eventType)) throw new Error("audit failure"); });
    await registerStoredSyntheticRecipient(db, register);
    if (eventType !== "recipient_verified") await verifyStoredSyntheticRecipient(db, { ...basic, evidence });
    if (eventType === "recipient_purged") { await activateStoredSyntheticRecipient(db, { ...basic, key }); await revokeStoredSyntheticRecipient(db, { ...basic, reason: "withdrawn" }); }
    const before = await db.snapshot(); fail = true;
    if (eventType === "recipient_verified") await expect(verifyStoredSyntheticRecipient(db, { ...basic, evidence })).rejects.toThrow();
    else if (eventType === "recipient_activated") await expect(activateStoredSyntheticRecipient(db, { ...basic, key })).rejects.toThrow();
    else await expect(purgeStoredSyntheticRecipient(db, { ...basic, commandId: "purge1", approvalId: "approval1", evidenceId: "evidence1" })).rejects.toThrow();
    expect(await db.snapshot()).toEqual(before);
  });
});
