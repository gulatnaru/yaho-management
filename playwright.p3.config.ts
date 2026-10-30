import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

/**
 * P3 전용 Playwright 설정 (메인·P2-S 설정과 별개).
 * P2-S 패턴을 따른다: webServer를 만들지 않고, 하네스가 미리 띄운 next start
 * 서버 2대(SUPER_ADMIN 모드 + INVALID 모드)를 스펙이 절대 URL로 직접 겨냥한다.
 * .env를 로드하지 않는다 — 모든 값은 셸 환경변수에서만 오며, DB 안전 게이트와
 * 루프백 오리진 검사를 로드 시점에 강제한다. Preview 모드는 허용하지 않는다.
 */
if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) {
  throw new Error("P3_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

function requiredLoopbackUrl(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.search || parsed.hash) {
    throw new Error(`${name}은 http://127.0.0.1:<port> 루프백 오리진이어야 합니다.`);
  }
  return value.replace(/\/$/, "");
}

const superadminUrl = requiredLoopbackUrl("P3_SUPERADMIN_URL");
requiredLoopbackUrl("P3_INVALID_URL");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [/p3-invitation\.spec\.ts$/],
  workers: 1,
  expect: { timeout: 15000 },
  use: {
    baseURL: superadminUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // P2-S와 동일: playwright install을 실행하지 않고 관리 캐시 밖 풀 크롬을
        // executablePath로 직접 겨냥한다.
        launchOptions: {
          executablePath: "/home/hatch/.cache/p2safe-browsers/chrome-linux64/chrome",
        },
      },
    },
  ],
});
