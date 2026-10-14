import { createHash, createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  AiDenied,
  manifestSchema,
  runIdSchema,
  type Scope,
} from "@/lib/ai-consultations/contracts";
import {
  equalHash,
  readKeys,
  type Keyring,
} from "@/lib/ai-consultations/crypto";
import { assertApprovedSupabaseProjectRef } from "@/lib/e2e/preview-safety";
import { hasActivePhase20PreviewLease } from "@/lib/e2e/phase20-lease";
export const AI_MIGRATION = "20261014090000_phase21_ai_consultations_mock";
export const AI_PROOF_HEADER = "x-yaho-ai-mock-proof";
export function assertMockEnvironment(env: NodeJS.ProcessEnv) {
  if (
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL !== "1" ||
    !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
  )
    throw new AiDenied();
  if (
    !env.PRODUCTION_E2E_SUPABASE_PROJECT_REF ||
    env.PRODUCTION_E2E_SUPABASE_PROJECT_REF ===
      env.PREVIEW_E2E_SUPABASE_PROJECT_REF
  )
    throw new AiDenied();
  try {
    for (const url of [env.DATABASE_URL, env.DIRECT_URL])
      assertApprovedSupabaseProjectRef({
        databaseUrl: url,
        expectedProjectRef: env.PREVIEW_E2E_SUPABASE_PROJECT_REF,
        productionProjectRef: env.PRODUCTION_E2E_SUPABASE_PROJECT_REF,
      });
  } catch {
    throw new AiDenied();
  }
}
export function manifestDigest(manifest: Scope["manifest"]) {
  return createHash("sha256")
    .update(JSON.stringify(manifestSchema.parse(manifest)))
    .digest("hex");
}
export function proofSignature(
  keys: Keyring,
  input: {
    runId: string;
    sha: string;
    issued: number;
    manifestHash: string;
    purpose: string;
    body: string;
  },
) {
  return createHmac("sha256", keys.auth)
    .update(
      JSON.stringify([
        "PHASE21_MOCK",
        input.runId,
        input.sha,
        input.issued,
        input.manifestHash,
        input.purpose,
        createHash("sha256").update(input.body).digest("hex"),
      ]),
    )
    .digest("base64url");
}
export function verifyProof(
  value: string | null,
  body: string,
  purpose: string,
  env: NodeJS.ProcessEnv,
  now: Date,
) {
  assertMockEnvironment(env);
  const keys = readKeys(env);
  if (!value || value.length > 400) throw new AiDenied();
  const [runId, sha, time, manifestHash, signature, ...rest] = value.split(".");
  const issued = Number(time);
  if (
    rest.length ||
    !runIdSchema.safeParse(runId).success ||
    sha !== env.VERCEL_GIT_COMMIT_SHA ||
    !Number.isSafeInteger(issued) ||
    Math.abs(now.getTime() - issued) > 60000 ||
    !/^[a-f0-9]{64}$/.test(manifestHash ?? "") ||
    !signature
  )
    throw new AiDenied();
  if (
    !equalHash(
      signature,
      proofSignature(keys, { runId, sha, issued, manifestHash, purpose, body }),
    )
  )
    throw new AiDenied();
  return { runId, sha, issued, manifestHash, keys };
}
export async function authorizeScope(
  client: PrismaClient,
  proof: ReturnType<typeof verifyProof>,
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<Scope> {
  assertMockEnvironment(env);
  try {
    return await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '400ms'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        const active = await hasActivePhase20PreviewLease(
          tx as unknown as Pick<
            PrismaClient,
            "previewE2eRunLease" | "$queryRaw"
          >,
          {
            signed: {
              runId: proof.runId,
              deploymentSha: proof.sha,
              issuedAt: proof.issued,
            },
            syntheticRunId: proof.runId,
            now,
            environment: env,
          },
        );
        if (!active) throw new AiDenied();
        const lease = await tx.previewE2eRunLease.findUnique({
          where: { runId: proof.runId },
          select: { aiFixtureManifest: true },
        });
        const manifest = manifestSchema.parse(lease?.aiFixtureManifest);
        if (manifestDigest(manifest) !== proof.manifestHash)
          throw new AiDenied();
        const migrations = await tx.$queryRaw<
          Array<{
            migration_name: string;
            finished_at: Date | null;
            rolled_back_at: Date | null;
          }>
        >`SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"`;
        if (
          !migrations.some(
            (x) =>
              x.migration_name === AI_MIGRATION &&
              x.finished_at &&
              !x.rolled_back_at,
          ) ||
          migrations.some((x) => !x.finished_at && !x.rolled_back_at)
        )
          throw new AiDenied();
        return { runId: proof.runId, deploymentSha: proof.sha, manifest };
      },
      { maxWait: 100, timeout: 450 },
    );
  } catch {
    throw new AiDenied();
  }
}
export async function readBoundedBody(request: Request, signal: AbortSignal) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 16384))
    throw new AiDenied();
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AiDenied();
  const reader = request.body?.getReader();
  if (!reader) throw new AiDenied();
  const parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new AiDenied();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new AiDenied();
      }
      parts.push(value);
    }
    if (signal.aborted) throw new AiDenied();
    return Buffer.concat(parts).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
