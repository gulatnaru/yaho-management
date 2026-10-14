import { randomUUID } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import {
  type Scope,
  SYNTHETIC_UTTERANCES,
  type Scenario,
} from "@/lib/ai-consultations/contracts";
import { readKeys } from "@/lib/ai-consultations/crypto";
import { runtimeDatabaseIdentityFingerprint } from "@/lib/e2e/preview-safety";
import {
  AI_MIGRATION,
  manifestDigest,
  proofSignature,
} from "@/server/ai-consultations/runtime";
export const scope: Scope = {
  runId: "preview-abcdefghijklmnopqrstuv",
  deploymentSha: "a".repeat(40),
  manifest: {
    version: 1,
    programIds: ["private-program-id"],
    classIds: ["private-class-id"],
    subjectIds: ["synthetic-guardian0001"],
  },
};
export const limits = {
  subjectPerMinute: 10,
  globalPerMinute: 50,
  dailyCalls: 100,
  dailyCost: 0 as const,
};
export function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_SHA: scope.deploymentSha,
    PREVIEW_E2E_SUPABASE_PROJECT_REF: "previewproject",
    PRODUCTION_E2E_SUPABASE_PROJECT_REF: "productionproject",
    DATABASE_URL:
      "postgresql://postgres.previewproject:test@aws-0.pooler.supabase.com:6543/postgres",
    DIRECT_URL:
      "postgresql://postgres.previewproject:test@aws-0.pooler.supabase.com:5432/postgres",
    PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256: runtimeDatabaseIdentityFingerprint(
      {
        database: "postgres",
        currentUser: "postgres",
        currentSchema: "public",
      },
      "previewproject",
    ),
    AI_ENCRYPTION_KEYS: JSON.stringify({
      v1: Buffer.alloc(32, 1).toString("base64"),
    }),
    AI_HMAC_KEYS: JSON.stringify({
      v1: Buffer.alloc(32, 2).toString("base64"),
    }),
    AI_ENCRYPTION_ACTIVE: "v1",
    AI_HMAC_ACTIVE: "v1",
    AI_MOCK_REQUEST_SECRET: Buffer.alloc(32, 3).toString("base64"),
    AI_MOCK_LIMITS: JSON.stringify(limits),
  };
}
export const keys = readKeys(environment());
export function skill(
  scenario: Scenario = "PROGRAMS",
  requestId: string = randomUUID(),
) {
  return {
    version: "2.0" as const,
    userRequest: {
      utterance: SYNTHETIC_UTTERANCES[scenario],
      user: { id: scope.manifest.subjectIds[0] },
    },
    action: { params: { scenario, requestId } },
  };
}
export function proof(
  body: string,
  purpose = "POST:/api/ai-consultations/mock-skill",
  now = new Date(),
) {
  const fields = {
    runId: scope.runId,
    sha: scope.deploymentSha,
    issued: now.getTime(),
    manifestHash: manifestDigest(scope.manifest),
    purpose,
    body,
  };
  return [
    fields.runId,
    fields.sha,
    fields.issued,
    fields.manifestHash,
    proofSignature(keys, fields),
  ].join(".");
}
export type Row = Record<string, unknown>;
function value(row: Row, data: Row) {
  const result = { ...row };
  for (const [key, v] of Object.entries(data)) {
    if (v && typeof v === "object" && ("increment" in v || "decrement" in v)) {
      const op = v as {
        increment?: number;
        decrement?: number;
      };
      result[key] =
        Number(row[key] ?? 0) + (op.increment ?? 0) - (op.decrement ?? 0);
    } else result[key] = v;
  }
  return result;
}
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      const cond = v as Row;
      if ("in" in cond) return (cond.in as unknown[]).includes(row[k]);
      if ("notIn" in cond) return !(cond.notIn as unknown[]).includes(row[k]);
      if ("gt" in cond) return Number(row[k]) > Number(cond.gt);
      if ("lte" in cond) return Number(row[k]) <= Number(cond.lte);
      if ("endsWith" in cond)
        return String(row[k]).endsWith(String(cond.endsWith));
      if ("hasSome" in cond)
        return (row[k] as string[]).some((x) =>
          (cond.hasSome as string[]).includes(x),
        );
      return matches(row[k] as Row, cond);
    }
    return row[k] === v;
  });
}
/** Deliberate in-memory transaction model, NOT a claim about PostgreSQL locking semantics. */
export function memoryClient() {
  let state: {
    consultations: Row[];
    quotas: Row[];
    metrics: Row[];
    jobs: Row[];
  } = { consultations: [], quotas: [], metrics: [], jobs: [] };
  let tail = Promise.resolve();
  let leased = true;
  let failDelete = false;
  let queries = 0;
  const lease = {
    deploymentSha: scope.deploymentSha,
    expiresAt: new Date(Date.now() + 86400000),
    aiFixtureManifest: scope.manifest,
  };
  const api = {
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      const before = tail;
      let release!: () => void;
      tail = new Promise<void>((r) => {
        release = r;
      });
      await before;
      const snapshot = structuredClone(state);
      try {
        return await fn(api);
      } catch (e) {
        state = snapshot;
        throw e;
      } finally {
        release();
      }
    },
    async $executeRaw() {
      return 0;
    },
    async $queryRaw(strings: TemplateStringsArray) {
      queries++;
      const text = strings.join("");
      if (text.includes("SELECT pg_advisory_xact_lock")) throw new Error("PRISMA_VOID_RESULT_UNSUPPORTED");
      if (text.includes("current_database() AS"))
        return [
          {
            database: "postgres",
            currentUser: "postgres",
            currentSchema: "public",
          },
        ];
      if (text.includes("_prisma_migrations"))
        return [
          {
            migration_name: AI_MIGRATION,
            finished_at: new Date(),
            rolled_back_at: null,
          },
        ];
      if (text.includes("SELECT EXISTS")) return [{ held: true }];
      return [];
    },
    previewE2eRunLease: {
      async findUnique() {
        return leased ? lease : null;
      },
    },
    aiConsultation: {
      async findUnique({ where }: { where: Row }) {
        return (
          state.consultations.find((r) =>
            where.id
              ? r.id === where.id
              : matches(r, where.runId_requestKey as Row),
          ) ?? null
        );
      },
      async findFirst({ where }: { where: Row }) {
        return state.consultations.find((r) => matches(r, where)) ?? null;
      },
      async findMany({ where, take }: { where: Row; take?: number }) {
        return state.consultations
          .filter((r) => matches(r, where))
          .slice(0, take ?? 100);
      },
      async create({ data }: { data: Row }) {
        const row = {
          origin: "SYNTHETIC",
          dispatched: false,
          usedCalls: 0,
          usedCost: 0,
          settledAt: null,
          ...data,
        };
        state.consultations.push(row);
        return row;
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const i = state.consultations.findIndex((r) => matches(r, where));
        if (i < 0) throw new Error("MISSING");
        return (state.consultations[i] = value(state.consultations[i], data));
      },
      async updateMany({ where, data }: { where: Row; data: Row }) {
        const rows = state.consultations.filter((r) => matches(r, where));
        for (const r of rows) Object.assign(r, value(r, data));
        return { count: rows.length };
      },
      async deleteMany({ where }: { where: Row }) {
        if (failDelete) throw new Error("RAW_SENSITIVE_DB_FAILURE");
        const before = state.consultations.length;
        state.consultations = state.consultations.filter(
          (r) => !matches(r, where),
        );
        return { count: before - state.consultations.length };
      },
    },
    aiQuotaBucket: {
      async findFirst({ where }: { where: Row }) {
        return state.quotas.find((r) => matches(r, where)) ?? null;
      },
      async findMany({ where, take }: { where: Row; take?: number }) {
        return state.quotas
          .filter((r) => matches(r, where))
          .slice(0, take ?? 100);
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: Row;
        create: Row;
        update: Row;
      }) {
        const old = state.quotas.find((r) =>
          matches(r, where.runId_bucketKey as Row),
        );
        if (old) {
          Object.assign(old, value(old, update));
          return old;
        }
        const row = {
          id: randomUUID(),
          accepted: 0,
          reservedCalls: 0,
          reservedCost: 0,
          usedCalls: 0,
          usedCost: 0,
          ...create,
        };
        state.quotas.push(row);
        return row;
      },
      async update({ where, data }: { where: Row; data: Row }) {
        const row = state.quotas.find((r) => matches(r, where));
        if (!row) throw new Error("MISSING");
        Object.assign(row, value(row, data));
        if (Number(row.reservedCalls) < 0) throw new Error("NEGATIVE");
        return row;
      },
      async deleteMany({ where }: { where: Row }) {
        const before = state.quotas.length;
        state.quotas = state.quotas.filter((r) => !matches(r, where));
        return { count: before - state.quotas.length };
      },
    },
    aiDailyMetric: {
      async upsert({
        where,
        create,
        update,
      }: {
        where: Row;
        create: Row;
        update: Row;
      }) {
        const identity = where.day_category as Row;
        const old = state.metrics.find(
          (r) =>
            Number(r.day) === Number(identity.day) &&
            r.category === identity.category,
        );
        if (old) {
          Object.assign(old, value(old, update));
          return old;
        }
        const row = { id: randomUUID(), ...create };
        state.metrics.push(row);
        return row;
      },
    },
    aiRetentionJob: {
      async findUnique() {
        return state.jobs[0] ?? null;
      },
      async upsert({ create, update }: { create: Row; update: Row }) {
        if (state.jobs[0]) {
          Object.assign(state.jobs[0], value(state.jobs[0], update));
          return state.jobs[0];
        }
        const row = { id: randomUUID(), deletedCount: 0, ...create };
        state.jobs.push(row);
        return row;
      },
      async update({ data }: { data: Row }) {
        Object.assign(state.jobs[0], value(state.jobs[0], data));
        return state.jobs[0];
      },
    },
  };
  return {
    client: api as unknown as PrismaClient,
    get state() {
      return state;
    },
    revoke() {
      leased = false;
    },
    setFailDelete(v: boolean) {
      failDelete = v;
    },
    get queries() {
      return queries;
    },
  };
}
