import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { providerRefSchema } from "@/lib/kakao/send-contract";
import { MockLookupProvider, type MockLookupResult } from "@/lib/kakao/providers/mock-lookup";
import { markSyntheticLookupUnknown, reserveSyntheticLookup } from "@/server/kakao/budget";
import { PrismaDispatchRepository, type DispatchRepository } from "@/server/kakao/dispatch-repository";

const commandSchema = z.object({ commandId: z.string().min(1).max(128), slotId: z.string().min(1).max(128), now: z.date() }).passthrough();

/** Reserve the mock lookup before invoking it; never invokes a send. */
export async function pollDeliveryResult(repository: DispatchRepository | PrismaDispatchRepository, commandValue: unknown, provider: MockLookupProvider): Promise<"blocked" | "unknown" | "recorded"> {
  const command = commandSchema.parse(commandValue);
  if (!(provider instanceof MockLookupProvider)) return "blocked";
  const reservation = await reserveSyntheticLookup(repository, commandValue);
  if (!reservation) return "blocked";
  let ref: string | null = null;
  try {
    if (repository instanceof PrismaDispatchRepository) {
      ref = await repository.transaction(async (tx) => {
        const [slot] = await tx.$queryRaw<{ providerRef: string | null }[]>`SELECT c."providerRef" FROM "NotificationCostReservation" c JOIN "NotificationCostReservation" l ON l."sourceSlotId" = c."id" AND l."entryKind" = 'LOOKUP_COST' WHERE l."id" = ${reservation.id} AND l."status" = 'in_flight' AND c."id" = ${command.slotId}`;
        return providerRefSchema.safeParse(slot?.providerRef).success ? slot!.providerRef : null;
      });
    } else {
      ref = await repository.transaction(async (state) => {
        const lookup = state.lookups.find((item) => item.id === reservation.id && item.slotId === command.slotId && item.status === "in_flight");
        const slot = lookup && state.slots.find((item) => item.id === command.slotId);
        return providerRefSchema.safeParse(slot?.providerRef).success ? slot!.providerRef! : null;
      });
    }
    if (!ref) { await markSyntheticLookupUnknown(repository, reservation.id, command.now); return "unknown"; }
    const result = await MockLookupProvider.prototype.lookup.call(provider, { lookupId: reservation.id, slotId: command.slotId, ref });
    if (!result || result.ref !== ref || result.status === "unknown") { await markSyntheticLookupUnknown(repository, reservation.id, command.now); return "unknown"; }
    await recordFinalLookup(repository, reservation.id, command.slotId, result, command.now);
    return "recorded";
  } catch {
    try { await markSyntheticLookupUnknown(repository, reservation.id, command.now); } catch { /* Retain the committed lookup reservation for recovery. */ }
    return "unknown";
  }
}

async function recordFinalLookup(repository: DispatchRepository | PrismaDispatchRepository, lookupId: string, slotId: string, result: MockLookupResult, at: Date): Promise<void> {
  if (result.status === "unknown" || !providerRefSchema.safeParse(result.ref).success) throw new Error("Lookup result unavailable.");
  if (repository instanceof PrismaDispatchRepository) {
    await repository.transaction(async (tx) => {
      const [runtime] = await tx.$queryRaw<{ environment: string }[]>`SELECT "environment" FROM "NotificationRuntimeConfig" WHERE "environment" = 'preview' FOR UPDATE`;
      const [link] = await tx.$queryRaw<{ dispatchId: string; outboxId: string }[]>`SELECT d."id" AS "dispatchId", d."outboxId" FROM "NotificationCostReservation" s JOIN "NotificationDispatch" d ON d."id" = s."dispatchId" WHERE s."id" = ${slotId} AND s."entryKind" = 'SEND_SLOT'`;
      if (!runtime || !link) throw new Error("Lookup unavailable.");
      const [outbox] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "NotificationOutbox" WHERE "id" = ${link.outboxId} FOR UPDATE`;
      const [dispatch] = await tx.$queryRaw<{ auditSequence: number; finalStatus: string | null }[]>`SELECT "auditSequence", "finalStatus" FROM "NotificationDispatch" WHERE "id" = ${link.dispatchId} FOR UPDATE`;
      const [slot] = await tx.$queryRaw<{ status: string; providerRef: string | null; detailPurgedAt: Date | null }[]>`SELECT "status", "providerRef", "detailPurgedAt" FROM "NotificationCostReservation" WHERE "id" = ${slotId} AND "dispatchId" = ${link.dispatchId} FOR UPDATE`;
      const [lookup] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "NotificationCostReservation" WHERE "id" = ${lookupId} AND "sourceSlotId" = ${slotId} AND "entryKind" = 'LOOKUP_COST' FOR UPDATE`;
      if (!outbox || !["sent", "failed"].includes(outbox.status) || !dispatch || dispatch.finalStatus && dispatch.finalStatus !== "unknown" || !slot || slot.detailPurgedAt || slot.providerRef !== result.ref || !["accepted", "unknown"].includes(slot.status) || !lookup || lookup.status !== "in_flight") throw new Error("Lookup evidence unavailable.");
      const updated = await tx.$executeRaw`UPDATE "NotificationDispatch" SET "finalStatus" = ${result.status}, "auditSequence" = "auditSequence" + 1 WHERE "id" = ${link.dispatchId} AND "auditSequence" = ${dispatch.auditSequence}`;
      const cost = await tx.$executeRaw`UPDATE "NotificationCostReservation" SET "status" = 'unknown', "costState" = 'reserved_unknown', "resultAt" = ${at} WHERE "id" = ${lookupId} AND "status" = 'in_flight'`;
      if (updated !== 1 || cost !== 1) throw new Error("Lookup result changed.");
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO "NotificationAudit" ("id", "eventId", "environment", "eventType", "outboxId", "dispatchId", "slotId", "costOperationId", "sequence", "toState", "occurredAt") VALUES (${id}, ${id}, 'preview', 'result_recorded', ${link.outboxId}, ${link.dispatchId}, ${slotId}, ${lookupId}, ${dispatch.auditSequence + 1}, ${result.status}, ${at})`;
    });
    return;
  }
  await repository.transaction(async (state) => {
    const lookup = state.lookups.find((item) => item.id === lookupId && item.slotId === slotId && item.status === "in_flight");
    const slot = lookup && state.slots.find((item) => item.id === slotId);
    const dispatch = slot && state.dispatches.find((item) => item.id === slot.dispatchId);
    const outbox = dispatch && state.outboxes.find((item) => item.id === dispatch.outboxId);
    if (!lookup || !slot || !dispatch || !outbox || !["sent", "failed"].includes(outbox.status) || slot.detailPurgedAt || slot.providerRef !== result.ref || !["accepted", "unknown"].includes(slot.status) || dispatch.finalStatus && dispatch.finalStatus !== "unknown") throw new Error("Lookup evidence unavailable.");
    lookup.status = "unknown"; dispatch.finalStatus = result.status; dispatch.auditSequence++;
    state.audits.push({ eventId: randomUUID(), dispatchId: dispatch.id, slotId: slot.id, sequence: dispatch.auditSequence, eventType: "result_recorded", toState: result.status, occurredAt: at });
  });
}
