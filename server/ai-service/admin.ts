import { programDigest, classDigest } from "./publication-digest";
import { z } from "zod";
import { assertAdmin, parse, configSchema, publicationSchema, guidanceSchema, ServiceDenied, type Actor, type Environment } from "./contracts";
import { transaction, type Database } from "./repository";
import { safePublicText } from "./tools";
import { decrypt, type Keys } from "./crypto";
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
export async function saveGuidance(db: Database, environment: Environment, actor: Actor, value: unknown) {
    assertAdmin(actor);
    const input = parse(guidanceSchema, value);
    safePublicText(input.content);
    return transaction(db, environment, async (tx) => {
        const where = { environment_topic: { environment, topic: input.topic } };
        const old = await tx.aiServiceKnowledgeEntry.findUnique({ where });
        if ((old?.version ?? 0) !== input.expectedVersion)
            throw new ServiceDenied();
        return tx.aiServiceKnowledgeEntry.upsert({ where, create: { environment, topic: input.topic, content: input.content, approved: input.approved, updatedById: actor.userId },
            update: { content: input.content, approved: input.approved, version: { increment: 1 }, updatedById: actor.userId } });
    });
}
export async function readState(db: Database, environment: Environment, actor: Actor, now: Date) {
    assertAdmin(actor);
    return transaction(db, environment, async (tx) => ({
        config: await tx.aiServiceConfig.findUnique({ where: { environment } }),
        programs: await tx.aiServiceProgramPublication.findMany({ where: { environment }, take: 50 }),
        classes: await tx.aiServiceClassPublication.findMany({ where: { environment }, take: 50 }),
        knowledge: await tx.aiServiceKnowledgeEntry.findMany({ where: { environment }, take: 3 }),
        budgets: await tx.aiServiceBudgetMonth.findMany({ where: { environment }, orderBy: { month: "desc" }, take: 12 }),
        consultations: await tx.aiServiceRequest.findMany({ where: { environment, expiresAt: { gt: now } },
            select: { id: true, status: true, createdAt: true, expiresAt: true, category: true }, orderBy: { createdAt: "desc" }, take: 50 }),
        retention: await tx.aiServiceRetentionJob.findUnique({ where: { environment } }),
        expiredCount: await tx.aiServiceRequest.count({ where: { environment, expiresAt: { lte: now } } }),
    }));
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
    return value;
}
