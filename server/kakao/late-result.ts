import "server-only";
import { randomUUID } from "node:crypto";
import { dispatchPermitSchema, providerResultSchema } from "@/lib/kakao/send-contract";
import { PrismaDispatchRepository, type DispatchRepository } from "@/server/kakao/dispatch-repository";

/** A verified late result updates only the same slot and its audit. */
export async function recordLateResult(repository: DispatchRepository | PrismaDispatchRepository, permitValue: unknown, resultValue: unknown, at: Date): Promise<void> {
  const permit = dispatchPermitSchema.parse(permitValue); const result = providerResultSchema.parse(resultValue);
  if (result.status === "unknown" || !(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error("Late result unavailable.");
  const slotStatus = result.status === "accepted" ? "accepted" : "rejected";
  const dispatchStatus = result.status === "accepted" ? "awaiting_final" : "rejected";
  const ref = result.status === "accepted" ? result.ref : null;
  if (repository instanceof PrismaDispatchRepository) {
    await repository.transaction(async (tx) => {
      const [runtime] = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const [link] = await tx.$queryRaw<{ outboxId: string }[]>`SELECT "outboxId" FROM "NotificationDispatch" WHERE "id" = ${permit.dispatchId}`;
      if (!runtime || !link) throw new Error("Late result unavailable.");
      const [outbox] = await tx.$queryRaw<{ status: string; dedupeKey: string }[]>`SELECT "status", "dedupeKey" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
      const [dispatch] = await tx.$queryRaw<{ auditSequence: number; reconciliationState: string; recipientId: string; recipientVersion: string; templateId: string; templateVersion: string; submittedAt: Date; purgedAt: Date | null }[]>`SELECT "auditSequence", "reconciliationState", "recipientId", "recipientVersion", "templateId", "templateVersion", "submittedAt", "purgedAt" FROM "NotificationDispatch" WHERE "id" = ${permit.dispatchId} AND "outboxId" = ${link.outboxId} FOR UPDATE`;
      const [slot] = await tx.$queryRaw<{ status: string; detailPurgedAt: Date | null }[]>`SELECT "status", "detailPurgedAt" FROM "NotificationCostReservation" WHERE "id" = ${permit.slotId} AND "dispatchId" = ${permit.dispatchId} AND "entryKind" = 'SEND_SLOT' FOR UPDATE`;
      if (!outbox || !["failed", "sent"].includes(outbox.status) || outbox.dedupeKey !== permit.context.dedupeKey || !dispatch || dispatch.purgedAt || dispatch.recipientId !== permit.context.recipientId || dispatch.recipientVersion !== permit.context.recipientVersion || dispatch.templateId !== permit.context.templateId || dispatch.templateVersion !== permit.context.templateVersion || dispatch.submittedAt.getTime() !== permit.context.submittedAt.getTime() || !slot || slot.status !== "unknown" || slot.detailPurgedAt) throw new Error("Late result unavailable.");
      const changedSlot = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = ${slotStatus}, "providerRef" = ${ref}, "resultAt" = ${at} WHERE "id" = ${permit.slotId} AND "status" = 'unknown'`;
      const changedDispatch = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "reconciliationState" = CASE WHEN "reconciliationState" = 'closed_unconfirmed' THEN 'closed_unconfirmed' ELSE ${dispatchStatus} END, "auditSequence" = "auditSequence" + 1 WHERE "id" = ${permit.dispatchId} AND "auditSequence" = ${dispatch.auditSequence}`;
      if (changedSlot !== 1 || changedDispatch !== 1) throw new Error("Late result changed.");
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "sequence", "providerRef", "occurredAt") VALUES (${id}, ${id}, 'preview', 'result_recorded', ${link.outboxId}, ${permit.dispatchId}, ${permit.slotId}, ${dispatch.auditSequence + 1}, ${ref}, ${at})`;
    });
    return;
  }
  await repository.transaction(async (state) => {
    const dispatch = state.dispatches.find((d) => d.id === permit.dispatchId);
    const outbox = dispatch && state.outboxes.find((o) => o.id === dispatch.outboxId);
    const slot = state.slots.find((s) => s.id === permit.slotId && s.dispatchId === permit.dispatchId);
    if (!dispatch || !outbox || !["failed", "sent"].includes(outbox.status) || outbox.dedupeKey !== permit.context.dedupeKey || JSON.stringify(dispatch.context) !== JSON.stringify(permit.context) || dispatch.detailPurgedAt || !slot || slot.status !== "unknown" || slot.detailPurgedAt) throw new Error("Late result unavailable.");
    slot.status = slotStatus; slot.providerRef = ref;
    if (dispatch.state !== "closed_unconfirmed") dispatch.state = slotStatus;
    dispatch.auditSequence++;
    state.audits.push({ eventId: randomUUID(), dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "result_recorded", occurredAt: at });
  });
}
