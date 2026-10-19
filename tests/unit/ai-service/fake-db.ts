import { randomUUID } from "node:crypto";
import type { Database } from "@/server/ai-service/repository";
type Row = Record<string, unknown>;
const modelNames = ["aiServiceConfig", "aiServiceRequest", "aiServiceBudgetMonth", "aiServiceQuotaBucket", "aiServiceDailyMetric",
    "aiServiceRetentionJob", "aiServiceKeyPin", "aiServiceReconciliation", "aiServiceProgramPublication", "aiServiceClassPublication", "aiServiceKnowledgeEntry", "program", "classSchedule"] as const;
function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
        if (key === "OR")
            return (value as Row[]).some(w => matches(row, w));
        if (key === "AND")
            return (value as Row[]).every(w => matches(row, w));
        const actual = row[key];
        if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
            const ops = value as Row;
            if (key.includes("_") && actual === undefined)
                return matches(row, ops);
            return Object.entries(ops).every(([op, v]) => {
                if (op === "in")
                    return (v as unknown[]).includes(actual);
                if (op === "hasSome")
                    return (actual as unknown[]).some(x => (v as unknown[]).includes(x));
                if (op === "not")
                    return actual !== v;
                if (op === "gt")
                    return (actual as number) > (v as number);
                if (op === "gte")
                    return (actual as number) >= (v as number);
                if (op === "lt")
                    return (actual as number) < (v as number);
                if (op === "lte")
                    return (actual as number) <= (v as number);
                return matches(actual as Row, { [op]: v });
            });
        }
        return actual instanceof Date && value instanceof Date ? +actual === +value : actual === value;
    });
}
function apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
            const op = v as Row;
            if ("increment" in op) {
                row[k] = Number(row[k] ?? 0) + Number(op.increment);
                continue;
            }
            if ("decrement" in op) {
                row[k] = Number(row[k] ?? 0) - Number(op.decrement);
                continue;
            }
            if ("set" in op) {
                row[k] = op.set;
                continue;
            }
        }
        row[k] = v;
    }
}
export function fakeDb() {
    const state: Record<string, Row[]> = Object.fromEntries(modelNames.map(n => [n, []]));
    const operations: string[] = [];
    let serial = Promise.resolve(), failure: string | null = null;
    const tx: Record<string, unknown> = { $queryRaw: async () => [], $executeRaw: async () => { operations.push("lock"); return 1; } };
    for (const name of modelNames) {
        const operation = (op: string) => {
            operations.push(name + "." + op);
            if (failure === name + "." + op) {
                failure = null;
                throw new Error("INJECTED_DB_FAILURE");
            }
        };
        const find = (where: Row) => state[name].find(r => matches(r, where));
        const create = (data: Row) => {
            const row: Row = { id: randomUUID(), version: 1, status: name === "aiServiceRequest" ? "PROCESSING" : "IDLE", attempt: 1, dispatched: false,
                reservedKrw: 0, usedKrw: 0, correctionKrw: 0, billedKrw: 0, unknownCount: 0, dispatchGeneration: name === "aiServiceRequest" ? null : 0, dispatchedAt: null, accepted: 0, attempts: 0, deletedCount: 0,
                rawCiphertext: null, encryptionVersion: null, nextRetryAt: null, lastSuccessAt: null, ...structuredClone(data) };
            state[name].push(row);
            return structuredClone(row);
        };
        tx[name] = {
            findFirst: async ({ where = {} }: Row = {}) => { operation("findFirst"); return structuredClone(find(where as Row) ?? null); },
            findUnique: async ({ where }: Row) => { operation("findUnique"); return structuredClone(find(where as Row) ?? null); },
            findMany: async ({ where = {}, take, select }: Row = {}) => { operation("findMany"); return structuredClone(state[name].filter(r => matches(r, where as Row)).slice(0, typeof take === "number" ? take : undefined).map(r => select ? Object.fromEntries(Object.keys(select as Row).filter(k => (select as Row)[k]).map(k => [k, r[k]])) : r)); },
            count: async ({ where = {} }: Row = {}) => { operation("count"); return state[name].filter(r => matches(r, where as Row)).length; },
            groupBy: async ({ where = {}, by }: Row) => {
                operation("groupBy");
                const groups = new Map<string, Row & { _count: { _all: number } }>();
                for (const row of state[name].filter(r => matches(r, where as Row))) {
                    const fields = Object.fromEntries((by as string[]).map(key => [key, row[key]]));
                    const key = JSON.stringify(fields);
                    const group = groups.get(key);
                    if (group)
                        group._count._all++;
                    else
                        groups.set(key, { ...fields, _count: { _all: 1 } });
                }
                return [...groups.values()];
            },
            create: async ({ data }: Row) => { operation("create"); return create(data as Row); },
            update: async ({ where, data }: Row) => {
                operation("update");
                const row = find(where as Row);
                if (!row)
                    throw new Error("MISSING_ROW");
                apply(row, data as Row);
                return structuredClone(row);
            },
            updateMany: async ({ where, data }: Row) => {
                operation("updateMany");
                let count = 0;
                for (const row of state[name])
                    if (matches(row, where as Row)) {
                        apply(row, data as Row);
                        count++;
                    }
                return { count };
            },
            upsert: async ({ where, create: c, update }: Row) => {
                operation("upsert");
                const row = find(where as Row);
                if (!row)
                    return create(c as Row);
                apply(row, update as Row);
                return structuredClone(row);
            },
            deleteMany: async ({ where }: Row) => { operation("deleteMany"); const before = state[name].length; state[name] = state[name].filter(r => !matches(r, where as Row)); return { count: before - state[name].length }; },
        };
    }
    const db = { $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
            const previous = serial;
            let release!: () => void;
            serial = new Promise(r => { release = r; });
            await previous;
            const before = structuredClone(state);
            try {
                return await fn(tx);
            }
            catch (error) {
                for (const key of modelNames)
                    state[key] = before[key];
                throw error;
            }
            finally {
                release();
            }
        } } as unknown as Database;
    return { db, state, operations, failNext: (name: string) => { failure = name; }, seed: (name: string, row: Row) => state[name].push(structuredClone(row)) };
}
export const now = new Date("2026-10-15T00:00:00Z");
export function seedConfig(fake: ReturnType<typeof fakeDb>, environment = "PREVIEW") {
    fake.seed("aiServiceConfig", { environment, paused: false, provider: "TEST_DOUBLE", model: "gpt-6-luna", priceVersion: "price-v1", version: 1,
        inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1400000, fxCheckedAt: now, fxSource: "synthetic-bank", updatedById: "synthetic-admin" });
}
