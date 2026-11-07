import { randomBytes } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { describe, expect, it } from "vitest";
import { PrismaDispatchRepository, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { activatePrismaSyntheticRecipient, decryptPrismaSyntheticRecipient, purgePrismaSyntheticRecipient, recordPrismaSyntheticOwnership, registerPrismaSyntheticRecipient, revokePrismaSyntheticRecipient, setPrismaSyntheticRecipientAssignment, SyntheticOwnershipMock, verifyPrismaSyntheticRecipient } from "@/server/kakao/recipient-storage-prisma";

const at = new Date("2026-10-28T00:00:00Z");
const key = { keyVersion: "key1", key: randomBytes(32), synthetic: true as const };
const command = { registrationId: "recipient1", version: "version1", userId: "owner1", actorId: "owner1", purposeVersion: "purpose1", policyVersion: "policy1", key, at };
function fake(failAudit: boolean) {
  let state = { runtime: { ownerId: "owner1", purgeExecutorId: "owner1", recipientVersion: null as string | null, blocked: false, keyVersion: "key1", nonceHighWater: 0n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true, revision: 0 }, registrations: [] as Record<string, unknown>[], audits: [] as string[], codes: [] as string[], assignments: [] as { commandId: string; eventType: string; actorId: string; payloadBinding: string; code: string; revisionAfter: number }[], evidence: [] as { registrationId: string; version: string; verifierId: string; verifiedAt: Date }[] };
  let tail: Promise<void> = Promise.resolve();
  let failEvent: string | null = null;
  const client: PrismaGuardClient = { async $transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>): Promise<T> {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
    try {
    const next = deserialize(serialize(state)) as typeof state;
    const tx: PrismaGuardTransaction = {
      async $queryRaw<T>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> {
        const sql = parts.join("?");
        if (sql.includes('FROM "NotificationRuntimeConfig"')) return [{ ...next.runtime }] as T;
        if (sql.includes('FROM "User"')) return ["owner1", "owner2", "executor1"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false })) as T;
        if (sql.includes('FROM "NotificationOutbox"')) return [{ id: "outbox1", dedupeKey: `application.received:${"a".repeat(64)}`, status: "processing", claimToken: "claim1", leaseExpiresAt: new Date(at.getTime() + 300000) }] as T;
        if (sql.includes('FROM "NotificationDispatch"')) return [{ id: "dispatch1", outboxId: "outbox1", recipientId: "recipient1", recipientVersion: "version1", templateId: "mock_application_received_v1", templateVersion: "g2-v1", submittedAt: at, reconciliationState: "in_flight" }] as T;
        if (sql.includes('FROM "NotificationCostReservation"')) return [{ id: "slot1", status: "in_flight" }] as T;
        if (sql.includes('FROM "NotificationRecipientRegistration"')) return next.registrations as T;
        if (sql.includes('FROM "NotificationAudit"') && sql.includes("recipient_purge_approved")) return [{ actorId: "owner1", registrationId: command.registrationId, commandId: "purge1", evidenceId: "evidence1" }] as T;
        if (sql.includes('FROM "NotificationAudit"') && sql.includes("recipient_assignment_granted")) return next.assignments.filter((a) => a.actorId === values[0] && a.payloadBinding === values[1] && a.code === values[2] && a.revisionAfter <= (values[3] as number)).sort((a, b) => b.revisionAfter - a.revisionAfter).slice(0, 1) as T;
        if (sql.includes('FROM "NotificationAudit"') && sql.includes('"commandId" =')) return next.assignments.filter((a) => a.commandId === values[0]) as T;
        if (sql.includes('FROM "NotificationAudit"')) return (next.evidence.some((e) => e.registrationId === values[0] && e.version === values[1] && e.verifierId === values[2] && values[3] instanceof Date && e.verifiedAt.getTime() === values[3].getTime()) ? [{ eventId: "evidence1" }] : []) as T;
        throw new Error("Unexpected query.");
      },
      async $executeRaw(parts, ...values): Promise<number> {
        const sql = parts.join("?");
        if (sql.includes('SET "nonceHighWater"')) next.runtime.nonceHighWater = values[0] as bigint;
        else if (sql.includes('INSERT INTO "NotificationRecipientRegistration"')) next.registrations.push({ id: values[0], environment: "preview", service: "application.received", userId: values[1], version: values[2], state: "verification_pending", purposeVersion: values[3], policyVersion: values[4], ciphertext: values[5], nonce: values[6], tag: values[7], keyVersion: values[8], verificationMethod: null, verificationEvidenceId: null, verifiedBy: null, verifiedAt: null });
        else if (sql.includes('UPDATE "NotificationRecipientRegistration"')) {
          const targetId = sql.includes('SET "state" = \'verified_inactive\'') ? values[2] : sql.includes('SET "state" = \'active\'') || sql.includes('SET "state" = \'purged\'') ? values[1] : values[2];
          const row = next.registrations.find((r) => r.id === targetId); if (!row) throw new Error("Missing registration.");
          if (sql.includes('SET "state" = \'verified_inactive\'')) Object.assign(row, { state: "verified_inactive", verificationMethod: "synthetic_call", verificationEvidenceId: "mock_ownership_v1", verifiedBy: values[0], verifiedAt: values[1] });
          else if (sql.includes('SET "state" = \'active\'')) row.state = "active";
          else if (sql.includes('SET "state" = \'purged\'')) Object.assign(row, { state: "purged", ciphertext: null, nonce: null, tag: null, keyVersion: null });
          else Object.assign(row, { state: values[0], ciphertext: null, nonce: null, tag: null, keyVersion: null });
        }
        else if (sql.includes('SET "recipientVersion"')) { next.runtime.recipientVersion = values[0] as string; next.runtime.revision++; }
        else if (sql.includes('UPDATE "NotificationRuntimeConfig"') && sql.includes('SET "revision"')) next.runtime.revision++;
        else if (sql.includes('INSERT INTO "NotificationAudit"')) {
          if (sql.includes("nonce_consumed")) next.audits.push("nonce_consumed");
          else if (sql.includes("synthetic_ownership_confirmed")) next.evidence.push({ registrationId: values[2] as string, verifierId: values[3] as string, version: values[4] as string, verifiedAt: values[5] as Date });
          else if (sql.includes('"payloadBinding"')) { if (failAudit || values[2] === failEvent) throw new Error("injected audit failure"); next.assignments.push({ commandId: values[0] as string, eventType: values[2] as string, actorId: values[3] as string, payloadBinding: values[5] as string, code: values[6] as string, revisionAfter: values[9] as number }); }
          else { const eventType = sql.includes("'recipient_purged'") ? "recipient_purged" : values[4] as string; if (failAudit || eventType === failEvent) throw new Error("injected audit failure"); next.audits.push(eventType); if (eventType === "recipient_revoked") next.codes.push(values[8] as string); }
        } else throw new Error("Unexpected write.");
        return 1;
      },
    };
    const result = await work(tx); state = next; return result;
    } finally { release(); }
  } };
  return { repository: new PrismaDispatchRepository(client), snapshot: () => state, failOn: (eventType: string) => { failEvent = eventType; }, addEvidence: () => state.evidence.push({ registrationId: command.registrationId, version: command.version, verifierId: command.actorId, verifiedAt: at }) };
}
describe("Prisma synthetic recipient registration transaction fake", () => {
  it("commits a nonce before the registration and its audit", async () => {
    const db = fake(false); await registerPrismaSyntheticRecipient(db.repository, command);
    expect(db.snapshot().runtime.nonceHighWater).toBe(1n); expect(db.snapshot().registrations).toHaveLength(1);
    expect(db.snapshot().audits).toEqual(["nonce_consumed", "recipient_registered"]);
  });
  it("keeps the consumed nonce but rolls back registration when its audit fails", async () => {
    const db = fake(true); await expect(registerPrismaSyntheticRecipient(db.repository, command)).rejects.toThrow();
    expect(db.snapshot().runtime.nonceHighWater).toBe(1n); expect(db.snapshot().registrations).toHaveLength(0);
    expect(db.snapshot().audits).toEqual(["nonce_consumed"]);
  });
  it("serializes competing registrations in the synthetic transaction fake", async () => {
    const db = fake(false);
    const results = await Promise.allSettled([registerPrismaSyntheticRecipient(db.repository, command), registerPrismaSyntheticRecipient(db.repository, command)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.snapshot().registrations).toHaveLength(1);
    expect(db.snapshot().runtime.nonceHighWater).toBe(2n);
  });
  it("honors owner-granted duties and refuses a withdrawn duty", async () => {
    const db = fake(false); const executorId = "executor1"; const delegated = { ...command, actorId: executorId };
    await expect(registerPrismaSyntheticRecipient(db.repository, delegated)).rejects.toThrow();
    await setPrismaSyntheticRecipientAssignment(db.repository, { commandId: "assign_register", actorId: "owner1", executorId, assignment: "register", active: true, at });
    await setPrismaSyntheticRecipientAssignment(db.repository, { commandId: "assign_verify", actorId: "owner1", executorId, assignment: "verify", active: true, at });
    expect(db.snapshot().assignments.map((entry) => entry.code)).toEqual(["register", "verify"]);
    await registerPrismaSyntheticRecipient(db.repository, delegated);
    const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: command.registrationId, version: command.version, verifierId: executorId, verifiedAt: at } as const;
    const base = { registrationId: command.registrationId, actorId: executorId, at };
    await recordPrismaSyntheticOwnership(db.repository, new SyntheticOwnershipMock([evidence]), { ...base, evidence });
    await verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence });
    await setPrismaSyntheticRecipientAssignment(db.repository, { commandId: "unassign_register", actorId: "owner1", executorId, assignment: "register", active: false, at });
    await expect(registerPrismaSyntheticRecipient(db.repository, { ...delegated, registrationId: "recipient2", version: "version2" })).rejects.toThrow();
    expect(db.snapshot().registrations[0].state).toBe("verified_inactive");
  });
  it("rolls back the assignment revision when its audit fails", async () => {
    const db = fake(false); db.failOn("recipient_assignment_granted");
    await expect(setPrismaSyntheticRecipientAssignment(db.repository, { commandId: "assign1", actorId: "owner1", executorId: "executor1", assignment: "register", active: true, at })).rejects.toThrow();
    expect(db.snapshot().runtime.revision).toBe(0); expect(db.snapshot().assignments).toHaveLength(0);
  });
  it("does not inherit another owner's assignment", async () => {
    const db = fake(false); const executorId = "executor1";
    await setPrismaSyntheticRecipientAssignment(db.repository, { commandId: "assign1", actorId: "owner1", executorId, assignment: "register", active: true, at });
    db.snapshot().runtime.ownerId = "owner2";
    await expect(registerPrismaSyntheticRecipient(db.repository, { ...command, actorId: executorId })).rejects.toThrow();
  });
  it("allows only one competing activation in the synthetic transaction fake", async () => {
    const db = fake(false); const second = { ...command, registrationId: "recipient2", version: "version2" };
    await registerPrismaSyntheticRecipient(db.repository, command); await registerPrismaSyntheticRecipient(db.repository, second);
    const firstEvidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: command.registrationId, version: command.version, verifierId: command.actorId, verifiedAt: at } as const;
    const secondEvidence = { ...firstEvidence, registrationId: second.registrationId, version: second.version };
    const mock = new SyntheticOwnershipMock([firstEvidence, secondEvidence]);
    for (const evidence of [firstEvidence, secondEvidence]) {
      const base = { registrationId: evidence.registrationId, actorId: command.actorId, at };
      await recordPrismaSyntheticOwnership(db.repository, mock, { ...base, evidence }); await verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence });
    }
    const results = await Promise.allSettled([activatePrismaSyntheticRecipient(db.repository, { registrationId: command.registrationId, actorId: command.actorId, at, key }), activatePrismaSyntheticRecipient(db.repository, { registrationId: second.registrationId, actorId: command.actorId, at, key })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.snapshot().registrations.filter((r) => r.state === "active")).toHaveLength(1);
  });
  it("verifies, activates, revokes, and purges against the same transaction state", async () => {
    const db = fake(false); await registerPrismaSyntheticRecipient(db.repository, command);
    const base = { registrationId: command.registrationId, actorId: command.actorId, at };
    const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: command.registrationId, version: command.version, verifierId: command.actorId, verifiedAt: at };
    await recordPrismaSyntheticOwnership(db.repository, new SyntheticOwnershipMock([evidence]), { ...base, evidence });
    await verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence });
    await activatePrismaSyntheticRecipient(db.repository, { ...base, key });
    expect(db.snapshot().registrations[0].state).toBe("active");
    const context = { event: "application.received", audience: "admin", dedupeKey: `application.received:${"a".repeat(64)}`, recipientId: command.registrationId, recipientVersion: command.version, submittedAt: at, templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: "2026-10-28 09:00" } } as const;
    const permit = { dispatchId: "dispatch1", slotId: "slot1", claimToken: "claim1", providerId: "solapi", context } as const;
    db.snapshot().runtime.nonceHighWater = 0n;
    await expect(decryptPrismaSyntheticRecipient(db.repository, { permit, key, now: at })).rejects.toThrow();
    db.snapshot().runtime.nonceHighWater = 1n;
    const plaintext = await decryptPrismaSyntheticRecipient(db.repository, { permit, key, now: at });
    try { expect(plaintext.length).toBeGreaterThan(0); } finally { plaintext.fill(0); }
    await revokePrismaSyntheticRecipient(db.repository, { ...base, reason: "replaced" });
    expect(db.snapshot().codes).toEqual(["replaced"]);
    await expect(decryptPrismaSyntheticRecipient(db.repository, { permit, key, now: at })).rejects.toThrow();
    await purgePrismaSyntheticRecipient(db.repository, { ...base, commandId: "purge1", approvalId: "approval1", evidenceId: "evidence1" });
    expect(db.snapshot().registrations[0]).toMatchObject({ state: "purged", ciphertext: null });
  });
  it("rejects an absent or mismatched stored ownership observation", async () => {
    const db = fake(false); await registerPrismaSyntheticRecipient(db.repository, command);
    const base = { registrationId: command.registrationId, actorId: command.actorId, at };
    const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: command.registrationId, version: command.version, verifierId: command.actorId, verifiedAt: at };
    await expect(verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence })).rejects.toThrow();
    db.addEvidence();
    await expect(verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence: { ...evidence, version: "other_version" } })).rejects.toThrow();
    expect(db.snapshot().registrations[0].state).toBe("verification_pending");
  });
  it.each(["recipient_verified", "recipient_activated", "recipient_revoked", "recipient_purged"] as const)("rolls back %s on audit failure in the transaction fake", async (eventType) => {
    const db = fake(false); await registerPrismaSyntheticRecipient(db.repository, command); db.addEvidence();
    const base = { registrationId: command.registrationId, actorId: command.actorId, at };
    const evidence = { id: "mock_ownership_v1", method: "synthetic_call", synthetic: true, success: true, registrationId: command.registrationId, version: command.version, verifierId: command.actorId, verifiedAt: at };
    if (eventType !== "recipient_verified") await verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence });
    if (eventType === "recipient_revoked" || eventType === "recipient_purged") await activatePrismaSyntheticRecipient(db.repository, { ...base, key });
    if (eventType === "recipient_purged") await revokePrismaSyntheticRecipient(db.repository, { ...base, reason: "withdrawn" });
    const before = deserialize(serialize(db.snapshot())); db.failOn(eventType);
    if (eventType === "recipient_verified") await expect(verifyPrismaSyntheticRecipient(db.repository, { ...base, evidence })).rejects.toThrow();
    else if (eventType === "recipient_activated") await expect(activatePrismaSyntheticRecipient(db.repository, { ...base, key })).rejects.toThrow();
    else if (eventType === "recipient_revoked") await expect(revokePrismaSyntheticRecipient(db.repository, { ...base, reason: "withdrawn" })).rejects.toThrow();
    else await expect(purgePrismaSyntheticRecipient(db.repository, { ...base, commandId: "purge1", approvalId: "approval1", evidenceId: "evidence1" })).rejects.toThrow();
    expect(db.snapshot()).toEqual(before);
  });
});
