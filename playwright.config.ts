import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Playwright 테스트 러너는 Next.js 와 별도 프로세스라 .env 를 자동으로 읽지 않는다.
// Next.js 가 실제로 쓰는 로더(@next/env)를 그대로 재사용해 .env/.env.local 을 로드한다
// (dev 서버가 읽는 값과 완전히 동일한 우선순위/병합 규칙을 보장하기 위함 — dotenv 를 별도로 추가하지 않는다).
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
