import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type AiConsultation } from "@prisma/client";
import { z } from "zod";
import {
  AiDenied,
  RETENTION_MS,
  type Scope,
  type SkillInput,
  type Reply,
} from "@/lib/ai-consultations/contracts";
import {
  equalHash,
  keyedHash,
  open,
  seal,
  subjectHashes,
  type Keyring,
} from "@/lib/ai-consultations/crypto";
import { manifestDigest } from "./runtime";
import { PHASE20_PREVIEW_LOCK_KEY } from "@/lib/e2e/phase20-lease";
export const limitsSchema = z
  .object({
    subjectPerMinute: z.number().int().min(1).max(60),
    globalPerMinute: z.number().int().min(1).max(300),
    dailyCalls: z.number().int().min(1).max(10000),
    dailyCost: z.literal(0),
  })
  .strict();
export type Limits = z.infer<typeof limitsSchema>;
export function readLimits(env: NodeJS.ProcessEnv): Limits {
  try {
    return limitsSchema.parse(JSON.parse(env.AI_MOCK_LIMITS ?? "null"));
  } catch {
    throw new AiDenied();
  }
}
export const cachedSchema = z
  .object({
    question: z.string().max(1000),
    reply: z
      .object({
        category: z.enum([
          "PROGRAMS",
          "CLASSES",
          "AVAILABILITY",
          "GUIDANCE",
          "HUMAN_HANDOFF",
        ]),
        text: z.string().max(8000),
      })
      .strict(),
  })
  .strict();
export type Claim =
  | {
      kind: "NEW";
      row: AiConsultation;
    }
  | {
      kind: "CACHED";
      reply: Reply;
    }
  | {
      kind: "PENDING";
    };
