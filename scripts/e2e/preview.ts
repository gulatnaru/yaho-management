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
  playwrightCliPath,
  withPreviewDatabaseLock,
} from "@/lib/e2e/preview-runner";
import { PreviewE2eSafetyError } from "@/lib/e2e/preview-safety";
import { encodeSignedPreviewRun, signPreviewRun } from "@/lib/e2e/phase20-lease";
import {
  cleanupPreviewRun,
  runWithPreviewCleanup,
  type PreviewCleanupClient,
} from "@/lib/e2e/preview-cleanup";
import { cleanupPhase20PreviewRun } from "@/lib/e2e/phase20-cleanup";
import { cleanupPhase21PreviewRun } from "@/lib/e2e/phase21-cleanup";
import { cleanupPreviewRunPhases } from "@/lib/e2e/preview-cleanup-phases";
import { previewE2eSafeSummaryPath, writePreviewE2eSafeSummary } from "@/lib/e2e/preview-run-summary";
import { previewPlaywrightArguments } from "@/lib/e2e/preview-focus";
import {PREVIEW_NO_COPY_PROMPT} from "@/lib/e2e/preview-artifact-policy";
import {readPreviewInvocationConfiguration} from "@/lib/e2e/preview-invocation";

let activeSummaryPath: string | undefined;
let activeSummary: Parameters<typeof writePreviewE2eSafeSummary>[1] | undefined;

function updateSafeSummary(summary: Partial<Parameters<typeof writePreviewE2eSafeSummary>[1]>): void {
  if (!activeSummaryPath || !activeSummary) return;
  activeSummary = { ...activeSummary, ...summary };
  writePreviewE2eSafeSummary(activeSummaryPath, activeSummary);
}

function markSafeSummaryFailed(errorCode: Parameters<typeof writePreviewE2eSafeSummary>[1]["errorCode"]): void {
  if (!activeSummary) return;
  updateSafeSummary({
    phase: "FAILED",
    playwright: activeSummary.playwright === "RUNNING" ? "UNPROVEN" : activeSummary.playwright,
    cleanup: activeSummary.cleanup === "FAILED" || activeSummary.cleanup === "PASSED" ? activeSummary.cleanup : "UNPROVEN",
    errorCode,
  });
}

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

