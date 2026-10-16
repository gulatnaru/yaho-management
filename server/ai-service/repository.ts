import type { Prisma, PrismaClient } from "@prisma/client";
import { ServiceDenied, type Environment } from "./contracts";
export type Database = Pick<PrismaClient, "$transaction">;
export type Tx = Prisma.TransactionClient;
/** One environment lock serializes all service writers; network calls never hold it. */
export async function transaction<T>(db: Database, environment: Environment, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.$transaction(async (tx) => {
        await tx.$executeRaw `SET LOCAL statement_timeout = '180ms'`;
        await tx.$executeRaw `SET LOCAL lock_timeout = '50ms'`;
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtextextended(${"ai-service:" + environment}, 21062))`;
        return fn(tx);
    }, { maxWait: 50, timeout: 250 }).catch(() => { throw new ServiceDenied(); });
}
