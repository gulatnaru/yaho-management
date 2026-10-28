import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  AiDenied,
  SYNTHETIC_GUIDANCE,
  publicationSchema,
  guidanceSchema,
  type Scope,
} from "@/lib/ai-consultations/contracts";
import { open, type Keyring } from "@/lib/ai-consultations/crypto";
import { cachedSchema, assertOwnedLease, transaction } from "./ledger";
export type Actor = {
  userId: string;
  role: string;
  active: boolean;
};
export function assertAdmin(actor: Actor) {
  if (actor.role !== "ADMIN" || !actor.active || !actor.userId)
    throw new AiDenied();
}
/** External validation never surfaces Zod diagnostics containing submitted values. */
function validateAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AiDenied();
  return parsed.data;
}
export async function updatePublication(
  client: PrismaClient,
  scope: Scope,
  actor: Actor,
  value: unknown,
) {
  assertAdmin(actor);
  const input = validateAdminInput(publicationSchema, value);
  const ids =
    input.kind === "PROGRAM"
      ? scope.manifest.programIds
      : scope.manifest.classIds;
  if (!ids.includes(input.id)) throw new AiDenied();
  return transaction(client, scope.runId, 300, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    if (input.kind === "PROGRAM") {
      const old = await tx.aiProgramPublication.findUnique({
        where: { runId_programId: { runId: scope.runId, programId: input.id } },
      });
      if ((old?.version ?? 0) !== input.expectedVersion) throw new AiDenied();
      return tx.aiProgramPublication.upsert({
        where: { runId_programId: { runId: scope.runId, programId: input.id } },
        create: {
          runId: scope.runId,
          programId: input.id,
          enabled: input.enabled,
          updatedById: actor.userId,
        },
        update: {
          enabled: input.enabled,
          version: { increment: 1 },
          updatedById: actor.userId,
        },
      });
    }
    const old = await tx.aiClassPublication.findUnique({
      where: {
        runId_classScheduleId: {
          runId: scope.runId,
          classScheduleId: input.id,
        },
      },
    });
    if ((old?.version ?? 0) !== input.expectedVersion) throw new AiDenied();
    return tx.aiClassPublication.upsert({
      where: {
        runId_classScheduleId: {
          runId: scope.runId,
          classScheduleId: input.id,
        },
      },
      create: {
        runId: scope.runId,
        classScheduleId: input.id,
        enabled: input.enabled,
        updatedById: actor.userId,
      },
      update: {
        enabled: input.enabled,
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });
  });
}
export async function updateGuidance(
  client: PrismaClient,
  scope: Scope,
  actor: Actor,
  value: unknown,
) {
  assertAdmin(actor);
  const input = validateAdminInput(guidanceSchema, value);
  return transaction(client, scope.runId, 300, async (tx) => {
    await assertOwnedLease(tx, scope, new Date());
    const old = await tx.aiKnowledgeEntry.findUnique({
      where: { runId_topic: { runId: scope.runId, topic: input.topic } },
    });
    if ((old?.version ?? 0) !== input.expectedVersion) throw new AiDenied();
    return tx.aiKnowledgeEntry.upsert({
      where: { runId_topic: { runId: scope.runId, topic: input.topic } },
      create: {
        runId: scope.runId,
        topic: input.topic,
        content: SYNTHETIC_GUIDANCE[input.topic],
        approved: input.approved,
        updatedById: actor.userId,
      },
      update: {
        content: SYNTHETIC_GUIDANCE[input.topic],
        approved: input.approved,
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });
  });
}
export async function readAdminState(
  client: PrismaClient,
  scope: Scope,
  actor: Actor,
  clock: () => Date = () => new Date(),
) {
  assertAdmin(actor);
  return transaction(client, scope.runId, 350, async (tx) => {
    await assertOwnedLease(tx, scope, clock());
    const programs = await tx.aiProgramPublication.findMany({
      where: {
        runId: scope.runId,
        programId: { in: scope.manifest.programIds },
      },
      select: { programId: true, enabled: true, version: true },
    });
    const classes = await tx.aiClassPublication.findMany({
      where: {
        runId: scope.runId,
        classScheduleId: { in: scope.manifest.classIds },
      },
      select: { classScheduleId: true, enabled: true, version: true },
    });
    const knowledge = await tx.aiKnowledgeEntry.findMany({
      where: { runId: scope.runId },
      select: { topic: true, approved: true, version: true },
    });
    const consultations = await tx.aiConsultation.findMany({
      where: {
        runId: scope.runId,
        origin: "SYNTHETIC",
        expiresAt: { gt: clock() },
      },
      select: {
        id: true,
        status: true,
        resultCategory: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const job = await tx.aiRetentionJob.findUnique({
      where: { runId: scope.runId },
      select: {
        status: true,
        attempts: true,
        deletedCount: true,
        lastSuccessAt: true,
        nextRetryAt: true,
        errorCode: true,
      },
    });
    const metrics = await tx.aiDailyMetric.findMany({
      select: {
        day: true,
        category: true,
        count: true,
        modelCalls: true,
        syntheticCost: true,
      },
      orderBy: { day: "desc" },
      take: 20,
    });
    return { programs, classes, knowledge, consultations, job, metrics };
  });
}
export async function readConsultation(
  client: PrismaClient,
  scope: Scope,
  actor: Actor,
  keys: Keyring,
  id: unknown,
  clock: () => Date = () => new Date(),
) {
  assertAdmin(actor);
  const consultationId = validateAdminInput(z.string().uuid(), id);
  const row = await transaction(client, scope.runId, 300, async (tx) => {
    await assertOwnedLease(tx, scope, clock());
    return tx.aiConsultation.findFirst({
      where: {
        id: consultationId,
        runId: scope.runId,
        origin: "SYNTHETIC",
        expiresAt: { gt: clock() },
      },
      select: {
        id: true,
        runId: true,
        createdAt: true,
        expiresAt: true,
        rawCiphertext: true,
      },
    });
  });
  if (!row?.rawCiphertext) throw new AiDenied();
  let parsed;
  try {
    parsed = cachedSchema.parse(open(keys, row, row.rawCiphertext, clock));
  } catch {
    throw new AiDenied();
  }
  if (row.expiresAt <= clock()) throw new AiDenied();
  return parsed;
}
