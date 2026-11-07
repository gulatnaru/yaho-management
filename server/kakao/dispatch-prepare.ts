import "server-only";
import { randomUUID } from "node:crypto";
import { type OutboxRow } from "@/lib/kakao/outbox";
import { resolveDispatchContext } from "@/server/kakao/context-resolver";
import { dispatchContextSchema } from "@/lib/kakao/send-contract";
import { formatSubmittedAt } from "@/lib/kakao/template";
import { PrismaDispatchRepository, type DispatchRepository } from "@/server/kakao/dispatch-repository";

/** Synthetic source only. The caller supplies the minimal submission fixture. */
export async function prepareSyntheticDispatch(repository: DispatchRepository, input: { rowId: string; claimToken: string; submission: unknown }) {
  return repository.transaction(async (state) => {
    const row = state.outboxes.find((item) => item.id === input.rowId) as OutboxRow | undefined;
    if (!row || row.status !== "processing" || row.claimToken !== input.claimToken || !state.runtime) return null;
    const existing = state.dispatches.find((item) => item.outboxId === row.id);
    if (existing) {
      const recipient = state.recipients.find((r) => r.id === existing.context.recipientId && r.version === existing.context.recipientVersion);
      const target = recipient && state.users?.find((user) => user.id === recipient.userId);
      if (!recipient) return null;
      const resolved = resolveDispatchContext({ request: { event: row.eventKind, audience: row.audience, entityId: row.entityId, dedupeKey: row.dedupeKey, recipient: { id: recipient.id, version: recipient.version, userId: recipient.userId } }, submission: input.submission, registration: recipient.registration, target });
      if (!resolved.ok || JSON.stringify(resolved.context) !== JSON.stringify(existing.context)) return null;
      return { dispatchId: existing.id, context: existing.context };
    }
    const candidates = state.recipients.filter((recipient) => {
      const registration = recipient.registration as { state?: unknown } | null;
      return registration?.state === "active";
    });
    if (candidates.length !== 1) return null;
    const recipient = candidates[0];
    const target = state.users?.find((user) => user.id === recipient.userId);
    const resolved = resolveDispatchContext({ request: { event: row.eventKind, audience: row.audience, entityId: row.entityId, dedupeKey: row.dedupeKey, recipient: { id: recipient.id, version: recipient.version, userId: recipient.userId } }, submission: input.submission, registration: recipient.registration, target });
    if (!resolved.ok) return null;
    const dispatchId = randomUUID();
    state.dispatches.push({ id: dispatchId, outboxId: row.id, clientKey: `${state.runtime.namespace}:${row.dedupeKey}`, context: resolved.context, slotCount: 0, auditSequence: 0, state: "ready", unknownSince: null });
    return { dispatchId, context: resolved.context };
  });
}

/** Reads only the minimal submission fields; the guard rechecks recipient and gate before issuance. */
export async function preparePrismaDispatch(repository: PrismaDispatchRepository, input: { rowId: string; claimToken: string }) {
  return repository.transaction(async (tx) => {
    const [runtime] = await tx.$queryRaw<{ namespace: string; policyVersion: string | null }[]>`SELECT "namespace", "policyVersion" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
    const [row] = await tx.$queryRaw<{ id: string; eventKind: string; audience: string; entityId: string; dedupeKey: string }[]>`SELECT "id", "eventKind", "audience", "entityId", "dedupeKey" FROM "NotificationOutbox" WHERE "id" = ${input.rowId} AND "status" = 'processing' AND "claimToken" = ${input.claimToken} FOR UPDATE`;
    if (!runtime || !runtime.policyVersion || !row || row.eventKind !== "application.received" || row.audience !== "admin") return null;
    const [existing] = await tx.$queryRaw<{ id: string; recipientId: string; recipientVersion: string; templateId: string; templateVersion: string; submittedAt: Date }[]>`SELECT "id", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt" FROM "NotificationDispatch" WHERE "outboxId" = ${row.id} FOR UPDATE`;
    if (existing) {
      const parsed = dispatchContextSchema.safeParse({ event: "application.received", audience: "admin", dedupeKey: row.dedupeKey, recipientId: existing.recipientId, recipientVersion: existing.recipientVersion, submittedAt: existing.submittedAt, templateId: existing.templateId, templateVersion: existing.templateVersion, variables: { 접수시각: formatSubmittedAt(existing.submittedAt) } });
      return parsed.success ? { dispatchId: existing.id, context: parsed.data } : null;
    }
    const [submission] = await tx.$queryRaw<{ id: string; submittedAt: Date; personalDataPurgedAt: Date | null }[]>`SELECT "id", "submittedAt", "personalDataPurgedAt" FROM "ReservationApplicationSubmission" WHERE "id" = ${row.entityId} FOR SHARE`;
    if (!submission || submission.personalDataPurgedAt !== null) return null;
    const candidates = await tx.$queryRaw<{ id: string; version: string; userId: string }[]>`SELECT "id", "version", "userId" FROM "NotificationRecipientRegistration" WHERE "environment" = 'preview' AND "service" = 'application.received' AND "state" = 'active'`;
    if (candidates.length !== 1) return null;
    const recipient = candidates[0];
    const [user] = await tx.$queryRaw<{ role: string; isActive: boolean; mustChangePassword: boolean }[]>`SELECT "role", "isActive", "mustChangePassword" FROM "User" WHERE "id" = ${recipient.userId} FOR UPDATE`;
    const [lockedRecipient] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "NotificationRecipientRegistration" WHERE "id" = ${recipient.id} AND "version" = ${recipient.version} AND "userId" = ${recipient.userId} AND "state" = 'active' FOR UPDATE`;
    if (!user || user.role !== "ADMIN" || !user.isActive || user.mustChangePassword || !lockedRecipient) return null;
    const context = dispatchContextSchema.safeParse({ event: "application.received", audience: "admin", dedupeKey: row.dedupeKey, recipientId: recipient.id, recipientVersion: recipient.version, submittedAt: submission.submittedAt, templateId: "mock_application_received_v1", templateVersion: "g2-v1", variables: { 접수시각: formatSubmittedAt(submission.submittedAt) } });
    if (!context.success) return null;
    const id = randomUUID(); const clientKey = `${runtime.namespace}:${row.dedupeKey}`;
    await tx.$executeRaw`INSERT INTO "NotificationDispatch" ("id", "outboxId", "environment", "clientKey", "providerId", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "slotCount", "auditSequence", "reconciliationState", "policyVersion") VALUES (${id}, ${row.id}, 'preview', ${clientKey}, 'solapi', ${recipient.id}, ${recipient.version}, ${context.data.templateId}, ${context.data.templateVersion}, ${submission.submittedAt}, 0, 0, 'ready', ${runtime.policyVersion})`;
    return { dispatchId: id, context: context.data };
  });
}
