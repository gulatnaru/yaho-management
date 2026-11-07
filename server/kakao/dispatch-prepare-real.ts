import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { realDispatchContextSchema } from "@/lib/kakao/send-contract";
import { REAL_POLICY, realPolicySchema, type SendConfig } from "@/lib/kakao/send-config";
import { REAL_QUOTE, type SyntheticQuote } from "@/server/kakao/budget";
import { resolveRealDispatchContext } from "@/server/kakao/context-resolver";
import { registrationReal } from "@/server/kakao/recipient-storage-real";
import type { RealRegistration } from "@/server/kakao/recipient-registration-real";
import { formatSubmittedAt } from "@/lib/kakao/template";
import { PrismaDispatchRepository } from "@/server/kakao/dispatch-repository";

export type PreparedRealDispatch = {
  dispatchId: string;
  context: z.infer<typeof realDispatchContextSchema>;
  config: SendConfig; // { mode: "live", enabled: true, provider: "solapi", environment: "preview" }
  policy: z.infer<typeof realPolicySchema>; // REAL_POLICY
  quote: SyntheticQuote; // REAL_QUOTE
  recipientKey: { keyVersion: string; key: Buffer }; // No synthetic marker.
};

const REAL_CONFIG: SendConfig = { mode: "live", enabled: true, provider: "solapi", environment: "preview" };

/** Real counterpart of preparePrismaDispatch. The mock prepare is untouched. Reads only the minimal fields; the guard rechecks recipient and gate before issuance. */
export async function prepareRealDispatch(
  repository: PrismaDispatchRepository,
  input: { rowId: string; claimToken: string; recipientKey: { keyVersion: string; key: Buffer }; templateId: string },
): Promise<PreparedRealDispatch | null> {
  return repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ namespace: string; blocked: boolean; activationEpoch: Date | null; policyVersion: string | null; costPolicyVersion: string | null; templateVersion: string | null; recipientVersion: string | null }[]>`
      SELECT "namespace", "blocked", "activationEpoch", "policyVersion", "costPolicyVersion", "templateVersion", "recipientVersion"
      FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    const now = new Date();
    if (!runtime || runtime.blocked || !runtime.activationEpoch || runtime.activationEpoch.getTime() > now.getTime()
      || runtime.policyVersion !== "g4-v1" || runtime.costPolicyVersion !== "g4-v1" || !runtime.templateVersion) return null;
    const [row] = await tx.$queryRaw<{ id: string; eventKind: string; audience: string; entityId: string; dedupeKey: string }[]>`
      SELECT "id", "eventKind", "audience", "entityId", "dedupeKey" FROM "NotificationOutbox"
      WHERE "id" = ${input.rowId} AND "status" = 'processing' AND "claimToken" = ${input.claimToken} FOR UPDATE`;
    if (!row || row.eventKind !== "application.received" || row.audience !== "admin") return null;
    const [submission] = await tx.$queryRaw<{ id: string; submittedAt: Date; personalDataPurgedAt: Date | null }[]>`
      SELECT "id", "submittedAt", "personalDataPurgedAt" FROM "ReservationApplicationSubmission" WHERE "id" = ${row.entityId} FOR SHARE`;
    if (!submission || submission.personalDataPurgedAt !== null) return null;
    const candidates = await tx.$queryRaw<{ id: string; version: string; userId: string }[]>`
      SELECT "id", "version", "userId" FROM "NotificationRecipientRegistration"
      WHERE "environment" = 'preview' AND "service" = 'application.received' AND "state" = 'active'`;
    if (candidates.length !== 1) return null;
    const recipient = candidates[0];
    if (runtime.recipientVersion !== recipient.version) return null;
    const [user] = await tx.$queryRaw<{ role: string; isActive: boolean; mustChangePassword: boolean }[]>`
      SELECT "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${recipient.userId} FOR UPDATE`;
    if (!user || user.role !== "ADMIN" || !user.isActive || user.mustChangePassword) return null;
    const [locked] = await tx.$queryRaw<{ id: string; version: string; userId: string; environment: string; service: string; purposeVersion: string; policyVersion: string; state: string; ciphertext: Uint8Array | null; nonce: Uint8Array | null; tag: Uint8Array | null; keyVersion: string | null; verificationMethod: string | null; verificationEvidenceId: string | null; verifiedBy: string | null; verifiedAt: Date | null }[]>`
      SELECT "id", "version", "userId", "environment", "service", "purposeVersion", "policyVersion", "state", "ciphertext", "nonce", "tag", "keyVersion", "verificationMethod", "verificationEvidenceId", "verifiedBy", "verifiedAt"
      FROM "NotificationRecipientRegistration" WHERE "id" = ${recipient.id} AND "version" = ${recipient.version} AND "userId" = ${recipient.userId} AND "state" = 'active' FOR UPDATE`;
    if (!locked) return null;
    const registration = registrationReal({ ...locked, state: locked.state as RealRegistration["state"] });
    const resolved = resolveRealDispatchContext({
      request: { event: row.eventKind, audience: row.audience, entityId: row.entityId, dedupeKey: row.dedupeKey, recipient: { id: recipient.id, version: recipient.version, userId: recipient.userId } },
      submission,
      registration,
      target: { id: recipient.userId, role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword },
      templateId: input.templateId,
      templateVersion: runtime.templateVersion,
    });
    if (!resolved.ok) return null;
    const [existing] = await tx.$queryRaw<{ id: string; recipientId: string; recipientVersion: string; templateId: string; templateVersion: string; submittedAt: Date }[]>`
      SELECT "id", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt" FROM "NotificationDispatch" WHERE "outboxId" = ${row.id} FOR UPDATE`;
    if (existing) {
      // Reuse path (real-only): a stale template or a replaced recipient voids
      // the stored dispatch instead of sending to the old recipient.
      if (existing.templateId !== input.templateId || existing.templateVersion !== runtime.templateVersion
        || existing.recipientId !== recipient.id || existing.recipientVersion !== recipient.version) return null;
      const stored = realDispatchContextSchema.safeParse({ event: "application.received", audience: "admin", dedupeKey: row.dedupeKey, recipientId: existing.recipientId, recipientVersion: existing.recipientVersion, submittedAt: existing.submittedAt, templateId: existing.templateId, templateVersion: existing.templateVersion, variables: { 접수시각: formatSubmittedAt(existing.submittedAt) } });
      if (!stored.success || JSON.stringify(stored.data) !== JSON.stringify(resolved.context)) return null;
      return { dispatchId: existing.id, context: stored.data, config: REAL_CONFIG, policy: REAL_POLICY, quote: REAL_QUOTE, recipientKey: input.recipientKey };
    }
    const id = randomUUID();
    const clientKey = `${runtime.namespace}:${row.dedupeKey}`;
    await tx.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "slotCount", "auditSequence", "reconciliationState", "policyVersion") VALUES (${id}, ${row.id}, 'preview', ${clientKey}, 'solapi', ${recipient.id}, ${recipient.version}, ${resolved.context.templateId}, ${resolved.context.templateVersion}, ${submission.submittedAt}, 0, 0, 'ready', ${runtime.policyVersion})`;
    return { dispatchId: id, context: resolved.context, config: REAL_CONFIG, policy: REAL_POLICY, quote: REAL_QUOTE, recipientKey: input.recipientKey };
  });
}
