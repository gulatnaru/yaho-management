import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

// Playwright 테스트 러너는 Next.js 와 별도 프로세스라 .env 를 자동으로 읽지 않는다.
// Next.js 가 실제로 쓰는 로더(@next/env)를 그대로 재사용해 .env/.env.local 을 로드한다
// (dev 서버가 읽는 값과 완전히 동일한 우선순위/병합 규칙을 보장하기 위함 — dotenv 를 별도로 추가하지 않는다).
loadEnvConfig(process.cwd());
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

export default defineConfig({
  testDir: "./tests/e2e",
  // 로컬 Next dev cold compilation 환경에서 전체 E2E 실행의 결정성을 우선한다.
  workers: 1,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
});
