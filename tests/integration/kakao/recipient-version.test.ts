import { describe, expect, it, vi } from "vitest";
import { activateRecipient, purgeRecipient, registerRecipient, revokeRecipient, verifyRecipient } from "@/server/kakao/recipient-registration";
import { resolveDispatchContext } from "@/server/kakao/context-resolver";
import { renderTemplate } from "@/lib/kakao/template";
import { MockProvider } from "@/lib/kakao/providers/mock";

const at = new Date("2026-10-28T00:00:00Z");
const target = { id: "u1", role: "ADMIN", isActive: true, mustChangePassword: false };
const actor = { user: target, assignments: ["register", "verify", "purge"] };
const pending = { environment: "preview", service: "application.received", id: "r1", version: "v1", userId: "u1", purposeVersion: "p1", policyVersion: "p1", state: "verification_pending", ciphertext: { ciphertext: Buffer.from([1]), nonce: Buffer.alloc(12), tag: Buffer.alloc(16), keyVersion: "k1", synthetic: true }, evidence: null };
const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: "r1", version: "v1", verifiedAt: at, verifierId: "u1" };
const request = { event: "application.received", audience: "admin", entityId: "s1", dedupeKey: `application.received:${"a".repeat(64)}`, recipient: { id: "r1", version: "v1", userId: "u1" } };
const submission = { id: "s1", submittedAt: at, personalDataPurgedAt: null };
function ready() {
  const r = registerRecipient({ registration: pending, actor, target, ownWorkNumberConfirmed: true, previousVersions: [], at });
  const v = verifyRecipient({ registration: r.registration, actor, target, evidence, at });
  return activateRecipient({ registration: v.registration, actor, target, activeRegistration: null, ciphertextValid: true, at });
}
describe("P3 recipient version, without storage", () => {
  it("resolves a fixed version, retaining the original time and rendering only in memory", () => {
    const active = ready(); const response = resolveDispatchContext({ request, submission, registration: active.registration, target });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("Expected context");
    expect(response.context.variables.접수시각).toBe("2026-10-28 09:00");
    expect(resolveDispatchContext({ request, submission: { ...submission, submittedAt: new Date("+010000-01-01T00:00:00Z") }, registration: active.registration, target })).toEqual({ ok: false, reason: "entity_unavailable" });
    const body = renderTemplate(response.context && { templateId: response.context.templateId, templateVersion: response.context.templateVersion, variables: response.context.variables });
    expect(JSON.stringify(response)).not.toContain(body);
    expect(JSON.stringify(active.audit)).not.toContain(body);
    expect(JSON.stringify(active.audit)).not.toContain("ciphertext");
  });
  it("requires designated active ADMIN and matching synthetic ownership evidence", () => {
    for (const bad of [{ ...actor, assignments: [] }, { ...actor, user: { ...target, role: "MANAGER" } }, { ...actor, user: { ...target, mustChangePassword: true } }]) expect(() => registerRecipient({ registration: pending, actor: bad, target, ownWorkNumberConfirmed: true, previousVersions: [], at })).toThrow();
    for (const bad of [{ ...evidence, method: "format_check" }, { ...evidence, synthetic: false }, { ...evidence, version: "v2" }, { ...evidence, success: false }]) expect(() => verifyRecipient({ registration: pending, actor, target, evidence: bad, at })).toThrow();
    expect(() => registerRecipient({ registration: pending, actor, target, ownWorkNumberConfirmed: true, previousVersions: [{ id: "r0", version: "v0", state: "active" }], at })).toThrow();
  });
  it("blocks revoked or changed roles and never reroutes to a replacement or another recipient", () => {
    const active = ready(); const send = vi.spyOn(MockProvider.prototype, "send"); const fetchSpy = vi.spyOn(globalThis, "fetch");
    const revoked = revokeRecipient({ registration: active.registration, actor, reason: "replaced", at });
    expect(revoked.registration.ciphertext).toBeNull(); expect(revoked.registration.evidence).toEqual(evidence);
    const purged = purgeRecipient({ registration: revoked.registration, actor, at });
    expect(purged.registration.state).toBe("purged"); expect(purged.registration.evidence).toEqual(evidence);
    const replacement = { ...active.registration, id: "r2", version: "v2", evidence: { ...evidence, registrationId: "r2", version: "v2" } };
    const other = { ...active.registration, userId: "u2" };
    for (const [registration, user] of [[revoked.registration, target], [purged.registration, target], [replacement, target], [other, target], [active.registration, { ...target, isActive: false }], [active.registration, { ...target, role: "TEACHER" }]] as const) {
      expect(resolveDispatchContext({ request, submission, registration, target: user })).toEqual({ ok: false, reason: "recipient_unavailable" });
    }
    expect(send).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); send.mockRestore(); fetchSpy.mockRestore();
  });
  it("retains the fixed logical version through ciphertext rotation", () => {
    const active = ready().registration;
    const rotated = { ...active, ciphertext: { ...active.ciphertext!, keyVersion: "k2", ciphertext: Buffer.from([2]) } };
    expect(resolveDispatchContext({ request, submission, registration: active, target })).toEqual(resolveDispatchContext({ request, submission, registration: rotated, target }));
    expect(() => activateRecipient({ registration: { ...active, state: "verified_inactive" }, actor, target, activeRegistration: active, ciphertextValid: true, at })).toThrow();
  });
});
