import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  assertPreviewE2eRunnerProof,
  readPreviewE2eConfiguration,
  assertPreviewDatabasePreflight,
} from "@/lib/e2e/preview-runner";
import {
  hasActivePhase20PreviewLease,
  parseAndVerifySignedPreviewRun,
} from "@/lib/e2e/phase20-lease";
import {
  type Scope,
  manifestSchema,
  runIdSchema,
} from "@/lib/ai-consultations/contracts";
import { readKeys } from "@/lib/ai-consultations/crypto";
import { SYNTHETIC_FACTS } from "@/server/ai-consultations/tools";
import {
  manifestDigest,
  proofSignature,
  AI_MIGRATION,
} from "@/server/ai-consultations/runtime";
import {
  cleanupPhase21PreviewRun,
  assertPhase21OwnedManifest,
} from "@/lib/e2e/phase21-cleanup";
export { syntheticSkill } from "./phase21-scenarios";
/** Fixed optional Preview suite; execution still requires separate approval. */
export async function phase21Fixture() {
  if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1")
    throw new Error("AI_PREVIEW_RUNNER_REQUIRED");
  assertPreviewE2eRunnerProof({
    proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH,
    proof: process.env.PREVIEW_E2E_RUNNER_PROOF,
  });
  const config = {
    ...readPreviewE2eConfiguration(),
    runId: runIdSchema.parse(process.env.YAHO_E2E_RUN_ID),
  };
  const keys = readKeys(process.env);
  const db = new PrismaClient();
  const direct = new PrismaClient({ datasourceUrl: config.directUrl });
  try {
    await assertPreviewDatabasePreflight({
      databaseClient: db,
      directClient: direct,
      approvedRuntimeFingerprint: config.approvedRuntimeFingerprint,
      previewProjectRef: config.previewProjectRef,
      databaseSchema: config.databaseSchema,
      directSchema: config.directSchema,
      migrationRoot: path.resolve("prisma/migrations"),
    });
    await direct.$disconnect();
    const signed = parseAndVerifySignedPreviewRun(
      process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null,
      {
        ...process.env,
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: config.deploymentSha,
      },
    );
    if (
      !signed ||
      !(await hasActivePhase20PreviewLease(db, {
        signed,
        syntheticRunId: config.runId,
        now: new Date(),
        environment: { ...process.env, VERCEL_ENV: "preview" },
      }))
    )
      throw new Error("AI_LEASE_REQUIRED");
    const applied = await db.$queryRaw<
      Array<{
        ok: boolean;
      }>
    >`SELECT EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE migration_name=${AI_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok`;
    if (!applied[0]?.ok) throw new Error("AI_MIGRATION_UNAPPLIED");
    const owned: Scope = {
      runId: config.runId,
      deploymentSha: config.deploymentSha,
      manifest: manifestSchema.parse({
        version: 1,
        programIds: ["ai-program-" + config.runId + "-" + randomUUID()],
        classIds: ["ai-class-" + config.runId + "-" + randomUUID()],
        subjectIds: Array.from(
          { length: 3 },
          () =>
            "synthetic-" +
            config.runId.slice(8) +
            "-" +
            randomUUID().replaceAll("-", "").slice(0, 12),
        ),
      }),
    };
    assertPhase21OwnedManifest(owned.manifest, owned.runId);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PreviewE2eRunLease" WHERE "runId"=${owned.runId} FOR UPDATE`;
      const existing = await tx.previewE2eRunLease.findUnique({
        where: { runId: owned.runId },
        select: { aiFixtureManifest: true },
      });
      if (!existing || existing.aiFixtureManifest !== null)
        throw new Error("AI_FIXTURE_ALREADY_OWNED");
      await tx.previewE2eRunLease.update({
        where: { runId: owned.runId },
        data: { aiFixtureManifest: owned.manifest },
      });
      await tx.program.create({
        data: {
          id: owned.manifest.programIds[0],
          name: SYNTHETIC_FACTS.name,
          description: SYNTHETIC_FACTS.description,
          targetAgeMin: 5,
          targetAgeMax: 8,
        },
      });
      await tx.classSchedule.create({
        data: {
          id: owned.manifest.classIds[0],
          programId: owned.manifest.programIds[0],
          startsAt: new Date(Date.now() + 86400000),
          endsAt: new Date(Date.now() + 90000000),
          location: SYNTHETIC_FACTS.location,
        },
      });
      // Only this run's newly-created synthetic records are explicitly opted in.
      await tx.aiProgramPublication.create({data:{runId:owned.runId,programId:owned.manifest.programIds[0],enabled:true,updatedById:"synthetic-runner"}});
      await tx.aiClassPublication.create({data:{runId:owned.runId,classScheduleId:owned.manifest.classIds[0],enabled:true,updatedById:"synthetic-runner"}});
    });
    return {
      db,
      scope: owned,
      keys,
      async cleanup() {
        try {
          return await cleanupPhase21PreviewRun(db, {
            runId: owned.runId,
            deploymentSha: owned.deploymentSha,
            expectedManifest: owned.manifest,
          });
        } finally {
          await db.$disconnect();
        }
      },
    };
  } catch {
    await direct.$disconnect();
    await db.$disconnect();
    throw new Error("AI_PREVIEW_FIXTURE_DENIED");
  }
}
export function skillProof(
  f: Awaited<ReturnType<typeof phase21Fixture>>,
  body: string,
  purpose = "POST:/api/ai-consultations/mock-skill",
) {
  const input = {
    runId: f.scope.runId,
    sha: f.scope.deploymentSha,
    issued: Date.now(),
    manifestHash: manifestDigest(f.scope.manifest),
    purpose,
    body,
  };
  return [
    input.runId,
    input.sha,
    input.issued,
    input.manifestHash,
    proofSignature(f.keys, input),
  ].join(".");
}
