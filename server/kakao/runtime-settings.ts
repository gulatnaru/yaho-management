import "server-only";
import { z } from "zod";
import { appendNotificationAudit, type AuditTransaction } from "@/server/kakao/audit";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const commandSchema = z.object({ commandId: id, actorId: id, reason: z.enum(["operator_stop", "provider_incident", "cost_incident", "security_incident", "recovery_pending"]), expectedRevision: z.number().int().nonnegative(), at: z.date() }).strict();
type RuntimeRow = { environment: string; blocked: boolean; revision: number };
export interface BlockTransaction extends AuditTransaction {
  getActiveAdminForUpdate(id: string): Promise<{ role: string; isActive: boolean; mustChangePassword: boolean } | null>;
  getRuntimeForUpdate(environment: string): Promise<RuntimeRow | null>;
  getCommand(commandId: string): Promise<{ eventType: string; actorId: string | null; code: string | null; revisionBefore: number | null } | null>;
  updateRuntimeBlock(environment: string, revision: number, reason: string): Promise<void>;
}
export interface RuntimeRepository { transaction<T>(f: (tx: BlockTransaction) => Promise<T>): Promise<T> }
/** Any active ADMIN can stop new sends. The runtime revision and audit commit together. */
export async function blockNewSends(repository: RuntimeRepository, value: unknown): Promise<void> {
  const input = commandSchema.parse(value);
  await repository.transaction(async (tx) => {
    const runtime = await tx.getRuntimeForUpdate("preview");
    const admin = await tx.getActiveAdminForUpdate(input.actorId);
    if (!runtime || !admin || admin.role !== "ADMIN" || !admin.isActive || admin.mustChangePassword) throw new Error("Block command unavailable.");
    const prior = await tx.getCommand(input.commandId);
    if (prior) {
      if (prior.eventType !== "send_blocked" || prior.actorId !== input.actorId || prior.code !== input.reason || prior.revisionBefore !== input.expectedRevision) throw new Error("Command conflict.");
      return;
    }
    if (runtime.revision !== input.expectedRevision) throw new Error("Runtime revision conflict.");
    await tx.updateRuntimeBlock("preview", runtime.revision, input.reason);
    await appendNotificationAudit(tx, { eventId: input.commandId, environment: "preview", eventType: "send_blocked", occurredAt: input.at, actorId: input.actorId, commandId: input.commandId, code: input.reason, fromState: runtime.blocked ? "blocked" : "open", toState: "blocked", revisionBefore: runtime.revision, revisionAfter: runtime.revision + 1 });
  });
}

/** Commit the counter before encryption; a later failure consumes the value. */
export async function consumeSyntheticNonce(repository: import("@/server/kakao/dispatch-repository").PrismaDispatchRepository, value: unknown): Promise<bigint> {
  const input = z.object({ keyVersion: id, at: z.date() }).strict().parse(value);
  return repository.transaction(async (tx) => {
    type NonceRow = { keyVersion: string | null; nonceHighWater: bigint; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean };
    const [runtime] = await tx.$queryRaw<NonceRow[]>`SELECT "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || runtime.keyVersion !== input.keyVersion || !runtime.nonceCurrent || !runtime.recoveryVerified || !runtime.rotationComplete || runtime.nonceHighWater < 0n || runtime.nonceHighWater >= (1n << 63n) - 1n) throw new Error("Nonce unavailable.");
    const next = runtime.nonceHighWater + 1n;
    const changed = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "nonceHighWater" = ${next} WHERE "environment" = 'preview' AND "keyVersion" = ${input.keyVersion} AND "nonceHighWater" = ${runtime.nonceHighWater}`;
    if (changed !== 1) throw new Error("Nonce unavailable.");
    const { randomUUID } = await import("node:crypto"); const eventId = randomUUID();
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "keyVersion", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'nonce_consumed', ${input.keyVersion}, ${input.at})`;
    return next;
  });
}

/** Prisma block-command adapter; all effects use the caller's single transaction. */
export class PrismaRuntimeRepository implements RuntimeRepository {
  constructor(private readonly repository: import("@/server/kakao/dispatch-repository").PrismaDispatchRepository) {}
  async transaction<T>(work: (tx: BlockTransaction) => Promise<T>): Promise<T> {
    return this.repository.transaction(async (raw) => work({
      async getRuntimeForUpdate(environment) {
        const rows = await raw.$queryRaw<RuntimeRow[]>`SELECT "environment", "blocked", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = ${environment} FOR UPDATE`;
        return rows[0] ?? null;
      },
      async getActiveAdminForUpdate(actorId) {
        const rows = await raw.$queryRaw<{ role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${actorId} FOR UPDATE`;
        return rows[0] ?? null;
      },
      async getCommand(commandId) {
        const rows = await raw.$queryRaw<{ eventType: string; actorId: string | null; code: string | null; revisionBefore: number | null }[]>`SELECT "eventType", "actorId", "code", "revisionBefore" FROM "NotificationAudit" WHERE "eventId" = ${commandId}`;
        return rows[0] ?? null;
      },
      async updateRuntimeBlock(environment, revision, reason) {
        const changed = await raw.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "blocked" = true, "blockReason" = ${reason}, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = ${environment} AND "revision" = ${revision}`;
        if (changed !== 1) throw new Error("Runtime revision conflict.");
      },
      notificationAudit: { async create({ data }) {
        await raw.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "occurredAt", "actorId", "commandId", "code", "fromState", "toState", "revisionBefore", "revisionAfter") VALUES (${data.eventId}, ${data.eventId}, ${data.environment}, ${data.eventType}, ${data.occurredAt}, ${data.actorId ?? null}, ${data.commandId ?? null}, ${data.code ?? null}, ${data.fromState ?? null}, ${data.toState ?? null}, ${data.revisionBefore ?? null}, ${data.revisionAfter ?? null})`;
      } },
    }));
  }
}

