import { timingSafeEqual } from "node:crypto";
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
            // Deleting an expired UNKNOWN row likewise leaves its unknownCount increment and
            // unreleased reservedKrw in the budget month, so claim stays blocked until
            // reconcileMonth resolveAllHeld clears them — purge is not recovery.
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

/** Delete audit rows older than the 1-year retention window, 100 rows per batch. The guard trigger refuses DELETE inside the window, so this function uses the same 365-day boundary. */
export async function purgeOldAudits(db: Database, environment: Environment, now: Date) {
    const cutoff = new Date(now.getTime() - 365 * 24 * 3600000);
    let auditDeleted = 0;
    for (;;) {
        const deleted = await transaction(db, environment, async (tx) => {
            const batch = await tx.aiServiceDeletionAudit.findMany({ where: { environment, createdAt: { lte: cutoff } }, select: { id: true }, take: 100 });
            if (batch.length === 0)
                return 0;
            const result = await tx.aiServiceDeletionAudit.deleteMany({ where: { environment, id: { in: batch.map((r) => r.id) }, createdAt: { lte: cutoff } } });
            return result.count;
        });
        auditDeleted += deleted;
        if (deleted === 0)
            break;
    }
    return { auditDeleted };
}

export type RetentionCronResult =
    | { status: 200; body: { deleted: number; auditDeleted: number; waiting: boolean; expiredRemaining: number } }
    | { status: 401 | 503; body: { error: string } };

const RETENTION_CRON_NOT_ACTIVE: RetentionCronResult = { status: 503, body: { error: "AI_RETENTION_NOT_ACTIVE" } };

/**
 * Cron entry for the daily auto-delete run (D-1: Vercel Cron sends GET only).
 * Order: (1) CRON_SECRET auth, (2) environment from VERCEL_ENV,
 * (3) schedulerEnabled flag gate, (4) purge loop, (5) audit purge,
 * (6) bounded counts-only response. Any failure returns the fixed 503 body
 * with no deletion detail, no PII, and no row IDs. The scheduler is never
 * enabled here: the flag stays false until a separate operations approval.
 */
export async function runRetentionCron(
    db: Database,
    authorization: string | null,
    vercelEnv: string | undefined,
    cronSecret: string | undefined,
    now: Date,
): Promise<RetentionCronResult> {
    const expected = cronSecret ? `Bearer ${cronSecret}` : "";
    const supplied = authorization ?? "";
    if (!expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
        return { status: 401, body: { error: "AI_RETENTION_UNAUTHORIZED" } };
    try {
        const environment = vercelEnv === "preview" ? "PREVIEW" : vercelEnv === "production" ? "PRODUCTION" : null;
        if (!environment)
            return RETENTION_CRON_NOT_ACTIVE;
        const config = await transaction(db, environment, (tx) => tx.aiServiceConfig.findUnique({ where: { environment } }));
        if (!config?.schedulerEnabled)
            return RETENTION_CRON_NOT_ACTIVE;
        const started = Date.now();
        let deleted = 0;
        let waiting = false;
        for (let i = 0; i < 10; i++) {
            const result = await purgeExpired(db, environment, now);
            deleted += result.deleted;
            waiting = result.waiting;
            if (result.deleted === 0 || result.waiting)
                break;
            if (Date.now() - started >= 8000)
                break;
        }
        const { auditDeleted } = await purgeOldAudits(db, environment, now);
        const expiredRemaining = await transaction(db, environment, (tx) =>
            tx.aiServiceRequest.count({ where: { environment, expiresAt: { lte: now } } }));
        return { status: 200, body: { deleted, auditDeleted, waiting, expiredRemaining } };
    } catch {
        return RETENTION_CRON_NOT_ACTIVE;
    }
}
