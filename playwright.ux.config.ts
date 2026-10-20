import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";
import { assertLocalE2eBaseUrl } from "./lib/e2e/local-origin-safety";

if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) throw new Error("UX_E2E_LOCAL_ONLY");
loadEnvConfig(process.cwd());
if (process.env.VERCEL_ENV || process.env.PREVIEW_E2E_FOCUS) throw new Error("UX_E2E_LOCAL_ONLY");
const baseURL = assertLocalE2eBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

export default defineConfig({
  testDir: "./tests/e2e", testMatch: /integrated-ux-.*\.spec\.ts$/, workers: 1,
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  expect: { timeout: 15000 },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-webkit-360", use: { ...devices["iPhone 13"], viewport: { width: 360, height: 780 } } },
    { name: "mobile-webkit-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: "npm run dev", url: baseURL, reuseExistingServer: false },
});
