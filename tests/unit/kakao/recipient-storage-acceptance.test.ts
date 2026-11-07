import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { acquireDispatchPermit } from "@/server/kakao/dispatch-guard";
import { InMemoryDispatchRepository, PrismaDispatchRepository, type CoreState, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";

describe("P3 storage acceptance", () => {
  it("does not issue a permit for unauthenticated recipient ciphertext", async () => {
    const at = new Date("2026-10-28T00:00:00Z");
    const context = { event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`, recipientId: "r1", recipientVersion: "v1", submittedAt: at, templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } } as const;
    const target = { id: "u1", role: "ADMIN" as const, isActive: true, mustChangePassword: false };
    const nonce = Buffer.alloc(12); nonce[11] = 1;
    const registration = { environment: "preview", service: "application.received", id: "r1", version: "v1", userId: "u1", purposeVersion: "p1", policyVersion: "p1", state: "active", ciphertext: { ciphertext: Buffer.from([1]), nonce, tag: Buffer.alloc(16), keyVersion: "k1", synthetic: true }, evidence: { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: "r1", version: "v1", verifiedAt: at, verifierId: "u1" } };
    const initial: CoreState = { users: [target], ownershipEvidence: [registration.evidence], nonceHighWaters: { k1: 1n }, lookupApprovals: [], lookups: [], closureApprovals: [], purgeApprovals: [], costApprovals: [], recipients: [{ id: "r1", version: "v1", userId: "u1", registration, target }], runtime: { environment: "preview", provider: "solapi", namespace: "preview_g2", blocked: false, activationEpoch: at, revision: 1, keyVersion: "k1", nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true }, outboxes: [{ id: "outbox1", dedupeKey: context.dedupeKey, occurredAt: at, status: "processing", claimToken: "claim1", leaseExpiresAt: new Date(at.getTime() + 300000) }], dispatches: [{ id: "dispatch1", outboxId: "outbox1", clientKey: `preview_g2:${context.dedupeKey}`, context, slotCount: 0, auditSequence: 0, state: "ready", unknownSince: null }], slots: [], audits: [], monthlyAdditionalCosts: {} };
    const db = new InMemoryDispatchRepository(initial);
    const permit = await acquireDispatchPermit(db, { recipientKey: { key: randomBytes(32), keyVersion: "k1", synthetic: true }, dispatchId: "dispatch1", claimToken: "claim1", context, now: at, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } });
    expect(permit).toBeNull();
    expect((await db.snapshot()).slots).toHaveLength(0);
  });
  it("does not write a Prisma permit when recipient authentication fails", async () => {
    const at = new Date("2026-10-28T00:00:00Z");
    const context = { event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`, recipientId: "r1", recipientVersion: "v1", submittedAt: at, templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } } as const;
    let writes = 0;
    const client: PrismaGuardClient = { async $transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>): Promise<T> { return work({
      async $queryRaw<T>(parts: TemplateStringsArray): Promise<T> {
        const sql = parts.join("?");
        if (sql.includes('FROM "NotificationRuntimeConfig"')) return [{ environment: "preview", blocked: false, activationEpoch: at, providerId: "solapi", namespace: "preview_g2", recipientVersion: "v1", templateVersion: "g2-v1", costPolicyVersion: "g2-v1", policyVersion: "g2-v1", keyVersion: "k1", nonceHighWater: 1n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true }] as T;
        if (sql.includes('FROM "NotificationOutbox"')) return [{ id: "outbox1", dedupeKey: context.dedupeKey, occurredAt: at, status: "processing", claimToken: "claim1", leaseExpiresAt: new Date(at.getTime() + 300000) }] as T;
        if (sql.includes('FROM "NotificationRecipientRegistration"') && sql.includes('SELECT "userId"')) return [{ userId: "u1" }] as T;
        if (sql.includes('FROM "User"')) return [{ id: "u1", role: "ADMIN", isActive: true, mustChangePassword: false }] as T;
        if (sql.includes('FROM "NotificationRecipientRegistration"')) { const nonce = Buffer.alloc(12); nonce[11] = 1; return [{ id: "r1", version: "v1", userId: "u1", environment: "preview", service: "application.received", state: "active", ciphertext: Buffer.from([1]), nonce, tag: Buffer.alloc(16), keyVersion: "k1", verificationMethod: "synthetic_call", verificationEvidenceId: "mock_ownership_v1", verifiedBy: "u1", verifiedAt: at }] as T; }
        if (sql.includes('FROM "NotificationDispatch"') && sql.includes('SELECT "outboxId"')) return [{ outboxId: "outbox1", recipientId: "r1" }] as T;
        if (sql.includes('FROM "NotificationDispatch"')) return [{ id: "dispatch1", outboxId: "outbox1", recipientId: "r1", recipientVersion: "v1", templateId: context.templateId, templateVersion: context.templateVersion, submittedAt: at, environment: "preview", providerId: "solapi", clientKey: `preview_g2:${context.dedupeKey}`, slotCount: 0, auditSequence: 0, reconciliationState: "ready" }] as T;
        if (sql.includes('FROM "NotificationAudit"')) return [{ eventId: "mock_evidence" }] as T;
        throw new Error("Unexpected query.");
      },
      async $executeRaw(): Promise<number> { writes++; return 1; },
    }); } };
    const permit = await acquireDispatchPermit(new PrismaDispatchRepository(client), { recipientKey: { key: randomBytes(32), keyVersion: "k1", synthetic: true }, dispatchId: "dispatch1", claimToken: "claim1", context, now: at, config: { mode: "live", enabled: true, provider: "solapi", environment: "preview" }, policy: { mode: "single_synthetic_only", activeEnvironment: "preview", otherEnvironmentActive: false, arrangement: "unresolved", previewAllocation: null, productionAllocation: null }, quote: { send: 15000, requiredRequestFee: 0, lookup: 500, monthlyPlan: 1000000, setup: 0, planApproved: true } });
    expect(permit).toBeNull(); expect(writes).toBe(0);
  });
});
