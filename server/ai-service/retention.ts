import { transaction, type Database } from "./repository";
import { recoverInTransaction } from "./ledger";
import { type Environment, ServiceDenied, assertAdmin, type Actor } from "./contracts";
export const RETENTION_CADENCE = "DAILY";
export async function purgeExpired(db: Database, environment: Environment, now: Date, retry = false) {
    try {
        return await transaction(db, environment, async (tx) => {
            const job = await tx.aiServiceRetentionJob.upsert({ where: { environment }, create: { environment }, update: {} });
            if (job.status === "FAILED" && job.attempts >= 3 && !retry)
                throw new ServiceDenied();
            if (job.nextRetryAt && job.nextRetryAt > now && !retry)
                return { deleted: 0, waiting: true };
            await recoverInTransaction(tx, environment, now);
            const expired = await tx.aiServiceRequest.findMany({ where: { environment, expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 100 });
            // All privacy-bearing request rows disappear. Monetary holds stay in monthly aggregate.
            const result = await tx.aiServiceRequest.deleteMany({ where: { environment, id: { in: expired.map(r => r.id) }, expiresAt: { lte: now } } });
            await tx.aiServiceQuotaBucket.deleteMany({ where: { environment, expiresAt: { lte: now } } });
            await tx.aiServiceRetentionJob.update({ where: { environment }, data: { status: "IDLE", attempts: 0,
                    deletedCount: { increment: result.count }, lastSuccessAt: now, nextRetryAt: null, errorCode: null } });
            return { deleted: result.count, waiting: false };
        });
    }
    catch {
        await transaction(db, environment, async (tx) => {
            const job = await tx.aiServiceRetentionJob.upsert({ where: { environment }, create: { environment }, update: {} });
            const attempts = Math.min(job.attempts + 1, 3);
            await tx.aiServiceRetentionJob.update({ where: { environment }, data: { status: "FAILED", attempts,
                    nextRetryAt: attempts < 3 ? new Date(now.getTime() + attempts * 3600000) : null, errorCode: "RETENTION_FAILED" } });
        }).catch(() => undefined);
        throw new ServiceDenied();
    }
}
export async function retryRetention(db: Database, environment: Environment, actor: Actor, now: Date) {
    assertAdmin(actor);
    return purgeExpired(db, environment, now, true);
}
