import { deserialize, serialize } from "node:v8";
import { describe, expect, it } from "vitest";
import { encryptSyntheticRecipient, decryptSyntheticRecipient } from "@/lib/kakao/send-contract";
import { PrismaDispatchRepository, type PrismaGuardClient, type PrismaGuardTransaction } from "@/server/kakao/dispatch-repository";
import { rotateSyntheticRecipient } from "@/server/kakao/runtime-settings";
const at = new Date("2026-10-28T00:00:00Z");
const oldKey = Buffer.alloc(32, 1); const newKey = Buffer.alloc(32, 2);
const safety = { counterCommitted: true, counterCurrent: true, nonceUnused: true, keyActive: true, recoveryVerified: true, registrationActive: true, rotationComplete: true } as const;
const binding = { environment: "preview", registrationId: "recipient1", registrationVersion: "version1", keyVersion: "key_old" } as const;
const original = encryptSyntheticRecipient(Buffer.from("synthetic-recipient"), oldKey, 2n, binding, safety);
function fakeRotation(failSecondAudit = false) {
  let state = { runtime: { blocked: true, ownerId: "owner1", keyExecutorId: "exec1", keyVersion: "key_old", nonceHighWater: 2n, nonceCurrent: true, recoveryVerified: true, rotationComplete: true, revision: 0 }, registration: { id: "recipient1", version: "version1", state: "active", keyVersion: "key_old", ...original }, dispatch: { id: "dispatch1", recipientId: "recipient1", recipientVersion: "version1" }, started: 0, completed: 0 };
  const client: PrismaGuardClient = { async $transaction<T>(work: (tx: PrismaGuardTransaction) => Promise<T>): Promise<T> {
    const next = deserialize(serialize(state)) as typeof state;
    const tx: PrismaGuardTransaction = {
      async $queryRaw<T>(strings: TemplateStringsArray): Promise<T> {
        const sql = strings.join("?"); let rows: unknown[];
        if (sql.includes('FROM "NotificationRuntimeConfig"')) rows = [next.runtime];
        else if (sql.includes('FROM "User"')) rows = ["owner1", "exec1"].map((id) => ({ id, role: "ADMIN", isActive: true, mustChangePassword: false }));
        else if (sql.includes("key_rotation_approved")) rows = [{ actorId: "owner1", commandId: "rotation1", evidenceId: "evidence1", keyVersion: "key_new", code: "synthetic_fresh_key" }];
        else if (sql.includes('FROM "NotificationAudit"')) rows = next.started ? [{ id: "prior" }] : [];
        else if (sql.includes('FROM "NotificationCostReservation"')) rows = [{ count: 0n }];
        else if (sql.includes('FROM "NotificationRecipientRegistration"') && sql.includes("COUNT(*)")) rows = [{ count: 0n }];
        else if (sql.includes('FROM "NotificationRecipientRegistration"')) rows = [next.registration];
        else throw new Error("Unexpected query.");
        return rows as T;
      },
      async $executeRaw(strings, ...values): Promise<number> {
        const sql = strings.join("?");
        if (sql.includes('SET "keyVersion" = ?')) { next.runtime.keyVersion = values[0] as string; next.runtime.nonceHighWater = 1n; next.runtime.rotationComplete = false; next.runtime.revision++; }
        else if (sql.includes('UPDATE "NotificationRecipientRegistration"')) { next.registration.ciphertext = values[0] as Buffer; next.registration.nonce = values[1] as Buffer; next.registration.tag = values[2] as Buffer; next.registration.keyVersion = values[3] as string; }
        else if (sql.includes('SET "rotationComplete" = true')) { next.runtime.rotationComplete = true; next.runtime.revision++; }
        else if (sql.includes("key_rotation_started")) next.started++;
        else if (sql.includes("key_rotation_completed")) { if (failSecondAudit) throw new Error("injected audit failure"); next.completed++; }
        else throw new Error("Unexpected write.");
        return 1;
      },
    };
    const result = await work(tx); state = next; return result;
  } };
  return { repository: new PrismaDispatchRepository(client), snapshot: () => deserialize(serialize(state)) as typeof state };
}
const command = { commandId: "rotation1", registrationId: "recipient1", registrationVersion: "version1", actorId: "exec1", approvalId: "approval1", evidenceId: "evidence1", oldKeyVersion: "key_old", newKeyVersion: "key_new", oldKey, newKey, synthetic: true, at };
describe("synthetic key rotation transaction contract", () => {
  it("burns a new nonce before an atomic verified ciphertext swap", async () => {
    const fake = fakeRotation(); await rotateSyntheticRecipient(fake.repository, command); const state = fake.snapshot();
    expect(state.runtime).toMatchObject({ blocked: true, keyVersion: "key_new", nonceHighWater: 1n, rotationComplete: true }); expect(state.started).toBe(1); expect(state.completed).toBe(1);
    expect(state.registration.version).toBe("version1"); expect(state.dispatch).toEqual({ id: "dispatch1", recipientId: "recipient1", recipientVersion: "version1" });
    const value = decryptSyntheticRecipient(state.registration, newKey, { ...binding, keyVersion: "key_new" }, safety);
    expect(value.toString()).toBe("synthetic-recipient");
  });
  it("keeps the nonce consumed and send blocked if the swap audit fails", async () => {
    const fake = fakeRotation(true); await expect(rotateSyntheticRecipient(fake.repository, command)).rejects.toThrow(); const state = fake.snapshot();
    expect(state.runtime).toMatchObject({ blocked: true, keyVersion: "key_new", nonceHighWater: 1n, rotationComplete: false }); expect(state.registration.keyVersion).toBe("key_old"); expect(state.started).toBe(1); expect(state.completed).toBe(0);
  });
  it("rejects the same key material under a different version", async () => {
    const fake = fakeRotation(); await expect(rotateSyntheticRecipient(fake.repository, { ...command, newKey: oldKey })).rejects.toThrow(); expect(fake.snapshot().runtime.keyVersion).toBe("key_old");
  });
});
