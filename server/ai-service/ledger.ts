import { billingContract, validatedBillingUsage, type BillingUsage } from "./billing";
import type { HmacPin } from "./crypto";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hardCap, RETENTION_MS, ServiceDenied, type Environment, assertAdmin, type Actor } from "./contracts";
import { conservativeKrw, monthKst, reserveKrw, type Price } from "./cost";
import { transaction, type Database, type Tx } from "./repository";
export type ClaimInput = {
    environment: Environment;
    hmacPins: HmacPin[];
    requestHashes: string[];
    payloadHashes: string[];
    subjectHashes: string[];
    now: Date;
};
function hashes(values: string[]) {
    if (!values.length || values.length > 8 || values.some(v => !/^v[1-9][0-9]{0,3}:[a-f0-9]{64}$/.test(v)))
        throw new ServiceDenied();
}
function validatePins(input: ClaimInput) {
    if (!Array.isArray(input.hmacPins) || !input.hmacPins.length || input.hmacPins.length > 8 ||
        input.hmacPins.some(p => !/^v[1-9][0-9]{0,3}$/.test(p.version) || !/^[a-f0-9]{64}$/.test(p.fingerprint)) ||
        new Set(input.hmacPins.map(p => p.version)).size !== input.hmacPins.length)
        throw new ServiceDenied();
    const versions = input.hmacPins.map(p => p.version).sort().join(",");
    for (const aliases of [input.requestHashes, input.payloadHashes, input.subjectHashes])
        if ([...new Set(aliases.map(h => h.split(":")[0]))].sort().join(",") !== versions)
            throw new ServiceDenied();
}
async function checkPins(tx: Tx, environment: Environment, pins: HmacPin[], append: boolean) {
    const stored = await tx.aiServiceKeyPin.findMany({ where: { environment } });
    for (const old of stored) {
        const pin = pins.find(p => p.version === old.version);
        if (!pin || pin.fingerprint !== old.fingerprint)
            throw new ServiceDenied();
    }
    if (append)
        for (const pin of pins)
            if (!stored.some(old => old.version === pin.version))
                await tx.aiServiceKeyPin.create({ data: { environment, ...pin } });
}
export async function recoverInTransaction(tx: Tx, environment: Environment, now: Date) {
    const stale = await tx.aiServiceRequest.findMany({ where: { environment, status: "PROCESSING", attemptDeadline: { lte: now } }, take: 100 });
    for (const row of stale) {
        const count = await tx.aiServiceRequest.updateMany({ where: { id: row.id, status: "PROCESSING", attempt: row.attempt }, data: {
                status: row.dispatched ? "UNKNOWN" : "FAILED", settledAt: row.dispatched ? null : now, usedKrw: 0
            } });
        if (!count.count)
            continue;
        await tx.aiServiceBudgetMonth.update({ where: { environment_month: { environment, month: row.month } }, data: row.dispatched ? { unknownCount: { increment: 1 }, version: { increment: 1 } } :
                { reservedKrw: { decrement: row.reservedKrw }, version: { increment: 1 } } });
    }
}
export async function claim(db: Database, input: ClaimInput) {
    validatePins(input);
    hashes(input.requestHashes);
    hashes(input.payloadHashes);
    hashes(input.subjectHashes);
    if (!Number.isFinite(input.now.getTime()))
        throw new ServiceDenied();
    await transaction(db, input.environment, async (tx) => { await checkPins(tx, input.environment, input.hmacPins, false); await recoverInTransaction(tx, input.environment, input.now); });
    return transaction(db, input.environment, async (tx) => {
        const { environment, now } = input;
        await checkPins(tx, environment, input.hmacPins, true);
        const old = await tx.aiServiceRequest.findFirst({ where: { environment, requestHashes: { hasSome: input.requestHashes } } });
        if (old) {
            if (!input.payloadHashes.includes(old.payloadHash) || old.expiresAt <= now)
                throw new ServiceDenied();
            return { kind: "DUPLICATE" as const, status: old.status };
        }
        const config = await tx.aiServiceConfig.findUnique({ where: { environment } });
        if (!config || config.paused)
            throw new ServiceDenied();
        const versions = [...new Set(input.requestHashes.map(h => h.split(":")[0]))];
        if ((config.hmacVersions ?? []).some(v => !versions.includes(v)))
            throw new ServiceDenied();
        if (versions.some(v => !(config.hmacVersions ?? []).includes(v)))
            await tx.aiServiceConfig.update({ where: { environment }, data: { hmacVersions: { set: versions }, version: { increment: 1 } } });
        const price: Price = { ...billingContract(config.provider, config.model), inputNanoUsdPerToken: config.inputNanoUsdPerToken, outputNanoUsdPerToken: config.outputNanoUsdPerToken,
            fxMilliKrwPerUsd: config.fxMilliKrwPerUsd, fxCheckedAt: config.fxCheckedAt, priceVersion: config.priceVersion };
        const reservedKrw = reserveKrw(price, now), month = monthKst(now);
        const blocking = await tx.aiServiceBudgetMonth.findFirst({ where: { environment, OR: [{ unknownCount: { gt: 0 } }, { month: { not: month }, reservedKrw: { gt: 0 } }] } });
        if (blocking)
            throw new ServiceDenied();
        const active = await tx.aiServiceRequest.count({ where: { environment, status: "PROCESSING" } });
        if (active >= 4)
            throw new ServiceDenied();
        const bucketId = environment + ":" + month;
        const bucket = await tx.aiServiceBudgetMonth.upsert({ where: { environment_month: { environment, month } },
            create: { id: bucketId, environment, month, capKrw: hardCap(environment) }, update: {} });
        if (bucket.capKrw !== hardCap(environment) || bucket.usedKrw + bucket.reservedKrw + bucket.correctionKrw + reservedKrw > hardCap(environment))
            throw new ServiceDenied();
        const windows = [
            { kind: "GLOBAL_MINUTE", window: now.toISOString().slice(0, 16), aliases: ["GLOBAL"], limit: 60, expiresAt: new Date(now.getTime() + 2 * 60000) },
            { kind: "SUBJECT_HOUR", window: now.toISOString().slice(0, 13), aliases: input.subjectHashes, limit: 10, expiresAt: new Date(now.getTime() + 2 * 3600000) },
        ];
        for (const w of windows) {
            const q = await tx.aiServiceQuotaBucket.findFirst({ where: { environment, kind: w.kind, window: w.window, aliases: { hasSome: w.aliases } } });
            if (q && q.accepted >= w.limit)
                throw new ServiceDenied();
            if (q)
                await tx.aiServiceQuotaBucket.update({ where: { id: q.id }, data: { accepted: { increment: 1 }, aliases: { set: [...new Set([...q.aliases, ...w.aliases])] } } });
            else
                await tx.aiServiceQuotaBucket.create({ data: { environment, kind: w.kind, window: w.window, aliases: w.aliases, accepted: 1, expiresAt: w.expiresAt } });
        }
        await tx.aiServiceBudgetMonth.update({ where: { id: bucket.id }, data: { reservedKrw: { increment: reservedKrw }, version: { increment: 1 } } });
        const row = await tx.aiServiceRequest.create({ data: { id: randomUUID(), environment, month, requestKey: input.requestHashes[0], requestHashes: input.requestHashes,
                payloadHash: input.payloadHashes[0], subjectHashes: input.subjectHashes, reservedKrw, provider: config.provider, model: config.model,
                priceSnapshot: { ...price, fxCheckedAt: price.fxCheckedAt.toISOString() }, createdAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS),
                attemptDeadline: new Date(now.getTime() + 3500) } });
        return { kind: "CLAIMED" as const, row, price };
    });
}
export async function markDispatched(db: Database, environment: Environment, id: string, attempt: number, now: Date) {
    return transaction(db, environment, async (tx) => {
        const row = await tx.aiServiceRequest.findFirst({ where: { id, environment, attempt, status: "PROCESSING", dispatched: false, attemptDeadline: { gt: now } } });
        if (!row)
            throw new ServiceDenied();
        const bucket = await tx.aiServiceBudgetMonth.update({ where: { environment_month: { environment, month: row.month } },
            data: { dispatchGeneration: { increment: 1 }, version: { increment: 1 } } });
        const result = await tx.aiServiceRequest.updateMany({ where: { id, environment, attempt, status: "PROCESSING", dispatched: false, attemptDeadline: { gt: now } },
            data: { dispatched: true, dispatchedAt: now, dispatchGeneration: bucket.dispatchGeneration } });
        if (result.count !== 1)
            throw new ServiceDenied();
    });
}
export type Settlement = {
    kind: "KNOWN";
    inputTokens: number;
    outputTokens: number;
    billingUsage?: BillingUsage;
    category: string;
    rawCiphertext?: string;
    encryptionVersion?: string;
} | {
    kind: "UNDISPATCHED";
} | {
    kind: "UNKNOWN";
};
export async function settle(db: Database, environment: Environment, id: string, attempt: number, result: Settlement, now: Date) {
    return transaction(db, environment, async (tx) => {
        const row = await tx.aiServiceRequest.findFirst({ where: { id, environment, attempt, status: "PROCESSING" } });
        if (!row)
            return false;
        if (result.kind === "UNDISPATCHED" && row.dispatched)
            throw new ServiceDenied();
        if (result.kind === "KNOWN" && !row.dispatched)
            throw new ServiceDenied();
        const snapshot = row.priceSnapshot as Record<string, unknown>;
        const price = { ...snapshot, fxCheckedAt: new Date(String(snapshot.fxCheckedAt)) } as Price;
        const billingUsage = result.kind === "KNOWN" ? validatedBillingUsage(result.billingUsage ?? { inputTokens: result.inputTokens, outputTokens: result.outputTokens }) : undefined;
        if (result.kind === "KNOWN" && billingUsage && (billingUsage.inputTokens !== result.inputTokens || billingUsage.outputTokens !== result.outputTokens))
            throw new ServiceDenied();
        const usedKrw = result.kind === "KNOWN" ? conservativeKrw(price, result.inputTokens, result.outputTokens) : 0;
        const status = result.kind === "UNKNOWN" ? "UNKNOWN" : result.kind === "KNOWN" ? "SETTLED" : "FAILED";
        const changed = await tx.aiServiceRequest.updateMany({ where: { id, environment, attempt, status: "PROCESSING" }, data: {
                status, usedKrw, settledAt: result.kind === "UNKNOWN" ? null : now,
                ...(result.kind === "KNOWN" ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens, billingUsage: JSON.parse(JSON.stringify(billingUsage)) as Prisma.InputJsonValue, category: result.category,
                    rawCiphertext: result.rawCiphertext ?? null, encryptionVersion: result.encryptionVersion ?? null } : {}),
            } });
        if (!changed.count)
            return false;
        await tx.aiServiceBudgetMonth.update({ where: { environment_month: { environment, month: row.month } }, data: result.kind === "UNKNOWN" ? { unknownCount: { increment: 1 }, version: { increment: 1 } } :
                { reservedKrw: { decrement: row.reservedKrw }, usedKrw: { increment: usedKrw }, version: { increment: 1 } } });
        if (result.kind === "KNOWN") {
            const day = new Date(row.createdAt.toISOString().slice(0, 10) + "T00:00:00Z");
            await tx.aiServiceDailyMetric.upsert({ where: { environment_day_category: { environment, day, category: result.category } },
                create: { environment, day, category: result.category, count: 1, modelCalls: 1, usedKrw },
                update: { count: { increment: 1 }, modelCalls: { increment: 1 }, usedKrw: { increment: usedKrw } } });
        }
        return true;
    });
}
/** Immutable evidence is scoped to a month and a server-generated dispatch cutoff. */
export type ReconciliationInput = {
    month: string;
    expectedVersion: number;
    billedKrw: number;
    heldActualKrw: number;
    resolveAllHeld: boolean;
    reference: string;
    coveredThroughGeneration: number;
    coverageConfirmed: true;
};
export async function reconcileMonth(db: Database, environment: Environment, actor: Actor, input: ReconciliationInput, now: Date) {
    assertAdmin(actor);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 ||
        !Number.isSafeInteger(input.billedKrw) || input.billedKrw < 0 || !Number.isSafeInteger(input.heldActualKrw) || input.heldActualKrw < 0 ||
        !Number.isSafeInteger(input.coveredThroughGeneration) || input.coveredThroughGeneration < 0 || input.coverageConfirmed !== true ||
        !/^invoice-[A-Za-z0-9_-]{8,100}$/.test(input.reference) || input.heldActualKrw > input.billedKrw)
        throw new ServiceDenied();
    const digest = createHash("sha256").update(JSON.stringify([environment, input.month, input.billedKrw, input.heldActualKrw,
        input.resolveAllHeld, input.coveredThroughGeneration, input.coverageConfirmed])).digest("hex");
    await transaction(db, environment, tx => recoverInTransaction(tx, environment, now));
    return transaction(db, environment, async (tx) => {
        const evidence = await tx.aiServiceReconciliation.findUnique({ where: { environment_reference: { environment, reference: input.reference } } });
        if (evidence) {
            if (evidence.payloadDigest !== digest)
                throw new ServiceDenied();
            // Replay never touches a newer obligation, even after another evidence record or raw deletion.
            return { kind: "REPLAY" as const, evidenceId: evidence.id };
        }
        const row = await tx.aiServiceBudgetMonth.findUnique({ where: { environment_month: { environment, month: input.month } } });
        if (!row || row.version !== input.expectedVersion || input.billedKrw < row.billedKrw)
            throw new ServiceDenied();
        const generation = row.dispatchGeneration ?? 0;
        if (input.coveredThroughGeneration > generation || (input.resolveAllHeld && input.coveredThroughGeneration !== generation))
            throw new ServiceDenied();
        const active = await tx.aiServiceRequest.count({ where: { environment, month: input.month, status: "PROCESSING" } });
        if (active || (!input.resolveAllHeld && input.heldActualKrw !== 0) || (!row.reservedKrw && input.heldActualKrw !== 0))
            throw new ServiceDenied();
        const usedKrw = row.usedKrw + (input.resolveAllHeld ? input.heldActualKrw : 0);
        const correctionKrw = Math.max(row.correctionKrw, input.billedKrw - usedKrw, 0);
        if (input.resolveAllHeld)
            await tx.aiServiceRequest.updateMany({ where: { environment, month: input.month, status: "UNKNOWN",
                    dispatchGeneration: { lte: input.coveredThroughGeneration } }, data: { status: "RECONCILED", settledAt: now } });
        const budget = await tx.aiServiceBudgetMonth.update({ where: { id: row.id }, data: { usedKrw, correctionKrw, billedKrw: input.billedKrw,
                ...(input.resolveAllHeld ? { reservedKrw: 0, unknownCount: 0 } : {}), version: { increment: 1 }, reconciliationReference: input.reference,
                reconciledById: actor.userId, reconciledAt: now } });
        const recorded = await tx.aiServiceReconciliation.create({ data: { environment, reference: input.reference, month: input.month,
                coveredThroughGeneration: input.coveredThroughGeneration, billedKrw: input.billedKrw, heldActualKrw: input.heldActualKrw,
                resolvesHeld: input.resolveAllHeld, payloadDigest: digest, budgetVersionBefore: row.version, recordedById: actor.userId, createdAt: now } });
        return { kind: "APPLIED" as const, budget, evidenceId: recorded.id };
    });
}
export function priceJson(price: Price): Prisma.InputJsonValue {
    return { ...price, fxCheckedAt: price.fxCheckedAt.toISOString() };
}
