import {evaluateAiServicePreviewMigration,previewMigrationScope} from "./ai-service-preview-migration-policy";
import { execFile } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {readPreviewLocalEnvironment,previewPrismaEnvironment} from "@/lib/e2e/preview-environment";
import { PrismaClient } from "@prisma/client";
import { readPreviewE2eConfiguration, readRuntimeDatabaseIdentity, withPreviewDatabaseLock } from "@/lib/e2e/preview-runner";
import { assertApprovedRuntimeDatabaseIdentity, PreviewE2eSafetyError, type PrismaMigrationRow } from "@/lib/e2e/preview-safety";
import { evaluateMigrationState, listRepositoryMigrations, assertPostMigrationState, ProductionMigrationError } from "../release/production-migration";
import { AI_MIGRATION } from "@/server/ai-consultations/runtime";

export type PreviewMigrationStage = "preflight" | "deploy" | "verify";
export function previewMigrationStage(value: string | undefined): PreviewMigrationStage {
  if (value !== "preflight" && value !== "deploy" && value !== "verify") throw new Error("PREVIEW_MIGRATION_STAGE_DENIED");
  return value;
}
/** Uses only the shared pure checksum/history evaluator, never Production configuration or clients. */
export function evaluatePhase21PreviewMigration(rows: PrismaMigrationRow[], migrationRoot: string) {
  const active = rows.filter(row => row.rolled_back_at === null);
  if (new Set(active.map(row => row.migration_name)).size !== active.length) throw new Error("PREVIEW_MIGRATION_DUPLICATE_HISTORY");
  return evaluateMigrationState({ repositoryMigrations:listRepositoryMigrations(migrationRoot), rows, expectedMigrations:[AI_MIGRATION], migrationRoot });
}
/** Captures Prisma output: connection credentials and raw diagnostics never reach stdout. */
export function runPreviewPrisma(command: "deploy" | "status", directUrl: string, signal?: AbortSignal, runner: typeof execFile = execFile) {
  return new Promise<void>((resolve,reject) => {
    runner(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", command, "--schema", path.resolve("prisma/schema.prisma")], {
      env:previewPrismaEnvironment(directUrl,process.env), timeout:120_000, maxBuffer:1024*1024, signal,
    }, (error) => error ? reject(new Error("PREVIEW_MIGRATION_PRISMA_FAILED")) : resolve());
  });
}
async function main() {
  const stage = previewMigrationStage(process.argv[2]);
  const scope = previewMigrationScope(process.env.PREVIEW_MIGRATION_SCOPE);
  if(scope==="AI_SERVICE"&&process.env.AI_SERVICE_PREVIEW_MIGRATION_APPROVED!=="1")throw new Error("AI_SERVICE_MIGRATION_APPROVAL_REQUIRED");
  const source = process.env.PHASE21_ENV_SOURCE_DIR;
  const approvedRef = process.env.PHASE21_APPROVED_PREVIEW_PROJECT_REF;
  const deniedRef = process.env.PHASE21_DENIED_PRODUCTION_PROJECT_REF;
  if (!source || !path.isAbsolute(source) || !existsSync(path.join(source,".env.local"))) throw new Error("PREVIEW_MIGRATION_SOURCE_REQUIRED");
  const environment=readPreviewLocalEnvironment(source);
  // The operator must separately attest the documented nonproduction-only approval.
  if (process.env.PHASE21_PREVIEW_MIGRATION_APPROVED !== "1") throw new Error("PREVIEW_MIGRATION_APPROVAL_REQUIRED");
  const config = readPreviewE2eConfiguration(environment);
  if (!approvedRef || !deniedRef || approvedRef===deniedRef || config.previewProjectRef!==approvedRef || config.productionProjectRef!==deniedRef) throw new Error("PREVIEW_MIGRATION_TARGET_DENIED");
  if (process.env.VERCEL_ENV === "production") throw new Error("PREVIEW_MIGRATION_PRODUCTION_DENIED");
  const db = new PrismaClient({datasourceUrl:config.databaseUrl});
  const direct = new PrismaClient({datasourceUrl:config.directUrl});
  const migrationRoot = path.resolve("prisma/migrations");
  try {
    const identities = await Promise.all([readRuntimeDatabaseIdentity(db), readRuntimeDatabaseIdentity(direct)]);
    assertApprovedRuntimeDatabaseIdentity(identities[0],config.previewProjectRef,config.approvedRuntimeFingerprint,config.databaseSchema);
    assertApprovedRuntimeDatabaseIdentity(identities[1],config.previewProjectRef,config.approvedRuntimeFingerprint,config.directSchema);
    const inspect = async () => (scope==="AI_SERVICE"?evaluateAiServicePreviewMigration:evaluatePhase21PreviewMigration)(await direct.$queryRaw<PrismaMigrationRow[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`,migrationRoot);
    let state = await inspect();
    if (stage === "preflight") {
      console.log(JSON.stringify({stage,result:"PASS",target:"APPROVED_PREVIEW",pending:state.pendingMigrations,appliedCount:state.appliedMigrations.length}));
      return;
    }
    if (stage === "deploy") {
      const controller = new AbortController();
      await withPreviewDatabaseLock({client:direct,onSessionLost:() => controller.abort(),run:async () => {
        state = await inspect();
        if (state.deployRequired) await runPreviewPrisma("deploy",config.directUrl,controller.signal);
        state = await inspect();
        assertPostMigrationState(state,"POST_DEPLOY_PENDING");
      }});
    } else {
      await runPreviewPrisma("status",config.directUrl);
      assertPostMigrationState(state,"POST_STATUS_PENDING");
    }
    console.log(JSON.stringify({stage,result:"PASS",target:"APPROVED_PREVIEW",pending:state.pendingMigrations,appliedCount:state.appliedMigrations.length}));
  } finally {
    await Promise.all([db.$disconnect(),direct.$disconnect()]);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error:unknown) => {
    const code = error instanceof PreviewE2eSafetyError || error instanceof ProductionMigrationError ? error.code : error instanceof Error && /^PREVIEW_MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "PREVIEW_MIGRATION_FAILED";
    console.error(JSON.stringify({result:"FAIL",code}));
    process.exitCode=1;
  });
}
