import { programDigest, classDigest } from "./publication-digest";
import { z } from "zod";
import { assertAdmin, parse, configSchema, publicationSchema, guidanceSchema, ServiceDenied, type Actor, type Environment } from "./contracts";
import { transaction, type Database, type Tx } from "./repository";
import { safePublicText } from "./tools";
import { decrypt, hashes, type Keys } from "./crypto";
import { RETENTION_CADENCE } from "./retention";
export async function saveConfig(db: Database, environment: Environment, actor: Actor, value: unknown, now: Date) {
    assertAdmin(actor);
    const input = parse(configSchema, value);
    if (input.fxCheckedAt > now || now.getTime() - input.fxCheckedAt.getTime() > 72 * 3600000)
        throw new ServiceDenied();
    return transaction(db, environment, async (tx) => {
        const old = await tx.aiServiceConfig.findUnique({ where: { environment } });
        if ((old?.version ?? 0) !== input.expectedVersion)
            throw new ServiceDenied();
        const { expectedVersion: _, ...data } = input;
        void _;
        return tx.aiServiceConfig.upsert({ where: { environment }, create: { environment, ...data, updatedById: actor.userId },
            update: { ...data, version: { increment: 1 }, updatedById: actor.userId } });
    });
}
export async function savePublication(db: Database, environment: Environment, actor: Actor, value: unknown) {
    assertAdmin(actor);
    const input = parse(publicationSchema, value);
    return transaction(db, environment, async (tx) => {
        if (input.kind === "PROGRAM") {
            await tx.$queryRaw `SELECT id FROM "Program" WHERE id = ${input.id} FOR SHARE`;
            const source = await tx.program.findUnique({ where: { id: input.id }, select: { id: true, name: true, description: true, status: true, updatedAt: true } });
            if (!source)
                throw new ServiceDenied();
            const where = { environment_programId: { environment, programId: input.id } };
            const old = await tx.aiServiceProgramPublication.findUnique({ where });
            if ((old?.version ?? 0) !== input.expectedVersion)
                throw new ServiceDenied();
            if (input.enabled) {
                safePublicText(source.name, 120);
                if (source.description)
                    safePublicText(source.description, 400);
            }
            const approval = { enabled: input.enabled, sourceUpdatedAt: source.updatedAt, sourceDigest: programDigest(source), updatedById: actor.userId };
            return tx.aiServiceProgramPublication.upsert({ where, create: { environment, programId: input.id, ...approval },
                update: { ...approval, version: { increment: 1 } } });
        }
        await tx.$queryRaw `SELECT id FROM "ClassSchedule" WHERE id = ${input.id} FOR SHARE`;
        const source = await tx.classSchedule.findUnique({ where: { id: input.id }, select: { id: true, programId: true, startsAt: true, endsAt: true, location: true, status: true, updatedAt: true } });
        if (!source)
            throw new ServiceDenied();
        const where = { environment_classScheduleId: { environment, classScheduleId: input.id } };
        const old = await tx.aiServiceClassPublication.findUnique({ where });
        if ((old?.version ?? 0) !== input.expectedVersion)
            throw new ServiceDenied();
        if (input.enabled)
            safePublicText(source.location, 120, "LOCATION");
        const approval = { enabled: input.enabled, sourceUpdatedAt: source.updatedAt, sourceDigest: classDigest(source), updatedById: actor.userId };
        return tx.aiServiceClassPublication.upsert({ where, create: { environment, classScheduleId: input.id, ...approval },
            update: { ...approval, version: { increment: 1 } } });
    });
}
type GuidanceInput = z.infer<typeof guidanceSchema>;
/**
 * Inner guidance write (D-12): optimistic version check + upsert only.
 * Runs inside the caller's transaction and never calls transaction() itself,
 * so it can be reused by saveApprovedGuidance without a nested $transaction
 * (a Prisma TransactionClient has no $transaction method at runtime).
 */
