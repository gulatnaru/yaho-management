import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";
import { assertLocalE2eBaseUrl } from "./lib/e2e/local-origin-safety";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.YAHO_P7_ISOLATED_HARNESS !== "1") throw new Error("P7_ISOLATED_ONLY");
const safeDb = assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
if (safeDb.DATABASE_URL.host !== "127.0.0.1") throw new Error("P7_FAKE_REQUIRES_127_0_0_1_DB");
const baseURL = assertLocalE2eBaseUrl(process.env.PLAYWRIGHT_BASE_URL);

// Next dev servers cannot safely share .next. Each extra server gets a private
// temporary copy and a temporary dependency symlink, removed when it exits.
// No .env file is copied; DB and auth settings must be supplied by the harness.
function isolatedServer(port: number, mode: string, delivery: "fake" | "off") {
  const command = `set -e; p7_dir=$(mktemp -d /tmp/yaho-p7-server-XXXXXX); p7_source="$PWD"; p7_child=; ` +
    `trap 'kill "$p7_child" 2>/dev/null || true; wait "$p7_child" 2>/dev/null || true; rm -rf "$p7_dir"' EXIT; ` +
    `trap 'exit 143' TERM INT; ` +
    `tar --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude=./.agents --exclude=./.codex --exclude=./.aws --exclude='./.env*' --exclude='*.tsbuildinfo' -cf - . | tar -C "$p7_dir" -xf -; ` +
    `ln -s "$p7_source/node_modules" "$p7_dir/node_modules"; cd "$p7_dir"; ` +
    `./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${port} & p7_child=$!; wait "$p7_child"`;
  return {
    command,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      YAHO_ADMIN_CUTOVER_MODE: mode,
      YAHO_INVITATION_DELIVERY: delivery,
      YAHO_P4_ISOLATED_HARNESS: "1",
      YAHO_P4_FAKE_RESULT: "accepted",
    },
    timeout: 120_000,
  };
}

export default defineConfig({
  testDir: "./tests/p7-e2e",
  testMatch: /p7-first-super-admin\.spec\.ts$/,
  workers: 1,
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "npm run dev", url: baseURL, reuseExistingServer: false, env: { YAHO_ADMIN_CUTOVER_MODE: "LEGACY_ADMIN", YAHO_INVITATION_DELIVERY: "off" } },
    isolatedServer(3001, "SUPER_ADMIN", "fake"),
    isolatedServer(3002, "INVALID", "off"),
    isolatedServer(3003, "SUPER_ADMIN", "off"),
  ],
});