function canonical(input: SkillInput) {
  return JSON.stringify([
    input.userRequest.user.id,
    input.action.params.scenario,
    input.userRequest.utterance,
  ]);
}
export async function assertOwnedLease(
  tx: Prisma.TransactionClient,
  scope: Scope,
  now: Date,
) {
  await tx.$queryRaw`SELECT "id" FROM "PreviewE2eRunLease" WHERE "runId" = ${scope.runId} FOR SHARE`;
  const lease = await tx.previewE2eRunLease.findUnique({
    where: { runId: scope.runId },
    select: { deploymentSha: true, expiresAt: true, aiFixtureManifest: true },
  });
  if (
    !lease ||
    lease.expiresAt <= now ||
    lease.deploymentSha !== scope.deploymentSha ||
    manifestDigest(scope.manifest) !==
      manifestDigest(lease.aiFixtureManifest as Scope["manifest"])
  )
    throw new AiDenied();
  const locks = await tx.$queryRaw<
    Array<{ held: boolean }>
  >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=(((${PHASE20_PREVIEW_LOCK_KEY} >> 32)::bigint)::oid) AND objid=(((${PHASE20_PREVIEW_LOCK_KEY} & 4294967295)::bigint)::oid) AND objsubid=1 AND mode='ExclusiveLock') AS held`;
  if (locks[0]?.held !== true) throw new AiDenied();
}
export async function transaction<T>(
  client: PrismaClient,
  runId: string,
  ms: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  try {
    return await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout',${Math.max(1, Math.floor(ms) - 40).toString()},true)`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '60ms'`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"phase21:" + runId},0))`;
        return fn(tx);
      },
      { maxWait: 40, timeout: ms },
    );
  } catch {
    throw new AiDenied();
  }
}
export async function claim(
  client: PrismaClient,
  scope: Scope,
  input: SkillInput,
  keys: Keyring,
  limits: Limits,
  now: Date,
  ms = 300,
  attemptDeadline = new Date(now.getTime() + 3700),
): Promise<Claim> {
  if (!scope.manifest.subjectIds.includes(input.userRequest.user.id))
    throw new AiDenied();
  return transaction(client, scope.runId, ms, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    const missingVersion = await tx.aiConsultation.findFirst({
      where: {
        runId: scope.runId,
        expiresAt: { gt: now },
        hmacVersion: { notIn: Object.keys(keys.hmac) },
      },
      select: { id: true },
    });
    if (missingVersion) throw new AiDenied();
    const requestKey = input.action.params.requestId;
    const old = await tx.aiConsultation.findUnique({
      where: { runId_requestKey: { runId: scope.runId, requestKey } },
    });
    if (old) {
      if (
        old.expiresAt <= now ||
        !equalHash(
          old.payloadHash,
          keyedHash(keys, old.hmacVersion, "request-body", canonical(input)),
        )
      )
        throw new AiDenied();
      if (old.status === "DONE" && old.rawCiphertext) {
        const data = cachedSchema.parse(open(keys, old, old.rawCiphertext));
        return { kind: "CACHED", reply: data.reply };
      }
      return { kind: "PENDING" };
    }
    const aliases = subjectHashes(keys, scope.runId, input.userRequest.user.id);
    const minute = now.toISOString().slice(0, 16);
    const day = now.toISOString().slice(0, 10);
    const expiresAt = new Date(now.getTime() + RETENTION_MS);
    const previous = await tx.aiQuotaBucket.findFirst({
      where: {
        runId: scope.runId,
        bucketKey: { endsWith: ":" + minute },
        aliases: { hasSome: aliases },
      },
      orderBy: { id: "asc" },
    });
    const bucketKeys = [
      "global-minute:" + minute,
      "global-day:" + day,
      previous?.bucketKey ?? "subject:" + randomUUID() + ":" + minute,
    ].sort();
    const buckets = [];
    for (const key of bucketKeys) {
      const isSubject = key.startsWith("subject:");
      const b = await tx.aiQuotaBucket.upsert({
        where: { runId_bucketKey: { runId: scope.runId, bucketKey: key } },
        create: {
          runId: scope.runId,
          bucketKey: key,
          aliases: isSubject ? aliases : [],
          expiresAt,
        },
        update: isSubject
          ? {
              aliases: [...new Set([...(previous?.aliases ?? []), ...aliases])],
            }
          : {},
      });
      buckets.push(b);
    }
    await tx.$queryRaw`SELECT "id" FROM "AiQuotaBucket" WHERE "id" IN (${Prisma.join(buckets.map((x) => x.id).sort())}) ORDER BY "id" FOR UPDATE`;
    for (const b of buckets) {
      const maxAccepted = b.bucketKey.startsWith("subject:")
        ? limits.subjectPerMinute
        : b.bucketKey.startsWith("global-minute:")
          ? limits.globalPerMinute
          : Number.MAX_SAFE_INTEGER;
      if (
        b.accepted + 1 > maxAccepted ||
        b.usedCalls + b.reservedCalls + 2 > limits.dailyCalls ||
        b.usedCost + b.reservedCost > limits.dailyCost
      )
        throw new AiDenied();
    }
    for (const b of buckets)
      await tx.aiQuotaBucket.update({
        where: { id: b.id },
        data: { accepted: { increment: 1 }, reservedCalls: { increment: 2 } },
      });
    const id = randomUUID();
    const initialRaw = seal(
      keys,
      { id, runId: scope.runId, createdAt: now, expiresAt },
      {
        question: input.userRequest.utterance,
        reply: {
          category: "HUMAN_HANDOFF",
          text: "확인 가능한 안내가 없습니다. 담당자에게 문의해 주세요.",
        },
      },
    );
    const row = await tx.aiConsultation.create({
      data: {
        id,
        ...initialRaw,
        runId: scope.runId,
        requestKey,
        payloadHash: keyedHash(
          keys,
          keys.activeHmac,
          "request-body",
          canonical(input),
        ),
        hmacVersion: keys.activeHmac,
        subjectHashes: aliases,
        status: "PROCESSING",
        attempt: 1,
        reservedCalls: 2,
        reservedCost: 0,
        quotaBucketIds: buckets.map((x) => x.id),
        createdAt: now,
        expiresAt,
        attemptDeadline,
      },
    });
    return { kind: "NEW", row };
  });
}
export async function dispatch(
  client: PrismaClient,
  scope: Scope,
  row: AiConsultation,
  now: Date,
  ms = 150,
) {
  return transaction(client, row.runId, ms, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    const changed = await tx.aiConsultation.updateMany({
      where: {
        id: row.id,
        runId: row.runId,
        status: "PROCESSING",
        attempt: row.attempt,
        dispatched: false,
        attemptDeadline: { gt: now },
        expiresAt: { gt: now },
      },
      data: { dispatched: true },
    });
    if (changed.count !== 1) throw new AiDenied();
  });
}
export function reservationSettlement(input: {
  reservedCalls: number;
  reservedCost: number;
  usedCalls: number;
  usedCost: number;
  dispatched: boolean;
  uncertain: boolean;
}) {
  const { reservedCalls, reservedCost, usedCalls, usedCost } = input;
  if (
    [reservedCalls, reservedCost, usedCalls, usedCost].some(
      (x) => !Number.isSafeInteger(x) || x < 0,
    ) ||
    usedCalls > reservedCalls ||
    usedCost > reservedCost
  )
    throw new AiDenied();
  return input.uncertain && input.dispatched
    ? { refundCalls: 0, refundCost: 0, usedCalls: 0, usedCost: 0 }
    : {
        refundCalls: reservedCalls - usedCalls,
        refundCost: reservedCost - usedCost,
        usedCalls,
        usedCost,
      };
}
export async function settle(
  client: PrismaClient,
  scope: Scope,
  row: AiConsultation,
  keys: Keyring,
  input: {
    question: string;
    reply?: Reply;
    usedCalls: number;
    uncertain: boolean;
  },
  now: Date,
  ms = 350,
) {
  return transaction(client, row.runId, ms, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    const current = await tx.aiConsultation.findUnique({
      where: { id: row.id },
    });
    if (
      !current ||
      current.runId !== row.runId ||
      current.attempt !== row.attempt ||
      current.status !== "PROCESSING"
    )
      return false;
    if (current.attemptDeadline <= now || current.expiresAt <= now)
      throw new AiDenied();
    const totals = reservationSettlement({
      reservedCalls: current.reservedCalls,
      reservedCost: current.reservedCost,
      usedCalls: input.usedCalls,
      usedCost: 0,
      dispatched: current.dispatched,
      uncertain: input.uncertain,
    });
    const uncertain = input.uncertain && current.dispatched;
    const status = uncertain ? "UNCERTAIN" : input.reply ? "DONE" : "FAILED";
    const raw = input.reply
      ? seal(
          keys,
          current,
          cachedSchema.parse({ question: input.question, reply: input.reply }),
        )
      : {};
    for (const id of [...current.quotaBucketIds].sort())
      await tx.aiQuotaBucket.update({
        where: { id },
        data: {
          reservedCalls: { decrement: totals.refundCalls + totals.usedCalls },
          reservedCost: { decrement: totals.refundCost + totals.usedCost },
          usedCalls: { increment: totals.usedCalls },
          usedCost: { increment: totals.usedCost },
        },
      });
    await tx.aiConsultation.update({
      where: { id: current.id },
      data: {
        status,
        ...raw,
        resultCategory: input.reply?.category ?? "HUMAN_HANDOFF",
        usedCalls: totals.usedCalls,
        usedCost: 0,
        settledAt: now,
      },
    });
    const day = new Date(current.createdAt.toISOString().slice(0, 10));
    const category = input.reply?.category ?? "HUMAN_HANDOFF";
    await tx.aiDailyMetric.upsert({
      where: { day_category: { day, category } },
      create: {
        day,
        category,
        count: 1,
        modelCalls: totals.usedCalls,
        syntheticCost: 0,
      },
      update: {
        count: { increment: 1 },
        modelCalls: { increment: totals.usedCalls },
      },
    });
    return true;
  });
}
/** Recovery fences stale attempts; post-dispatch unknown usage stays reserved and cannot freely retry. */
export async function recover(client: PrismaClient, scope: Scope, now: Date, ms = 300) {
  return transaction(client, scope.runId, ms, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    const rows = await tx.aiConsultation.findMany({
      where: {
        runId: scope.runId,
        status: "PROCESSING",
        attemptDeadline: { lte: now },
      },
      take: 20,
      orderBy: { id: "asc" },
    });
    for (const row of rows) {
      if (!row.dispatched)
        for (const id of [...row.quotaBucketIds].sort())
          await tx.aiQuotaBucket.update({
            where: { id },
            data: {
              reservedCalls: { decrement: row.reservedCalls },
              reservedCost: { decrement: row.reservedCost },
            },
          });
      await tx.aiConsultation.update({
        where: { id: row.id },
        data: {
          status: row.dispatched ? "UNCERTAIN" : "FAILED",
          attempt: { increment: 1 },
          resultCategory: "HUMAN_HANDOFF",
          settledAt: now,
        },
      });
      // This terminal transition and its anonymous count commit together.
      // The PROCESSING predicate and run lock prevent retry/late-settle duplication.
      const day = new Date(row.createdAt.toISOString().slice(0, 10));
      const category = "HUMAN_HANDOFF";
      await tx.aiDailyMetric.upsert({
        where: { day_category: { day, category } },
        create: { day, category, count: 1, modelCalls: 0, syntheticCost: 0 },
        update: { count: { increment: 1 } },
      });
    }
    return rows.length;
  });
}