function runPlaywright(
  environment: NodeJS.ProcessEnv,
  onChild: (child: ChildProcess) => void,
  onExit: (result: { code: number | null; signal: NodeJS.Signals | null }) => void,
): Promise<number> {
  const executable = process.execPath;
  const cliPath = playwrightCliPath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [cliPath, ...previewPlaywrightArguments(environment.PREVIEW_E2E_FOCUS)], {
      env: environment,
      // Playwright can include fixture values in failure output. Drain it only
      // into process memory; the durable fixed-field summary is the observer.
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rawOutput: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => rawOutput.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => rawOutput.push(Buffer.from(chunk)));
    onChild(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      // Retain the raw child output only until this callback completes. It is
      // intentionally neither parsed into the summary nor written to stdout.
      void rawOutput;
      onExit({ code, signal });
      if (signal) reject(new Error("Preview Playwright process was interrupted"));
      else resolve(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const configuration = readPreviewInvocationConfiguration(process.env);
  activeSummaryPath = previewE2eSafeSummaryPath(configuration.runId);
  // This artifact exists before the child inherits stdout, so a lost terminal
  // result cannot be mistaken for a passing or empty guarded run.
  activeSummary = { phase: "PREFLIGHT", playwright: "NOT_STARTED", cleanup: "NOT_STARTED", errorCode: "NONE", childExitCode: null, testCounts: "UNKNOWN" };
  updateSafeSummary({});
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
      run: (lockSession) => {
        proofDirectory = mkdtempSync(path.join(os.tmpdir(), "yaho-preview-e2e-"));
        const proofPath = path.join(proofDirectory, "runner-proof");
        const proof = randomUUID();
        writeFileSync(proofPath, proof, { encoding: "utf8", mode: 0o600 });
        const issuedAt = Date.now();
        const signedRun = encodeSignedPreviewRun({
          runId: configuration.runId,
          deploymentSha: configuration.deploymentSha,
          issuedAt,
          signature: signPreviewRun(configuration.runId, configuration.deploymentSha, issuedAt, configuration.handshakeSecret),
        });
        return databaseClient.previewE2eRunLease.create({
          data: { runId: configuration.runId, deploymentSha: configuration.deploymentSha, expiresAt: new Date(issuedAt + 24 * 60 * 1000) },
        }).then(async () => runWithPreviewCleanup({
          runId: configuration.runId,
          run: async () => {
            try {
              updateSafeSummary({ phase: "RUNNING", playwright: "RUNNING", cleanup: "PENDING", errorCode: "NONE", childExitCode: null });
              const exitCode = await runPlaywright(
                {
                  ...process.env,
                  PLAYWRIGHT_PREVIEW_E2E: "1",
                  PLAYWRIGHT_NO_COPY_PROMPT: PREVIEW_NO_COPY_PROMPT,
                  PLAYWRIGHT_BASE_URL: configuration.baseUrl,
                  YAHO_E2E_RUN_ID: configuration.runId,
                  PREVIEW_E2E_RUNNER_PROOF_PATH: proofPath,
                  PREVIEW_E2E_RUNNER_PROOF: proof,
                  PREVIEW_E2E_PHASE20_SIGNED_RUN: signedRun,
                },
                (process) => {
                  child = process;
                  if (interrupted) stopChild();
                },
                ({ code, signal }) => {
                  updateSafeSummary({
                    phase: "PLAYWRIGHT",
                    playwright: signal ? "INTERRUPTED" : code === 0 ? "EXIT_0" : "EXIT_NONZERO",
                    childExitCode: code,
                  });
                },
              );
              updateSafeSummary({ phase: "PLAYWRIGHT", playwright: exitCode === 0 ? "EXIT_0" : "EXIT_NONZERO", cleanup: "PENDING", errorCode: "NONE" });
              return exitCode;
            } catch (error) {
              throw error;
            }
          },
          cleanup: async () => {
            const legacy = await cleanupPreviewRunPhases({
              phase21: async () => {
                const report = await cleanupPhase21PreviewRun(databaseClient, {runId: configuration.runId, deploymentSha: configuration.deploymentSha});
                if (report.residualAiRows || report.residualPrograms || report.residualClasses) throw new Error("Phase21 cleanup left owned rows");
              },
              phase20: async () => {
                const report = await cleanupPhase20PreviewRun(databaseClient, configuration.runId);
                if (report.residualGroups !== 0) throw new Error("Phase20 synthetic cleanup left group rows");
              },
              legacy: () => cleanupPreviewRun(databaseClient as unknown as PreviewCleanupClient, configuration.runId),
              // Delete ownership in the SAME transaction that holds the global lock.
              // Session loss/commit failure rolls the lease deletion back.
              releaseLease: () => lockSession.$queryRaw`DELETE FROM "PreviewE2eRunLease" WHERE "runId"=${configuration.runId} AND "deploymentSha"=${configuration.deploymentSha} RETURNING "id"`,
            });
            updateSafeSummary({phase:"CLEANUP",cleanup:"PASSED",errorCode:"NONE"});
            return legacy;
          },
          onCleanupFailure: ({ code, report }) => {
            void code;
            void report;
            updateSafeSummary({ phase: "FAILED", cleanup: "FAILED", errorCode: "PREVIEW_SAFETY_ERROR" });
          },
        }));
      },
    });
    if (exitCode !== 0) {
      updateSafeSummary({ phase: "COMPLETE", playwright: "EXIT_NONZERO", cleanup: "PASSED", errorCode: "NONE" });
      process.exitCode = exitCode;
    } else {
      updateSafeSummary({ phase: "COMPLETE", playwright: "EXIT_0", cleanup: "PASSED", errorCode: "NONE" });
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    stopChild();
    if (proofDirectory) {
      const resolved=path.resolve(proofDirectory),temp=path.resolve(os.tmpdir());
      if(!resolved.startsWith(temp+path.sep)||!path.basename(resolved).startsWith("yaho-preview-e2e-"))throw new Error("PREVIEW_ARTIFACT_PATH_DENIED");
      rmSync(resolved, { recursive: true, force: true });
    }
    await Promise.all([databaseClient.$disconnect(), directClient.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  const code = error instanceof PreviewE2eSafetyError
    ? "PREVIEW_SAFETY_ERROR"
    : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028"
      ? "PRISMA_P2028"
      : "UNEXPECTED_FAILURE";
  markSafeSummaryFailed(code);
  process.exitCode = 1;
});
