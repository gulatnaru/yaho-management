import { describe, expect, it } from "vitest";
import {
  activateRealRecipient, realCipherSchema, realOwnershipEvidenceSchema, recipientAvailableReal,
  registerRealRecipient, revokeRealRecipient, verifyRealRecipient, type RealRegistration,
} from "@/server/kakao/recipient-registration-real";

const at = new Date("2026-11-07T00:00:00Z");
const registrant = { id: "owner", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
const verifier = { ...registrant, id: "verifier" };
const registerActor = { user: registrant, assignments: ["register"] };
const verifyActor = { user: verifier, assignments: ["verify"] };
const evidence = { id: "operator_call_verified", method: "operator_call", success: true, registrationId: "recipient", version: "version", verifierId: verifier.id, verifiedAt: at } as const;
function pending(): RealRegistration {
  return {
    environment: "preview", service: "application.received", id: evidence.registrationId, version: evidence.version,
    userId: registrant.id, purposeVersion: "application-received-v1", policyVersion: "g4-v1", state: "verification_pending",
    ciphertext: { ciphertext: Buffer.from("encrypted-fake-number"), nonce: Buffer.alloc(12), tag: Buffer.alloc(16), keyVersion: "key" }, evidence: null,
  };
}
function verify(registration: unknown = pending(), proof: unknown = evidence, operator: unknown = verifyActor) {
  return verifyRealRecipient({ registration, actor: operator, target: registrant, evidence: proof, at });
}
function verified() { return verify().registration; }
function activate(registration: unknown = verified()) {
  return activateRealRecipient({ registration, actor: registerActor, target: registrant, activeRegistration: null, ciphertextValid: true, at });
}

describe("real recipient ownership state machine", () => {
  it("registers, independently verifies and activates with number-free audit references", () => {
    const registered = registerRealRecipient({ registration: pending(), actor: registerActor, target: registrant, ownWorkNumberConfirmed: true, previousVersions: [], at });
    expect(registered.audit).toMatchObject({ from: "unregistered", to: "verification_pending", reason: "registered" });
    const checked = verify(registered.registration);
    expect(checked.registration).toMatchObject({ state: "verified_inactive", evidence });
    expect(checked.audit.actorId).toBe(verifier.id);
    const activated = activate(checked.registration);
    expect(activated.audit).toMatchObject({ from: "verified_inactive", to: "active", reason: "activated" });
    expect(recipientAvailableReal(activated.registration, registrant, { id: evidence.registrationId, version: evidence.version, userId: registrant.id })).toBe(true);
    expect(JSON.stringify([registered.audit, checked.audit, activated.audit])).not.toMatch(/ciphertext|nonce|tag|phone/);
  });
  it("refuses registration without confirmation of an own work number", () => {
    expect(() => registerRealRecipient({ registration: pending(), actor: registerActor, target: registrant, ownWorkNumberConfirmed: false, previousVersions: [], at })).toThrow();
  });
  it.each([
    [{ id: evidence.registrationId, version: evidence.version, state: "revoked" }],
    [{ id: "other", version: "other", state: "active" }],
  ])("rejects duplicate versions or an already active registration", (previousVersions) => {
    expect(() => registerRealRecipient({ registration: pending(), actor: registerActor, target: registrant, ownWorkNumberConfirmed: true, previousVersions, at })).toThrow();
  });
  it("refuses self-verification even with the verify assignment", () => {
    expect(() => verify(pending(), { ...evidence, verifierId: registrant.id }, { user: registrant, assignments: ["verify"] })).toThrow();
  });
  it("requires the verifier's verify assignment", () => {
    expect(() => verify(pending(), evidence, { user: verifier, assignments: ["register"] })).toThrow();
  });
  it.each([
    { ...evidence, registrationId: "other" },
    { ...evidence, version: "other" },
    { ...evidence, verifierId: "other" },
    { ...evidence, verifiedAt: new Date(at.getTime() + 1) },
    { ...evidence, success: false },
    { ...evidence, synthetic: true },
    { ...evidence, id: "mock_ownership_v1", method: "synthetic_call", synthetic: true },
  ])("rejects mismatched, unsuccessful or synthetic ownership evidence", (proof) => {
    expect(() => verify(pending(), proof)).toThrow();
  });
  it.each(["verified_inactive", "active", "revoked", "superseded", "purged"] as const)("cannot verify a %s registration", (state) => {
    expect(() => verify({ ...pending(), state })).toThrow();
  });
  it("requires ciphertext before verification", () => {
    expect(() => verify({ ...pending(), ciphertext: null })).toThrow();
  });
  it.each([
    { ...registrant, role: "SUPER_ADMIN" },
    { ...registrant, role: "MANAGER" },
    { ...registrant, isActive: false },
    { ...registrant, mustChangePassword: true },
  ])("rejects ineligible ADMIN actors at the service boundary", (user) => {
    expect(() => registerRealRecipient({ registration: pending(), actor: { user, assignments: ["register"] }, target: registrant, ownWorkNumberConfirmed: true, previousVersions: [], at })).toThrow();
    expect(() => verify(pending(), { ...evidence, verifierId: user.id }, { user, assignments: ["verify"] })).toThrow();
    expect(() => activateRealRecipient({ registration: verified(), actor: { user, assignments: ["register"] }, target: registrant, activeRegistration: null, ciphertextValid: true, at })).toThrow();
    expect(() => revokeRealRecipient({ registration: pending(), actor: { user, assignments: ["register"] }, reason: "withdrawn", at })).toThrow();
  });
  it.each([
    { ...pending(), state: "verified_inactive", evidence: null },
    { ...verified(), evidence: { ...evidence, verifierId: registrant.id } },
    { ...verified(), evidence: { ...evidence, version: "other" } },
    { ...verified(), evidence: { ...evidence, id: "mock_ownership_v1", method: "synthetic_call", synthetic: true } },
    { ...verified(), ciphertext: null },
  ])("rejects missing or invalid activation proof", (registration) => {
    expect(() => activate(registration)).toThrow();
  });
  it("requires a valid cipher and an empty active slot for activation", () => {
    const input = { registration: verified(), actor: registerActor, target: registrant, activeRegistration: null, ciphertextValid: true, at };
    expect(() => activateRealRecipient({ ...input, ciphertextValid: false })).toThrow();
    expect(() => activateRealRecipient({ ...input, activeRegistration: pending() })).toThrow();
    expect(() => activate(pending())).toThrow();
  });
  it.each(["withdrawn", "replaced", "verification_stopped"] as const)("immediately erases ciphertext for %s", (reason) => {
    const transition = revokeRealRecipient({ registration: activate().registration, actor: registerActor, reason, at });
    expect(transition.registration.state).toBe(reason === "replaced" ? "superseded" : "revoked");
    expect(transition.registration.ciphertext).toBeNull();
    expect(transition.registration.evidence).toEqual(evidence);
    expect(transition.audit.reason).toBe(reason);
  });
  it("allows an ADMIN to withdraw their own number without an assignment", () => {
    expect(revokeRealRecipient({ registration: pending(), actor: { user: registrant, assignments: [] }, reason: "withdrawn", at }).registration.ciphertext).toBeNull();
  });
  it.each(["withdrawn", "replaced", "verification_stopped"] as const)("refuses %s by an unassigned third party", (reason) => {
    expect(() => revokeRealRecipient({ registration: pending(), actor: { user: verifier, assignments: ["verify"] }, reason, at })).toThrow();
  });
  it.each(["replaced", "verification_stopped"] as const)("requires a register assignment for self %s", (reason) => {
    expect(() => revokeRealRecipient({ registration: pending(), actor: { user: registrant, assignments: [] }, reason, at })).toThrow();
  });
  it.each(["revoked", "superseded", "purged"] as const)("cannot revoke an already terminal %s registration", (state) => {
    expect(() => revokeRealRecipient({ registration: { ...pending(), state }, actor: registerActor, reason: "withdrawn", at })).toThrow();
  });
  it("makes availability fail closed for missing, mock or self-signed evidence and changed identity", () => {
    const active = activate().registration;
    const fixed = { id: active.id, version: active.version, userId: active.userId };
    expect(recipientAvailableReal({ ...active, evidence: null }, registrant, fixed)).toBe(false);
    expect(recipientAvailableReal({ ...active, evidence: { ...evidence, verifierId: registrant.id } }, registrant, fixed)).toBe(false);
    expect(recipientAvailableReal({ ...active, evidence: { ...evidence, id: "mock_ownership_v1", method: "synthetic_call", synthetic: true } }, registrant, fixed)).toBe(false);
    expect(recipientAvailableReal(active, { ...registrant, isActive: false }, fixed)).toBe(false);
    expect(recipientAvailableReal(active, registrant, { ...fixed, version: "other" })).toBe(false);
    expect(recipientAvailableReal(verified(), registrant, fixed)).toBe(false);
  });
  it("uses the exact real evidence and cipher shapes without synthetic fields", () => {
    expect(realOwnershipEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(realOwnershipEvidenceSchema.safeParse({ ...evidence, synthetic: false }).success).toBe(false);
    expect(realCipherSchema.safeParse({ ...pending().ciphertext, synthetic: true }).success).toBe(false);
    expect(realCipherSchema.safeParse({ ...pending().ciphertext, ciphertext: Buffer.alloc(0) }).success).toBe(false);
    expect(realCipherSchema.safeParse({ ...pending().ciphertext, nonce: Buffer.alloc(11) }).success).toBe(false);
    expect(realCipherSchema.safeParse({ ...pending().ciphertext, tag: Buffer.alloc(15) }).success).toBe(false);
  });
});
