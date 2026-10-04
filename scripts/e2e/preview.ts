import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  assertPreviewDatabasePreflight,
  assertDeploymentMatchesRepository,
  assertPreviewIdentityResponse,
  PREVIEW_E2E_TEST_FILES,
  playwrightCliPath,
  readPreviewE2eConfiguration,
  withPreviewDatabaseLock,
} from "@/lib/e2e/preview-runner";
import { PreviewE2eSafetyError } from "@/lib/e2e/preview-safety";
import {
  classifyPreviewCleanupError,
  cleanupPreviewRun,
  runWithPreviewCleanup,
  type PreviewCleanupClient,
} from "@/lib/e2e/preview-cleanup";

let activeRunId: string | undefined;

async function readAppIdentity(baseUrl: string, handshakeSecret: string, bypassSecret: string) {
  const response = await fetch(new URL("/api/e2e/preview-identity", baseUrl), {
    headers: {
      "x-yaho-preview-e2e-handshake": handshakeSecret,
      "x-vercel-protection-bypass": bypassSecret,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PreviewE2eSafetyError("APP_IDENTITY_UNAVAILABLE", "Preview app database identity could not be verified");
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("fingerprint" in payload) ||
    !("deploymentSha" in payload) ||
    typeof payload.fingerprint !== "string" ||
    typeof payload.deploymentSha !== "string"
  ) {
    throw new PreviewE2eSafetyError("APP_IDENTITY_UNKNOWN", "Preview app database identity could not be verified");
  }
  return { fingerprint: payload.fingerprint, deploymentSha: payload.deploymentSha };
}

function runPlaywright(environment: NodeJS.ProcessEnv, onChild: (child: ChildProcess) => void): Promise<number> {
  const executable = process.execPath;
  const cliPath = playwrightCliPath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [cliPath, "test", ...PREVIEW_E2E_TEST_FILES], {
      env: environment,
      stdio: "inherit",
    });
    onChild(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error("Preview Playwright process was interrupted"));
      else resolve(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const configuration = readPreviewE2eConfiguration();
  activeRunId = configuration.runId;
  const databaseClient = new PrismaClient({ datasourceUrl: configuration.databaseUrl });
  const directClient = new PrismaClient({ datasourceUrl: configuration.directUrl });
  let child: ChildProcess | undefined;
  let proofDirectory: string | undefined;
  let interrupted = false;
  const stopChild = () => child?.kill();
  const onSignal = () => {
    interrupted = true;
    stopChild();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    assertDeploymentMatchesRepository({ deploymentSha: configuration.deploymentSha });
    const appIdentity = await readAppIdentity(
      configuration.baseUrl,
      configuration.handshakeSecret,
      configuration.bypassSecret,
    );
    assertPreviewIdentityResponse(appIdentity, configuration);
    await assertPreviewDatabasePreflight({
      databaseClient,
      directClient,
      approvedRuntimeFingerprint: configuration.approvedRuntimeFingerprint,
      previewProjectRef: configuration.previewProjectRef,
      databaseSchema: configuration.databaseSchema,
      directSchema: configuration.directSchema,
      migrationRoot: path.resolve("prisma/migrations"),
    });

    const exitCode = await withPreviewDatabaseLock({
      client: directClient,
      onSessionLost: stopChild,
      run: () => {
        proofDirectory = mkdtempSync(path.join(os.tmpdir(), "yaho-preview-e2e-"));
        const proofPath = path.join(proofDirectory, "runner-proof");
        const proof = randomUUID();
        writeFileSync(proofPath, proof, { encoding: "utf8", mode: 0o600 });
        return runWithPreviewCleanup({
          runId: configuration.runId,
          run: async () => {
            try {
              return await runPlaywright(
                {
                  ...process.env,
                  PLAYWRIGHT_PREVIEW_E2E: "1",
                  PLAYWRIGHT_BASE_URL: configuration.baseUrl,
                  YAHO_E2E_RUN_ID: configuration.runId,
                  PREVIEW_E2E_RUNNER_PROOF_PATH: proofPath,
                  PREVIEW_E2E_RUNNER_PROOF: proof,
                },
                (process) => {
                  child = process;
                  if (interrupted) stopChild();
                },
              );
            } catch (error) {
              console.error(`[preview-e2e] Playwright interrupted for synthetic run ${configuration.runId}`);
              throw error;
            }
          },
          cleanup: () => cleanupPreviewRun(databaseClient as unknown as PreviewCleanupClient, configuration.runId),
          onCleanupFailure: ({ code, report }) => {
            console.error(`[preview-e2e] cleanup failed (${code}) for synthetic run ${report.runId}`);
          },
        });
      },
    });
    if (exitCode !== 0) {
      console.error(`[preview-e2e] Playwright failed for synthetic run ${configuration.runId}`);
      process.exitCode = exitCode;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    stopChild();
    if (proofDirectory) rmSync(proofDirectory, { recursive: true, force: true });
    await Promise.all([databaseClient.$disconnect(), directClient.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  const code = error instanceof PreviewE2eSafetyError
    ? error.code
    : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028"
      ? classifyPreviewCleanupError(error)
      : "UNEXPECTED_FAILURE";
  const run = activeRunId ? ` for synthetic run ${activeRunId}` : "";
  console.error(`[preview-e2e] failed (${code})${run}`);
  process.exitCode = 1;
});
