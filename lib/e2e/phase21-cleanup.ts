import { Prisma, type PrismaClient } from "@prisma/client";
import {
  manifestSchema,
  runIdSchema,
  type FixtureManifest,
} from "@/lib/ai-consultations/contracts";
import { PHASE21_PREVIEW_CLEANUP_OPTIONS } from "./preview-budgets";
import { SYNTHETIC_FACTS } from "@/server/ai-consultations/tools";
export class Phase21CleanupError extends Error {
  constructor() {
    super("AI_PREVIEW_CLEANUP_DENIED");
    this.name = "Phase21CleanupError";
  }
}
export type Phase21CleanupReport = {
  residualAiRows: number;
  residualPrograms: number;
  residualClasses: number;
  manifestCleared: boolean;
};
/** IDs themselves prove run ownership; matching generic synthetic text alone is insufficient. */
export function assertPhase21OwnedManifest(
  value: unknown,
  runId: string,
): FixtureManifest {
  if (!runIdSchema.safeParse(runId).success) throw new Phase21CleanupError();
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Phase21CleanupError();
  const m = parsed.data;
  const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  const program = new RegExp("^ai-program-" + runId + "-" + uuid + "$");
  const schedule = new RegExp("^ai-class-" + runId + "-" + uuid + "$");
  const subject = new RegExp("^synthetic-" + runId.slice(8) + "-[a-f0-9]{12}$");
  if (
    m.programIds.length === 0 ||
    m.classIds.length === 0 ||
    m.programIds.some((id) => !program.test(id)) ||
    m.classIds.some((id) => !schedule.test(id)) ||
    m.subjectIds.some((id) => !subject.test(id)) ||
    [m.programIds, m.classIds, m.subjectIds].some(
      (ids) => new Set(ids).size !== ids.length,
    )
  )
    throw new Phase21CleanupError();
  return m;
}
async function aiRows(tx: Prisma.TransactionClient, runId: string) {
  const counts = await Promise.all([
    tx.aiConsultation.count({ where: { runId } }),
    tx.aiQuotaBucket.count({ where: { runId } }),
    tx.aiRetentionJob.count({ where: { runId } }),
    tx.aiKnowledgeEntry.count({ where: { runId } }),
    tx.aiClassPublication.count({ where: { runId } }),
    tx.aiProgramPublication.count({ where: { runId } }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}
/** Shared by fixture finally and outer wrapper. No keys needed, including old default runs. */
export async function cleanupPhase21PreviewRun(
  client: Pick<PrismaClient, "$transaction">,
  input: {
    runId: string;
    deploymentSha: string;
    expectedManifest?: FixtureManifest;
  },
): Promise<Phase21CleanupReport> {
  if (
    !runIdSchema.safeParse(input.runId).success ||
    !/^[a-f0-9]{40}$/.test(input.deploymentSha)
  )
    throw new Phase21CleanupError();
  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"phase21:" + input.runId},0))`;
      await tx.$queryRaw`SELECT "id" FROM "PreviewE2eRunLease" WHERE "runId"=${input.runId} FOR UPDATE`;
      const lease = await tx.previewE2eRunLease.findUnique({
        where: { runId: input.runId },
        select: { deploymentSha: true, aiFixtureManifest: true },
      });
      if (!lease || lease.deploymentSha !== input.deploymentSha)
        throw new Phase21CleanupError();
      if (lease.aiFixtureManifest === null) {
        const residual = await aiRows(tx, input.runId);
        const orphanPrograms = await tx.program.count({
          where: { id: { startsWith: "ai-program-" + input.runId + "-" } },
        });
        const orphanClasses = await tx.classSchedule.count({
          where: { id: { startsWith: "ai-class-" + input.runId + "-" } },
        });
        if (residual || orphanPrograms || orphanClasses)
          throw new Phase21CleanupError();
        return {
          residualAiRows: 0,
          residualPrograms: 0,
          residualClasses: 0,
          manifestCleared: false,
        };
      }
      const manifest = assertPhase21OwnedManifest(
        lease.aiFixtureManifest,
        input.runId,
      );
      if (
        input.expectedManifest &&
        JSON.stringify(manifest) !==
          JSON.stringify(
            assertPhase21OwnedManifest(input.expectedManifest, input.runId),
          )
      )
        throw new Phase21CleanupError();
      // ClassTeacher cascades on class deletion. Parent FOR UPDATE blocks concurrent
      // FK KEY SHARE insertion until this check and all deletes commit atomically.
      await tx.$queryRaw`SELECT "id" FROM "ClassSchedule" WHERE "id" IN (${Prisma.join([...manifest.classIds].sort())}) ORDER BY "id" FOR UPDATE`;
      if (await tx.classTeacher.count({where:{classScheduleId:{in:manifest.classIds}}}))
        throw new Phase21CleanupError();
      const [
        programs,
        classes,
        programPublications,
        classPublications,
        foreignOrigin,
      ] = await Promise.all([
        tx.program.findMany({
          where: { id: { in: manifest.programIds } },
          select: {
            id: true,
            name: true,
            description: true,
            targetAgeMin: true,
            targetAgeMax: true,
          },
        }),
        tx.classSchedule.findMany({
          where: { id: { in: manifest.classIds } },
          select: { id: true, programId: true, location: true },
        }),
        tx.aiProgramPublication.findMany({
          where: { runId: input.runId },
          select: { programId: true },
        }),
        tx.aiClassPublication.findMany({
          where: { runId: input.runId },
          select: { classScheduleId: true },
        }),
        tx.aiConsultation.count({
          where: { runId: input.runId, origin: { not: "SYNTHETIC" } },
        }),
      ]);
      if (
        foreignOrigin ||
        programs.some(
          (p) =>
            !manifest.programIds.includes(p.id) ||
            p.name !== SYNTHETIC_FACTS.name ||
            p.description !== SYNTHETIC_FACTS.description ||
            p.targetAgeMin !== 5 ||
            p.targetAgeMax !== 8,
        ) ||
        classes.some(
          (c) =>
            !manifest.classIds.includes(c.id) ||
            !manifest.programIds.includes(c.programId) ||
            c.location !== SYNTHETIC_FACTS.location,
        ) ||
        programPublications.some(
          (p) => !manifest.programIds.includes(p.programId),
        ) ||
        classPublications.some(
          (c) => !manifest.classIds.includes(c.classScheduleId),
        )
      )
        throw new Phase21CleanupError();
      await tx.aiConsultation.deleteMany({
        where: { runId: input.runId, origin: "SYNTHETIC" },
      });
      await tx.aiQuotaBucket.deleteMany({ where: { runId: input.runId } });
      await tx.aiRetentionJob.deleteMany({ where: { runId: input.runId } });
      await tx.aiKnowledgeEntry.deleteMany({ where: { runId: input.runId } });
      await tx.aiClassPublication.deleteMany({ where: { runId: input.runId } });
      await tx.aiProgramPublication.deleteMany({
        where: { runId: input.runId },
      });
      await tx.classSchedule.deleteMany({
        where: {
          id: { in: manifest.classIds },
          programId: { in: manifest.programIds },
          location: SYNTHETIC_FACTS.location,
        },
      });
      await tx.program.deleteMany({
        where: { id: { in: manifest.programIds }, name: SYNTHETIC_FACTS.name },
      });
      const residualAiRows = await aiRows(tx, input.runId);
      const residualPrograms = await tx.program.count({
        where: { id: { in: manifest.programIds } },
      });
      const residualClasses = await tx.classSchedule.count({
        where: { id: { in: manifest.classIds } },
      });
      if (residualAiRows || residualPrograms || residualClasses)
        throw new Phase21CleanupError();
      // Ownership proof survives every failure because this transaction rolls back as a whole.
      await tx.previewE2eRunLease.update({
        where: { runId: input.runId },
        data: { aiFixtureManifest: Prisma.DbNull },
      });
      return {
        residualAiRows,
        residualPrograms,
        residualClasses,
        manifestCleared: true,
      };
    }, PHASE21_PREVIEW_CLEANUP_OPTIONS);
  } catch {
    throw new Phase21CleanupError();
  }
}
