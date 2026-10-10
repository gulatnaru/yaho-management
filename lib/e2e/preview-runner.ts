import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  assertApprovedSupabaseProjectRef,
  assertApprovedPreviewUrl,
  assertApprovedRuntimeDatabaseIdentity,
  assertPreviewMigrationState,
  prismaSchemaTargetFromDatabaseUrl,
  createPreviewE2eRunId,
  PreviewE2eSafetyError,
  type PrismaMigrationRow,
  type RuntimeDatabaseIdentity,
} from "./preview-safety";
import { PHASE20_PREVIEW_LOCK_KEY } from "./phase20-lease";

export const PREVIEW_E2E_TEST_FILES = [
  "tests/e2e/auth.spec.ts",
  "tests/e2e/phase6-access.spec.ts",
  "tests/e2e/phase11-core-operations.spec.ts",
  "tests/e2e/phase20-application-group-siblings.spec.ts",
  "tests/e2e/phase20-application-finance-returns.spec.ts",
  "tests/e2e/phase20-companion-repeat-privacy.spec.ts",
  "tests/e2e/phase20-postgres-races.spec.ts",
] as const;

export const PREVIEW_E2E_LOCK_KEY = PHASE20_PREVIEW_LOCK_KEY;
// Hard whole-run limit, not a promise that every per-case maximum fits.
// Phase20 browser positives are bounded at 180s/240s/420s; each PostgreSQL
// race case remains bounded at 180s. The unchanged global deadline may
// interrupt a worst-case suite and still leaves cleanup within the 25m lock.
export const PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS = 22 * 60 * 1000;
// The outer transaction adds two 60-second cleanup phases and one startup
// minute. It must exceed Playwright's global timeout rather than equal it.
export const PREVIEW_E2E_LOCK_TIMEOUT_MS = 25 * 60 * 1000;

/** Node runs the Playwright CLI on every platform; this avoids Windows .cmd spawn semantics. */
export function playwrightCliPath(workspace = process.cwd()) {
  return path.resolve(workspace, "node_modules/playwright/cli.js");
}

type RunnerEnvironment = NodeJS.ProcessEnv;

export type PreviewE2eConfiguration = {
  baseUrl: string;
  databaseUrl: string;
  directUrl: string;
  previewProjectRef: string;
  productionProjectRef: string;
  approvedRuntimeFingerprint: string;
  databaseSchema: string;
  directSchema: string;
  handshakeSecret: string;
  bypassSecret: string;
  deploymentSha: string;
  runId: string;
};

export type PreviewIdentityResponse = {
  fingerprint: string;
  deploymentSha: string;
};

export function assertDeploymentMatchesRepository({
  deploymentSha,
  head = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  migrationStatus = () => execFileSync("git", ["status", "--porcelain", "--", "prisma/migrations"], { encoding: "utf8" }).trim(),
}: {
  deploymentSha: string;
  head?: () => string;
  migrationStatus?: () => string;
}): void {
  let localHead: string;
  let dirtyMigrations: string;
  try {
    localHead = head();
    dirtyMigrations = migrationStatus();
  } catch {
    throw new PreviewE2eSafetyError("REPOSITORY_IDENTITY_UNKNOWN", "Preview E2E repository identity could not be verified");
  }
  if (!/^[a-f0-9]{40}$/i.test(deploymentSha) || !/^[a-f0-9]{40}$/i.test(localHead) || localHead.toLowerCase() !== deploymentSha.toLowerCase()) {
    throw new PreviewE2eSafetyError("DEPLOYMENT_REPOSITORY_MISMATCH", "Preview deployment does not match the local repository commit");
  }
  if (dirtyMigrations) {
    throw new PreviewE2eSafetyError("DIRTY_MIGRATIONS", "Preview E2E refuses changed or untracked Prisma migrations");
  }
}