const rotationCommand = z.object({ commandId: id, registrationId: id, registrationVersion: id, actorId: id, approvalId: id, evidenceId: id, oldKeyVersion: id, newKeyVersion: id, oldKey: z.instanceof(Buffer).refine((b) => b.length === 32), newKey: z.instanceof(Buffer).refine((b) => b.length === 32), synthetic: z.literal(true), at: z.date() }).strict().refine((x) => x.oldKeyVersion !== x.newKeyVersion && !x.oldKey.equals(x.newKey));
/** Synthetic rotation: commit a fresh key's nonce first, then atomically swap ciphertext and audit. */
export async function rotateSyntheticRecipient(repository: import("@/server/kakao/dispatch-repository").PrismaDispatchRepository, value: unknown): Promise<void> {
  const input = rotationCommand.parse(value);
  const original = await repository.transaction(async (tx) => {
    type Runtime = { blocked: boolean; ownerId: string | null; keyExecutorId: string | null; keyVersion: string | null; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean; revision: number };
    const [runtime] = await tx.$queryRaw<Runtime[]>`SELECT "blocked", "ownerId", "keyExecutorId", "keyVersion", "nonceCurrent", "recoveryVerified", "rotationComplete", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || !runtime.blocked || !runtime.ownerId || runtime.keyExecutorId !== input.actorId || runtime.keyVersion !== input.oldKeyVersion || !runtime.nonceCurrent || !runtime.recoveryVerified || !runtime.rotationComplete) throw new Error("Rotation unavailable.");
    const users = await tx.$queryRaw<{ id: string; role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "id", "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" IN (${runtime.ownerId}, ${input.actorId}) ORDER BY "id" FOR UPDATE`;
    const authorized = (id: string) => users.some((user) => user.id === id && user.role === "ADMIN" && user.isActive && !user.mustChangePassword);
    if (!authorized(runtime.ownerId) || !authorized(input.actorId)) throw new Error("Rotation authority unavailable.");
    const [approval] = await tx.$queryRaw<{ actorId: string | null; commandId: string | null; evidenceId: string | null; keyVersion: string | null; code: string | null }[]>`SELECT "actorId", "commandId", "evidenceId", "keyVersion", "code" FROM "NotificationAudit" WHERE "eventId" = ${input.approvalId} AND "environment" = 'preview' AND "eventType" = 'key_rotation_approved'`;
    if (!approval || approval.actorId !== runtime.ownerId || approval.commandId !== input.commandId || approval.evidenceId !== input.evidenceId || approval.keyVersion !== input.newKeyVersion || approval.code !== "synthetic_fresh_key") throw new Error("Rotation approval unavailable.");
    const prior = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationAudit" WHERE "environment" = 'preview' AND "keyVersion" = ${input.newKeyVersion} AND "eventType" IN ('nonce_consumed', 'key_rotation_started', 'key_rotation_completed') LIMIT 1`;
    if (prior.length) throw new Error("Key version already used.");
    const [active] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS "count" FROM "NotificationCostReservation" c JOIN "NotificationDispatch" d ON d."id" = c."dispatchId" WHERE d."environment" = 'preview' AND c."status" = 'in_flight'`;
    if (!active || active.count !== 0n) throw new Error("Requests still in flight.");
    type Registration = { id: string; version: string; state: string; keyVersion: string | null; ciphertext: Buffer | null; nonce: Buffer | null; tag: Buffer | null };
    const [registration] = await tx.$queryRaw<Registration[]>`SELECT "id", "version", "state", "keyVersion", "ciphertext", "nonce", "tag" FROM "NotificationRecipientRegistration" WHERE "id" = ${input.registrationId} AND "environment" = 'preview' FOR UPDATE`;
    if (!registration || registration.version !== input.registrationVersion || registration.state !== "active" || registration.keyVersion !== input.oldKeyVersion || !registration.ciphertext || !registration.nonce || !registration.tag) throw new Error("Registration unavailable.");
    const [others] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS "count" FROM "NotificationRecipientRegistration" WHERE "environment" = 'preview' AND "id" <> ${input.registrationId} AND "ciphertext" IS NOT NULL`;
    if (!others || others.count !== 0n) throw new Error("Other ciphertexts require rotation.");
    const changed = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "keyVersion" = ${input.newKeyVersion}, "nonceHighWater" = 1, "rotationComplete" = false, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = 'preview' AND "revision" = ${runtime.revision}`;
    if (changed !== 1) throw new Error("Rotation state changed.");
    const eventId = `${input.commandId}_started`;
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "keyVersion", "actorId", "commandId", "approvalId", "evidenceId", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'key_rotation_started', ${input.newKeyVersion}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${runtime.revision}, ${runtime.revision + 1}, ${input.at})`;
    return registration;
  });
  const { createCipheriv, createDecipheriv } = await import("node:crypto");
  const { recipientAad, nonceFromSequence } = await import("@/lib/kakao/send-contract");
  const oldBinding = { environment: "preview" as const, registrationId: input.registrationId, registrationVersion: input.registrationVersion, keyVersion: input.oldKeyVersion };
  const newBinding = { ...oldBinding, keyVersion: input.newKeyVersion };
  const decipher = createDecipheriv("aes-256-gcm", input.oldKey, original.nonce!, { authTagLength: 16 });
  decipher.setAAD(recipientAad(oldBinding)); decipher.setAuthTag(original.tag!);
  const plaintext = Buffer.concat([decipher.update(original.ciphertext!), decipher.final()]);
  const nonce = nonceFromSequence(1n);
  let ciphertext: Buffer; let tag: Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", input.newKey, nonce, { authTagLength: 16 }); cipher.setAAD(recipientAad(newBinding));
    ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); tag = cipher.getAuthTag();
    const verify = createDecipheriv("aes-256-gcm", input.newKey, nonce, { authTagLength: 16 }); verify.setAAD(recipientAad(newBinding)); verify.setAuthTag(tag);
    const roundtrip = Buffer.concat([verify.update(ciphertext), verify.final()]);
    try { if (!roundtrip.equals(plaintext)) throw new Error("Rotation verification failed."); } finally { roundtrip.fill(0); }
  } finally { plaintext.fill(0); }
  await repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ blocked: boolean; keyVersion: string | null; nonceHighWater: bigint; nonceCurrent: boolean; recoveryVerified: boolean; rotationComplete: boolean; revision: number }[]>`SELECT "blocked", "keyVersion", "nonceHighWater", "nonceCurrent", "recoveryVerified", "rotationComplete", "revision" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    if (!runtime || !runtime.blocked || runtime.keyVersion !== input.newKeyVersion || runtime.nonceHighWater !== 1n || !runtime.nonceCurrent || !runtime.recoveryVerified || runtime.rotationComplete) throw new Error("Rotation state changed.");
    const changed = await tx.$executeRaw`UPDATE "NotificationRecipientRegistration" SET "ciphertext" = ${ciphertext}, "nonce" = ${nonce}, "tag" = ${tag}, "keyVersion" = ${input.newKeyVersion} WHERE "id" = ${input.registrationId} AND "version" = ${input.registrationVersion} AND "state" = 'active' AND "keyVersion" = ${input.oldKeyVersion} AND "ciphertext" = ${original.ciphertext} AND "nonce" = ${original.nonce} AND "tag" = ${original.tag}`;
    if (changed !== 1) throw new Error("Registration changed.");
    const runtimeChanged = await tx.$executeRaw`UPDATE "NotificationRuntimeConfig" SET "rotationComplete" = true, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "environment" = 'preview' AND "revision" = ${runtime.revision}`;
    if (runtimeChanged !== 1) throw new Error("Rotation state changed.");
    const eventId = `${input.commandId}_completed`;
    await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "keyVersion", "actorId", "commandId", "approvalId", "evidenceId", "revisionBefore", "revisionAfter", "occurredAt") VALUES (${eventId}, ${eventId}, 'preview', 'key_rotation_completed', ${input.newKeyVersion}, ${input.actorId}, ${input.commandId}, ${input.approvalId}, ${input.evidenceId}, ${runtime.revision}, ${runtime.revision + 1}, ${input.at})`;
  });
}
