import type { PrismaClient } from "@prisma/client";
import { type Scope } from "@/lib/ai-consultations/contracts";
import { assertOwnedLease, transaction } from "./ledger";
/** Own-run synthetic purge only. Anonymous day/category metrics deliberately remain intact. */
export async function purgeExpired(
  client: PrismaClient,
  scope: Scope,
  now: Date,
  clock: () => Date = () => new Date(),
): Promise<{
  deleted: number;
  status: "SUCCEEDED" | "FAILED";
}> {
  try {
    const deleted = await transaction(client, scope.runId, 350, async (tx) => {
      await assertOwnedLease(tx, scope, clock());
      const state = await tx.aiRetentionJob.upsert({
        where: { runId: scope.runId },
        create: { runId: scope.runId, status: "RUNNING", attempts: 1 },
        update: { status: "RUNNING", attempts: { increment: 1 } },
      });
      const rows = await tx.aiConsultation.findMany({
        where: {
          runId: scope.runId,
          origin: "SYNTHETIC",
          expiresAt: { lte: now },
        },
        select: { id: true },
        take: 100,
        orderBy: { id: "asc" },
      });
      const result = await tx.aiConsultation.deleteMany({
        where: {
          runId: scope.runId,
          origin: "SYNTHETIC",
          id: { in: rows.map((x) => x.id) },
          expiresAt: { lte: now },
        },
      });
      const quotas = await tx.aiQuotaBucket.findMany({
        where: { runId: scope.runId, expiresAt: { lte: now } },
        select: { id: true },
        take: 100,
        orderBy: { id: "asc" },
      });
      await tx.aiQuotaBucket.deleteMany({
        where: {
          runId: scope.runId,
          id: { in: quotas.map((x) => x.id) },
          expiresAt: { lte: now },
        },
      });
      await tx.aiRetentionJob.update({
        where: { id: state.id },
        data: {
          status: "SUCCEEDED",
          deletedCount: { increment: result.count },
          lastSuccessAt: clock(),
          nextRetryAt: null,
          errorCode: null,
        },
      });
      return result.count;
    });
    return { deleted, status: "SUCCEEDED" };
  } catch {
    try {
      await transaction(client, scope.runId, 150, async (tx) => {
        await assertOwnedLease(tx, scope, clock());
        await tx.aiRetentionJob.upsert({
          where: { runId: scope.runId },
          create: {
            runId: scope.runId,
            status: "FAILED",
            attempts: 1,
            errorCode: "PURGE_FAILED",
            nextRetryAt: new Date(clock().getTime() + 60000),
          },
          update: {
            status: "FAILED",
            errorCode: "PURGE_FAILED",
            attempts: { increment: 1 },
            nextRetryAt: new Date(clock().getTime() + 60000),
          },
        });
      });
    } catch {
      /* Fixed status only. No raw database diagnostic or consultation is logged. */
    }
    return { deleted: 0, status: "FAILED" };
  }
}
/** Injectable scheduler for synthetic fake-clock tests; no background deployment activation. */
export async function runRetentionCycle(
  client: PrismaClient,
  scope: Scope,
  clock: () => Date,
) {
  const now = clock();
  const job = await client.aiRetentionJob.findUnique({
    where: { runId: scope.runId },
    select: { nextRetryAt: true },
  });
  if (job?.nextRetryAt && job.nextRetryAt > now)
    return { deleted: 0, status: "WAITING" as const };
  return purgeExpired(client, scope, now, clock);
}