export type PreviewDatabaseSession = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export type PreviewDatabaseClient = PreviewDatabaseSession & {
  $transaction<T>(
    callback: (transaction: PreviewDatabaseSession) => Promise<T>,
    options: { maxWait: number; timeout: number },
  ): Promise<T>;
};

function required(environment: RunnerEnvironment, name: keyof RunnerEnvironment): string {
  const value = environment[name];
  if (!value) throw new PreviewE2eSafetyError("MISSING_ENVIRONMENT", `Preview E2E requires ${name}`);
  return value;
}

export function readPreviewE2eConfiguration(
  environment: RunnerEnvironment = process.env,
  uuid: () => string = randomUUID,
): PreviewE2eConfiguration {
  const baseUrl = assertApprovedPreviewUrl(
    environment.PLAYWRIGHT_BASE_URL,
    environment.PREVIEW_E2E_ALLOWED_BASE_URLS,
  );
  const deploymentSha = required(environment, "PREVIEW_E2E_DEPLOYMENT_SHA");
  if (!/^[a-f0-9]{40}$/i.test(deploymentSha)) {
    throw new PreviewE2eSafetyError("INVALID_DEPLOYMENT_SHA", "Preview E2E deployment SHA is invalid");
  }
  const databaseUrl = required(environment, "DATABASE_URL");
  const directUrl = required(environment, "DIRECT_URL");
  const previewProjectRef = required(environment, "PREVIEW_E2E_SUPABASE_PROJECT_REF");
  const productionProjectRef = required(environment, "PRODUCTION_E2E_SUPABASE_PROJECT_REF");
  if (previewProjectRef.toLowerCase() === productionProjectRef.toLowerCase()) {
    throw new PreviewE2eSafetyError("PREVIEW_PRODUCTION_PROJECT_EQUAL", "Preview E2E Preview and Production projects must differ");
  }
  assertApprovedSupabaseProjectRef({
    databaseUrl,
    expectedProjectRef: previewProjectRef,
    productionProjectRef,
  });
  const databaseSchema = prismaSchemaTargetFromDatabaseUrl(databaseUrl);
  const directSchema = prismaSchemaTargetFromDatabaseUrl(directUrl);
  assertApprovedSupabaseProjectRef({
    databaseUrl: directUrl,
    expectedProjectRef: previewProjectRef,
    productionProjectRef,
  });
  return {
    baseUrl,
    databaseUrl,
    directUrl,
    previewProjectRef,
    productionProjectRef,
    approvedRuntimeFingerprint: required(environment, "PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256"),
    databaseSchema,
    directSchema,
    handshakeSecret: required(environment, "PREVIEW_E2E_HANDSHAKE_SECRET"),
    bypassSecret: required(environment, "VERCEL_AUTOMATION_BYPASS_SECRET"),
    deploymentSha,
    runId: createPreviewE2eRunId(uuid),
  };
}

export async function readRuntimeDatabaseIdentity(client: PreviewDatabaseClient): Promise<RuntimeDatabaseIdentity> {
  const rows = await client.$queryRaw<RuntimeDatabaseIdentity[]>`
    SELECT current_database() AS database, current_user AS "currentUser", current_schema() AS "currentSchema"
  `;
  const identity = rows[0];
  if (!identity) {
    throw new PreviewE2eSafetyError("DATABASE_IDENTITY_UNKNOWN", "Preview E2E database identity could not be verified");
  }
  return identity;
}

