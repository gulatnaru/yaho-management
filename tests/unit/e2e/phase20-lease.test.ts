import { describe, expect, it, vi } from "vitest";
import { encodeSignedPreviewRun, hasActivePhase20PreviewLease, parseAndVerifySignedPreviewRun, PHASE20_PREVIEW_MAX_AGE_MS, signPreviewRun } from "@/lib/e2e/phase20-lease";
import { runtimeDatabaseIdentityFingerprint } from "@/lib/e2e/preview-safety";

const SHA = "a".repeat(40);
const SECRET = "test-preview-handshake-secret";
const NOW = 1_790_000_000_000;
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA, PREVIEW_E2E_HANDSHAKE_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;

describe("Phase 20 Preview intake lease", () => {
  it("accepts only a fresh signed exact deployment run", () => {
    const runId = "preview-abcdefghijklmnopqrstuv";
    const signature = signPreviewRun(runId, SHA, NOW, SECRET);
    const encoded = encodeSignedPreviewRun({ runId, deploymentSha: SHA, issuedAt: NOW, signature });
    expect(parseAndVerifySignedPreviewRun(encoded, environment, NOW)).toEqual({ runId, deploymentSha: SHA, issuedAt: NOW });
    expect(parseAndVerifySignedPreviewRun(encoded.replace(runId, "preview-vutsrqponmlkjihgfedcba"), environment, NOW)).toBeNull();
    expect(parseAndVerifySignedPreviewRun(encoded, environment, NOW + PHASE20_PREVIEW_MAX_AGE_MS + 1)).toBeNull();
  });

  it("requires the lease to match both signed run and synthetic group", async () => {
    const findUnique = vi.fn().mockResolvedValue({ deploymentSha: SHA, expiresAt: new Date(NOW + 60_000) });
    const identity = { database: "preview", currentUser: "role", currentSchema: "public" };
    const runtime = { VERCEL_ENV: "preview", DATABASE_URL: "postgresql://role@db.abcdefgh.supabase.co/preview", PREVIEW_E2E_SUPABASE_PROJECT_REF: "abcdefgh", PREVIEW_E2E_DB_RUNTIME_IDENTITY_SHA256: runtimeDatabaseIdentityFingerprint(identity, "abcdefgh") } as unknown as NodeJS.ProcessEnv;
    const $queryRaw = vi.fn().mockResolvedValueOnce([identity]).mockResolvedValueOnce([{ held: true }]);
    const signed = { runId: "preview-abcdefghijklmnopqrstuv", deploymentSha: SHA, issuedAt: NOW };
    await expect(hasActivePhase20PreviewLease({ previewE2eRunLease: { findUnique }, $queryRaw } as never, { signed, syntheticRunId: signed.runId, now: new Date(NOW), environment: runtime })).resolves.toBe(true);
    await expect(hasActivePhase20PreviewLease({ previewE2eRunLease: { findUnique }, $queryRaw } as never, { signed, syntheticRunId: "other", now: new Date(NOW), environment: runtime })).resolves.toBe(false);
  });
});
