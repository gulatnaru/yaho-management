import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertApprovedRuntimeDatabaseIdentity, assertApprovedSupabaseProjectRef, prismaSchemaTargetFromDatabaseUrl, type RuntimeDatabaseIdentity } from "@/lib/e2e/preview-safety";

export const PHASE20_PREVIEW_HEADER = "x-yaho-phase20-preview-run";
// One signed request remains valid only for the bounded Preview run lifetime.
// Signature/lease cover the 22-minute browser budget; cleanup runs after
// public requests end and does not need an intake capability.
export const PHASE20_PREVIEW_MAX_AGE_MS = 24 * 60 * 1000;
/** Shared with the runner; keep the signed public-intake guard bound to its exact xact lock. */
export const PHASE20_PREVIEW_LOCK_KEY = 8_271_903_119n;
export const PHASE20_PREVIEW_RUN_ID_PATTERN = /^preview-[A-Za-z0-9_-]{22}$/;

export type SignedPreviewRun = { runId: string; deploymentSha: string; issuedAt: number; signature: string };

function payload(runId: string, deploymentSha: string, issuedAt: number) {
  return `${runId}.${deploymentSha}.${issuedAt}`;
}

export function signPreviewRun(runId: string, deploymentSha: string, issuedAt: number, secret: string): string {
  return createHmac("sha256", secret).update(payload(runId, deploymentSha, issuedAt)).digest("base64url");
}

export function encodeSignedPreviewRun(run: SignedPreviewRun): string {
  return `${run.runId}.${run.deploymentSha}.${run.issuedAt}.${run.signature}`;
}

export function parseAndVerifySignedPreviewRun(value: string | null, environment: NodeJS.ProcessEnv, now = Date.now()): Omit<SignedPreviewRun, "signature"> | null {
  if (environment.VERCEL_ENV !== "preview" || !environment.PREVIEW_E2E_HANDSHAKE_SECRET || !environment.VERCEL_GIT_COMMIT_SHA || !value) return null;
  const pieces = value.split(".");
  if (pieces.length !== 4) return null;
  const [runId, deploymentSha, issuedAtText, signature] = pieces;
  const issuedAt = Number(issuedAtText);
  if (!PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId) || !/^[a-f0-9]{40}$/i.test(deploymentSha) || !Number.isSafeInteger(issuedAt) || !Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > PHASE20_PREVIEW_MAX_AGE_MS || deploymentSha !== environment.VERCEL_GIT_COMMIT_SHA) return null;
  const expected = signPreviewRun(runId, deploymentSha, issuedAt, environment.PREVIEW_E2E_HANDSHAKE_SECRET);
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  return { runId, deploymentSha, issuedAt };
}

/** A valid signature is still insufficient: the matching short lease and synthetic group must exist. */
export async function hasActivePhase20PreviewLease(
  client: Pick<PrismaClient, "previewE2eRunLease" | "$queryRaw">,
  input: { signed: Omit<SignedPreviewRun, "signature"> | null; syntheticRunId: string | null; now: Date; environment?: NodeJS.ProcessEnv },
): Promise<boolean> {
  const environment = input.environment ?? process.env;
  if (environment.VERCEL_ENV !== "preview" || !input.signed || !PHASE20_PREVIEW_RUN_ID_PATTERN.test(input.signed.runId) || input.syntheticRunId !== input.signed.runId) return false;
  try {
    const projectRef = assertApprovedSupabaseProjectRef({ databaseUrl: environment.DATABASE_URL, expectedProjectRef: environment.PREVIEW_E2E_SUPABASE_PROJECT_REF });
    const identityRows = await client.$queryRaw<RuntimeDatabaseIdentity[]>`SELECT current_database() AS database, current_user AS "currentUser", current_schema() AS "currentSchema"`;
    const identity = identityRows[0];
    if (!identity) return false;
    assertApprovedRuntimeDatabaseIdentity(identity, projectRef, environment.PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256, prismaSchemaTargetFromDatabaseUrl(environment.DATABASE_URL));
  } catch { return false; }
  const lease = await client.previewE2eRunLease.findUnique({
    where: { runId: input.signed.runId },
    select: { deploymentSha: true, expiresAt: true },
  });
  if (!lease || lease.deploymentSha !== input.signed.deploymentSha || lease.expiresAt <= input.now) return false;
  // Do not probe by acquiring a session lock: pooled Prisma queries could acquire and
  // release on different connections. pg_locks is read-only and observes the runner's
  // xact advisory lock without creating a new lock.
  const locks = await client.$queryRaw<Array<{ held: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = ((${PHASE20_PREVIEW_LOCK_KEY} >> 32)::bigint)::oid
        AND objid = ((${PHASE20_PREVIEW_LOCK_KEY} & 4294967295)::bigint)::oid
        AND objsubid = 1
        AND mode = 'ExclusiveLock'
    ) AS held
  `;
  return locks[0]?.held === true;
}
