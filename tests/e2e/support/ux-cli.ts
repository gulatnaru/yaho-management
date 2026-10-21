import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./db-safety";
import { applyUxManifest, runtimePath, uxProjectSchema } from "./ux-manifest";
import { seedUxFixtures } from "./ux-seed";
import { prepareUxAuth } from "./ux-auth";
import { publishUxInfrastructureFailure } from "./ux-diagnostics";
import type { UxManifest } from "./ux-manifest";

// Read-only list must precede mutation suites: its global pending badge is a
// snapshot of the fixture DB. Separate processes also isolate import-time env.
export const uxSpecOrder = ["family-list", "class-links", "family-detail", "ledger", "confirmation", "completion", "guardian", "full-journey"] as const;

type Spec = typeof uxSpecOrder[number];
export interface UxSpecOutcome { spec: Spec; failures: string[] }
export interface UxExecutionDependencies {
  db: Pick<PrismaClient, "reservationApplicationSettings">;
  exists: (path: string) => boolean;
  execute: (spec: Spec, project: UxManifest["project"], manifestPath: string) => Promise<number | null>;
  recordFailure: (project: string, spec: string, failures: string[]) => void;
}

function executeSpec(spec: Spec, project: UxManifest["project"], path: string): Promise<number | null> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.ux.config.ts", `integrated-ux-${spec}.spec.ts`, "--project", project], {
      stdio: "inherit", env: { ...process.env, UX_CI: "1", UX_EXTERNAL_SERVER: "1", UX_MANIFEST_PATH: path, UX_PROJECT: project, UX_DIAGNOSTIC_SPEC: `integrated-ux-${spec}.spec.ts` },
    });
    child.once("error", reject);
    // A signalled child exits with null and remains a failure.
    child.once("exit", done);
  });
}

/** Global DB/auth admission is done before this loop. Per-spec failures never hide later specs. */
export async function executeUxSpecs(manifest: UxManifest, path: string, dependencies: UxExecutionDependencies): Promise<UxSpecOutcome[]> {
  const outcomes: UxSpecOutcome[] = [];
  const { db } = dependencies;
  for (const spec of uxSpecOrder) {
    const failures: string[] = [];
    const file = `integrated-ux-${spec}.spec.ts`;
    let settingsOwned = false;
    let stage = "UX_SPEC_SETUP_FAILED";
    try {
      if (!dependencies.exists(`tests/e2e/${file}`)) {
        failures.push("UX_REQUIRED_SPEC_MISSING");
      } else {
        if (spec === "class-links") {
          if (await db.reservationApplicationSettings.count()) throw new Error("UX_CLASS_SETTINGS_ALREADY_EXIST");
          await db.reservationApplicationSettings.create({ data: { id: 1, bankName: "합성 은행", accountNumber: "000000", accountHolder: "합성 예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao", updatedById: manifest.environment.E2E_UX_ADMIN_ID } });
          settingsOwned = true;
        }
        console.log(`[UX SPEC] project=${manifest.project} spec=${spec}`);
        stage = "UX_SPEC_PROCESS_FAILED";
        if (await dependencies.execute(spec, manifest.project, path) !== 0) failures.push("UX_SPEC_PROCESS_FAILED");
      }
    } catch (error) {
      failures.push(error instanceof Error && error.message === "UX_CLASS_SETTINGS_ALREADY_EXIST" ? error.message : stage);
    } finally {
      if (settingsOwned) {
        try {
          const removed = await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: manifest.environment.E2E_UX_ADMIN_ID, bankName: "합성 은행", accountNumber: "000000", accountHolder: "합성 예금주" } });
          if (removed.count !== 1) failures.push("UX_SETTINGS_OWNERSHIP_LOST");
        } catch { failures.push("UX_SETTINGS_CLEANUP_FAILED"); }
      }
    }
    if (failures.length) {
      try { dependencies.recordFailure(manifest.project, file, failures); }
      catch { failures.push("UX_DIAGNOSTIC_PUBLICATION_FAILED"); }
      console.error(`[UX SPEC FAILED] spec=${spec} codes=${failures.join(",")}`);
    }
    outcomes.push({ spec, failures });
  }
  console.log(`[UX SUITE TOTAL] specs=${outcomes.length} failedSpecs=${outcomes.filter((outcome) => outcome.failures.length).length}`);
  return outcomes;
}

export async function runSuite(path: string) {
  assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
  const manifest = applyUxManifest(path);
  z.enum(["true", "false"]).parse(manifest.environment.UX_SECURE_LOOPBACK_COOKIE_SUPPORTED);
  for (const role of ["ADMIN", "MANAGER", "TEACHER"]) {
    if (!existsSync(runtimePath(manifest.environment[`UX_${role}_STORAGE_STATE`]))) throw new Error("UX_AUTH_STATE_MISSING");
  }
  for (const key of ["UX_READ_ONLY_CLASS_FIXTURES", "UX_PHASE2_CLASS_FIXTURES", "UX_FAMILY_LIST_FIXTURES", "UX_FAMILY_DETAIL_FIXTURES", "UX_LEDGER_FIXTURES", "UX_CONFIRMATION_FIXTURES"]) {
    if (!manifest.environment[key]) throw new Error("UX_FIXTURE_ENV_MISSING");
  }
  const db = new PrismaClient();
  try {
    const outcomes = await executeUxSpecs(manifest, path, { db, exists: existsSync, execute: executeSpec, recordFailure: publishUxInfrastructureFailure });
    if (outcomes.some((outcome) => outcome.failures.length)) throw new Error("UX_SUITE_FAILED");
  } finally { await db.$disconnect(); }
}

async function main() {
  const command = z.enum(["seed", "auth", "run"]).parse(process.argv[2]);
  const path = runtimePath(process.env.UX_MANIFEST_PATH ?? "test-results/ux-runtime/manifest.json");
  if (command === "seed") await seedUxFixtures(uxProjectSchema.parse(process.env.UX_PROJECT), path);
  if (command === "auth") await prepareUxAuth(path);
  if (command === "run") await runSuite(path);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => {
  // Never emit Prisma/Playwright errors which may include credential input or capabilities.
  const code = error instanceof Error && /^UX_[A-Z_]+$/.test(error.message) ? error.message : "UX_SETUP_OR_EXECUTION_ERROR";
  console.error(`[${code}] Require fresh disposable DB, runtime fixture manifest, real authenticated states and passing scenarios. Sensitive diagnostics withheld.`);
  process.exitCode = 1;
});
