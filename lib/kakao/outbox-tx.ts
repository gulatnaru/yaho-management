import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { buildDedupeKey } from "@/lib/kakao/notify";

/**
 * 2B emit is an ephemeral dry-run observation: LogNotificationProvider always
 * returns skipped and never sends. This same-transaction row is a durable
 * pending record; a future dispatcher is the ONLY sender. Both paths use the
 * same buildDedupeKey(kind, submissionId, "created") to correlate observation
 * and record. The row alone sends nothing and the emit alone sends nothing,
 * so keeping both creates no duplicate-send path.
 *
 * The existing PrismaOutboxStore requires a notificationOutbox model delegate,
 * absent from the current generated client. Raw queries match the transaction's
 * existing lock helpers. After migration + prisma generate, this helper may use
 * tx.notificationOutbox.create; the adapter remains for dispatch-side use.
 */
export interface OutboxTransaction {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/** The caller holds the group lock; every SQL failure must abort its transaction. */
export async function insertApplicationReceivedOutbox(
  tx: OutboxTransaction,
  input: { submissionId: string; now: Date },
): Promise<{ inserted: boolean }> {
  const dedupeKey = buildDedupeKey("application.received", input.submissionId, "created");
  const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "NotificationOutbox" WHERE "dedupeKey" = ${dedupeKey}
  `);
  if (existing.length > 0) return { inserted: false };

  // cuid() is a generated-client default, not a DB default. The pre-generate
  // raw INSERT therefore supplies a UUID independently of that model delegate.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "NotificationOutbox" (
      "id", "eventKind", "entityId", "dedupeKey", "audience", "occurredAt",
      "status", "attemptCount", "lastErrorCode", "providerId", "providerRef",
      "nextRetryAt", "claimToken", "leaseExpiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${"application.received"}, ${input.submissionId}, ${dedupeKey}, ${"admin"}, ${input.now},
      ${"pending"}::"NotificationOutboxStatus", ${0}, ${null}, ${null}, ${null},
      ${null}, ${null}, ${null}, ${input.now}, ${input.now}
    )
  `);
  return { inserted: true };
}
