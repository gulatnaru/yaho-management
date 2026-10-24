import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.config";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_INTEGRATION_LOCAL_ONLY");
loadEnvConfig(process.cwd());
if (process.env.VERCEL_ENV) throw new Error("UX_INTEGRATION_LOCAL_ONLY");
// Fail before tests construct clients; no fixtures or cleanup are executed by this config.
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
export default defineConfig({ resolve: unitConfig.resolve, test: {
  ...unitConfig.test,
  include: ["tests/integration/reservation-applications/**/*.test.ts"],
  fileParallelism: false,
} });