export async function saveGuidanceInTransaction(tx: Tx, environment: Environment, actor: Actor, input: GuidanceInput) {
    const where = { environment_topic: { environment, topic: input.topic } };
    const old = await tx.aiServiceKnowledgeEntry.findUnique({ where });
    if ((old?.version ?? 0) !== input.expectedVersion)
        throw new ServiceDenied();
    return tx.aiServiceKnowledgeEntry.upsert({ where, create: { environment, topic: input.topic, content: input.content, approved: input.approved, updatedById: actor.userId },
        update: { content: input.content, approved: input.approved, version: { increment: 1 }, updatedById: actor.userId } });
}
export async function saveGuidance(db: Database, environment: Environment, actor: Actor, value: unknown) {
    assertAdmin(actor);
    const input = parse(guidanceSchema, value);
    safePublicText(input.content);
    return transaction(db, environment, (tx) => saveGuidanceInTransaction(tx, environment, actor, input));
}
export async function readState(db: Database, environment: Environment, actor: Actor, now: Date) {
    assertAdmin(actor);
    return transaction(db, environment, async (tx) => {
        const groups = await tx.aiServiceRequest.groupBy({
            by: ["status", "dispatched"],
            where: { environment, expiresAt: { gt: now } },
            _count: { _all: true },
        });
        const summary = groups.reduce((counts, group) => ({
            totalRequests: counts.totalRequests + group._count._all,
            dispatchAttempts: counts.dispatchAttempts + (group.dispatched ? group._count._all : 0),
            failedRequests: counts.failedRequests + (group.status === "FAILED" ? group._count._all : 0),
            unknownRequests: counts.unknownRequests + (group.status === "UNKNOWN" ? group._count._all : 0),
        }), { totalRequests: 0, dispatchAttempts: 0, failedRequests: 0, unknownRequests: 0 });
        const retention = await tx.aiServiceRetentionJob.findUnique({ where: { environment } });
        const config = await tx.aiServiceConfig.findUnique({ where: { environment } });
        const oldestAudit = await tx.aiServiceDeletionAudit.findFirst({ where: { environment }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
        return {
            summary: { ...summary, asOf: now },
            monitoring: {
                retentionCadence: RETENTION_CADENCE,
                schedulerActive: config?.schedulerEnabled ?? false,
                retentionAttempts: retention?.attempts ?? 0,
                lastRetentionSuccessAt: retention?.lastSuccessAt ?? null,
                nextRetentionRetryAt: retention?.nextRetryAt ?? null,
                retentionErrorCode: retention?.errorCode === "RETENTION_FAILED" ? "RETENTION_FAILED" : null,
                auditCount: await tx.aiServiceDeletionAudit.count({ where: { environment } }),
                auditOldestCreatedAt: oldestAudit?.createdAt ?? null,
            },
            config,
            programs: await tx.aiServiceProgramPublication.findMany({ where: { environment }, take: 50 }),
            classes: await tx.aiServiceClassPublication.findMany({ where: { environment }, take: 50 }),
            knowledge: await tx.aiServiceKnowledgeEntry.findMany({ where: { environment }, take: 3 }),
            budgets: await tx.aiServiceBudgetMonth.findMany({ where: { environment }, orderBy: { month: "desc" }, take: 12 }),
            consultations: await tx.aiServiceRequest.findMany({ where: { environment, expiresAt: { gt: now } },
                select: { id: true, status: true, createdAt: true, expiresAt: true, category: true }, orderBy: { createdAt: "desc" }, take: 50 }),
            retention,
            expiredCount: await tx.aiServiceRequest.count({ where: { environment, expiresAt: { lte: now } } }),
        };
    });
}
export async function readConsultation(db: Database, environment: Environment, actor: Actor, keys: Keys, id: unknown, clock: () => Date = () => new Date()) {
    assertAdmin(actor);
    const requestId = parse(z.string().uuid(), id);
    const row = await transaction(db, environment, tx => tx.aiServiceRequest.findFirst({ where: { id: requestId, environment, expiresAt: { gt: clock() } } }));
    if (!row?.rawCiphertext)
        throw new ServiceDenied();
    const value = decrypt(keys, { id: row.id, environment, createdAt: row.createdAt, expiresAt: row.expiresAt }, row.rawCiphertext, clock);
    if (row.expiresAt <= clock())
        throw new ServiceDenied();
    // R6 read audit (OQ-P0-10 (b)): record the original-text read in a separate
    // transaction. If the audit write fails the read is refused (fail-closed):
    // no original text is ever returned without an audit row. Failed, expired,
    // or nonexistent reads leave no audit row because no read took place.
    await transaction(db, environment, (tx) => tx.aiServiceDeletionAudit.create({ data: { environment, kind: "READ_CONSULTATION", requestId: row.id, actorId: actor.userId, reasonCode: "ADMIN_READ", scope: "READ" } }));
    return value;
}

/** Metadata-only lookup of one subject's consultations. The subject hash is computed in memory only and never stored or logged; the returned rows carry no ciphertext and no hash. */
export async function findConsultationsBySubject(db: Database, environment: Environment, actor: Actor, keys: Keys, subjectUserId: unknown) {
    assertAdmin(actor);
    const subject = parse(z.string().min(1).max(128), subjectUserId);
    const subjectHashes = hashes(keys, "subject", environment, subject);
    return transaction(db, environment, (tx) => tx.aiServiceRequest.findMany({
        where: { environment, subjectHashes: { hasSome: subjectHashes } },
        select: { id: true, status: true, createdAt: true, expiresAt: true, category: true },
        orderBy: { createdAt: "desc" },
        take: 100,
    }));
}

const deleteConsultationInput = z.object({
    subjectUserId: z.string().min(1).max(128),
    scope: z.enum(["SINGLE", "BULK"]),
    requestId: z.string().uuid().optional(),
    reasonCode: z.enum(["USER_REQUEST", "ADMIN_REVIEW"]),
});

/**
 * Individual delete (OQ-P0-3 (a), OQ-P0-8 (c)). SINGLE deletes one row by UUID,
 * BULK deletes up to 100 rows of one subject. The subject hash is computed in
 * memory and cross-checked inside the transaction: a missing row and an
 * unauthorized row fail with the identical fixed error, so existence is never
 * disclosed. PROCESSING rows release their reservedKrw from the budget month
 * (same decrement as the recoverInTransaction FAILED path); SETTLED, UNKNOWN,
 * and FAILED rows change no budget. Deleting an UNKNOWN row does not unblock
 * claim: its unknownCount increment and unreleased reservedKrw stay in the
 * budget month, so the month stays blocked until reconcileMonth resolveAllHeld
 * clears them — deleting a row is not recovery. Each deleted row writes one audit row
 * (request UUID + actor + reason code + scope only). Quota-bucket aliases are
 * left alone: they expire within 2 hours on their own.
 */
export async function deleteConsultation(db: Database, environment: Environment, actor: Actor, keys: Keys, input: unknown) {
    assertAdmin(actor);
    const parsed = parse(deleteConsultationInput, input);
    if (parsed.scope === "SINGLE" && !parsed.requestId)
        throw new ServiceDenied();
    if (parsed.scope === "BULK" && parsed.requestId)
        throw new ServiceDenied();
    const subjectHashes = hashes(keys, "subject", environment, parsed.subjectUserId);
    return transaction(db, environment, async (tx) => {
        let targets: { id: string; status: string; month: string; reservedKrw: number; subjectHashes: string[] }[];
        if (parsed.scope === "SINGLE") {
            const row = await tx.aiServiceRequest.findFirst({ where: { id: parsed.requestId as string, environment } });
            targets = row && row.subjectHashes.some((h) => subjectHashes.includes(h)) ? [row] : [];
        } else {
            targets = await tx.aiServiceRequest.findMany({ where: { environment, subjectHashes: { hasSome: subjectHashes } }, orderBy: { createdAt: "desc" }, take: 100 });
        }
        if (targets.length === 0)
            throw new ServiceDenied();
        for (const row of targets) {
            if (row.status === "PROCESSING" && row.reservedKrw > 0) {
                await tx.aiServiceBudgetMonth.update({ where: { environment_month: { environment, month: row.month } },
                    data: { reservedKrw: { decrement: row.reservedKrw }, version: { increment: 1 } } });
            }
            await tx.aiServiceRequest.deleteMany({ where: { id: row.id, environment } });
            await tx.aiServiceDeletionAudit.create({ data: { environment,
                kind: parsed.scope === "SINGLE" ? "DELETE_SINGLE" : "DELETE_BULK",
                requestId: row.id, actorId: actor.userId, reasonCode: parsed.reasonCode, scope: parsed.scope } });
        }
        const remainingCount = await tx.aiServiceRequest.count({ where: { environment, subjectHashes: { hasSome: subjectHashes } } });
        return { deletedCount: targets.length, remainingCount };
    });
}
