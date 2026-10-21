import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./db-safety";
import { applyUxManifest, runtimePath, uxProjectSchema } from "./ux-manifest";
import { seedUxFixtures } from "./ux-seed";
import { prepareUxAuth } from "./ux-auth";

// Read-only list must precede mutation suites: its global pending badge is a
// snapshot of the fixture DB. Separate processes also isolate import-time env.
export const uxSpecOrder = ["family-list", "class-links", "family-detail", "ledger", "confirmation", "completion", "guardian", "full-journey"] as const;

async function runSuite(path: string) {
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
    for (const spec of uxSpecOrder) {
      if (!existsSync(`tests/e2e/integrated-ux-${spec}.spec.ts`)) throw new Error("UX_REQUIRED_SPEC_MISSING");
      let settingsOwned = false;
      try {
        if (spec === "class-links") {
          if (await db.reservationApplicationSettings.count()) throw new Error("UX_CLASS_SETTINGS_ALREADY_EXIST");
          await db.reservationApplicationSettings.create({ data: { id: 1, bankName: "합성 은행", accountNumber: "000000", accountHolder: "합성 예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao", updatedById: manifest.environment.E2E_UX_ADMIN_ID } });
          settingsOwned = true;
        }
        console.log(`[UX SPEC] project=${manifest.project} spec=${spec}`);
        const status = await new Promise<number | null>((done, reject) => {
          const child = spawn(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.ux.config.ts", `integrated-ux-${spec}.spec.ts`, "--project", manifest.project], { stdio: "inherit", env: { ...process.env, UX_CI: "1", UX_EXTERNAL_SERVER: "1", UX_MANIFEST_PATH: path } });
          child.once("error", reject); child.once("exit", done);
        });
        if (status !== 0) throw new Error("UX_SUITE_FAILED");
      } finally {
        if (settingsOwned) {
          const removed = await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: manifest.environment.E2E_UX_ADMIN_ID, bankName: "합성 은행", accountNumber: "000000", accountHolder: "합성 예금주" } });
          if (removed.count !== 1) throw new Error("UX_SETTINGS_OWNERSHIP_LOST");
        }
      }
    }
  } finally { await db.$disconnect(); }
}

async function main() {
  const command = z.enum(["seed", "auth", "run"]).parse(process.argv[2]);
  const path = runtimePath(process.env.UX_MANIFEST_PATH ?? "test-results/ux-runtime/manifest.json");
  if (command === "seed") await seedUxFixtures(uxProjectSchema.parse(process.env.UX_PROJECT), path);
  if (command === "auth") await prepareUxAuth(path);
  if (command === "run") await runSuite(path);
}
void main().catch((error: unknown) => {
  // Never emit Prisma/Playwright errors which may include credential input or capabilities.
  const code = error instanceof Error && /^UX_[A-Z_]+$/.test(error.message) ? error.message : "UX_SETUP_OR_EXECUTION_ERROR";
  console.error(`[${code}] Require fresh disposable DB, runtime fixture manifest, real authenticated states and passing scenarios. Sensitive diagnostics withheld.`);
  process.exitCode = 1;
});
