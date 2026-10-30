import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

// The harness starts all servers in advance against the dedicated local PG.
if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) throw new Error("P5_LOCAL_ONLY");
if (process.env.YAHO_INVITATION_DELIVERY !== "fake" || process.env.YAHO_P4_ISOLATED_HARNESS !== "1") throw new Error("P5_FAKE_DELIVERY_REQUIRED");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
function loopback(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be a loopback origin`);
  return url.origin;
}
const baseURL = loopback("P5_SUPERADMIN_URL");
loopback("P5_LEGACY_URL");
loopback("P5_INVALID_URL");
export default defineConfig({
  testDir: "./tests/e2e", testMatch: /p5-session-security\.spec\.ts$/, workers: 1,
  expect: { timeout: 15000 },
  use: { baseURL, trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/home/hatch/.cache/p2safe-browsers/chrome-linux64/chrome" } } }],
});