export async function assertPreviewDatabasePreflight({
  databaseClient,
  directClient,
  approvedRuntimeFingerprint,
  previewProjectRef,
  databaseSchema,
  directSchema,
  migrationRoot,
}: {
  databaseClient: PreviewDatabaseClient;
  directClient: PreviewDatabaseClient;
  approvedRuntimeFingerprint: string;
  previewProjectRef: string;
  databaseSchema: string;
  directSchema: string;
  migrationRoot: string;
}): Promise<void> {
  const [databaseIdentity, directIdentity] = await Promise.all([
    readRuntimeDatabaseIdentity(databaseClient),
    readRuntimeDatabaseIdentity(directClient),
  ]);
  assertApprovedRuntimeDatabaseIdentity(databaseIdentity, previewProjectRef, approvedRuntimeFingerprint, databaseSchema);
  assertApprovedRuntimeDatabaseIdentity(directIdentity, previewProjectRef, approvedRuntimeFingerprint, directSchema);
  const rows = await directClient.$queryRaw<PrismaMigrationRow[]>`
    SELECT "migration_name", "checksum", "finished_at", "rolled_back_at"
    FROM "_prisma_migrations"
    ORDER BY "started_at" ASC
  `;
  assertPreviewMigrationState({ migrationRoot, rows });
}

/** A random proof file makes accidental direct Preview Playwright invocation fail before specs load. */
export function assertPreviewE2eRunnerProof({
  proofPath,
  proof,
}: {
  proofPath: string | undefined;
  proof: string | undefined;
}): void {
  if (!proofPath || !proof) {
    throw new PreviewE2eSafetyError("RUNNER_PROOF_MISSING", "Preview E2E must be started with npm run test:e2e:preview");
  }
  let storedProof: string;
  try {
    storedProof = readFileSync(proofPath, "utf8");
  } catch {
    throw new PreviewE2eSafetyError("RUNNER_PROOF_MISSING", "Preview E2E must be started with npm run test:e2e:preview");
  }
  if (storedProof !== proof) {
    throw new PreviewE2eSafetyError("RUNNER_PROOF_INVALID", "Preview E2E runner proof is invalid");
  }
}

export function assertPreviewIdentityResponse(
  response: PreviewIdentityResponse,
  configuration: Pick<PreviewE2eConfiguration, "approvedRuntimeFingerprint" | "deploymentSha">,
): void {
  if (!/^[a-f0-9]{64}$/i.test(response.fingerprint)) {
    throw new PreviewE2eSafetyError("APP_IDENTITY_UNKNOWN", "Preview app database identity could not be verified");
  }
  if (response.fingerprint.toLowerCase() !== configuration.approvedRuntimeFingerprint.toLowerCase()) {
    throw new PreviewE2eSafetyError("APP_DATABASE_MISMATCH", "Preview app is not connected to the approved Preview database");
  }
  if (response.deploymentSha !== configuration.deploymentSha) {
    throw new PreviewE2eSafetyError("DEPLOYMENT_SHA_MISMATCH", "Preview app deployment does not match the requested commit");
  }
}

/**
 * The advisory lock lives in one interactive Prisma transaction for the whole
 * child process. PostgreSQL releases it on normal completion, transaction loss,
 * or disconnect. A heartbeat terminates the child if that transaction dies early.
 */
export async function withPreviewDatabaseLock<T>({
  client,
  run,
  onSessionLost,
  heartbeatMs = 5_000,
}: {
  client: PreviewDatabaseClient;
  run: () => Promise<T>;
  onSessionLost: () => void;
  heartbeatMs?: number;
}): Promise<T> {
  return client.$transaction(async (transaction) => {
    const lock = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${PREVIEW_E2E_LOCK_KEY}::bigint) AS acquired
    `;
    if (!lock[0]?.acquired) {
      throw new PreviewE2eSafetyError("CONCURRENT_E2E", "Another Preview E2E run already holds this Preview database lock");
    }

    let sessionLost = false;
    const heartbeat = setInterval(() => {
      void transaction.$queryRaw`SELECT 1`.catch(() => {
        if (!sessionLost) {
          sessionLost = true;
          onSessionLost();
        }
      });
    }, heartbeatMs);

    try {
      const result = await run();
      if (sessionLost) {
        throw new PreviewE2eSafetyError("LOCK_SESSION_LOST", "Preview E2E database lock session was lost");
      }
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }, { maxWait: 10_000, timeout: PREVIEW_E2E_LOCK_TIMEOUT_MS });
}
