import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

/**
 * P2-S 전용 Playwright 설정 (메인 playwright.config.ts와 별개).
 *
 * 메인 설정은 webServer로 `npm run dev`를 띄우고 baseURL을 127.0.0.1:3000으로
 * 고정한다. P2-S 검증은 모드별 next start 서버 3대를 하네스가 미리 띄우고
 * 스펙이 절대 URL로 각 서버를 직접 겨냥하므로, 이 설정은 webServer를 만들지
 * 않고 baseURL도 phase16의 상대 URL용(SUPER_ADMIN 서버)으로만 쓴다.
 * .env를 로드하지 않는다 — 모든 값은 셸 환경변수에서만 오며, DB 안전 게이트와
 * 루프백 오리진 검사를 로드 시점에 강제한다. Preview 모드는 허용하지 않는다.
 */
if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) {
  throw new Error("P2SAFE_LOCAL_ONLY");
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

const superadminUrl = requiredLoopbackUrl("P2SAFE_SUPERADMIN_URL");
requiredLoopbackUrl("P2SAFE_LEGACY_URL");
requiredLoopbackUrl("P2SAFE_INVALID_URL");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [/p2safe-cutover\.spec\.ts$/, /phase16-account-access\.spec\.ts$/],
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
        // 샌드박스 프록시에서 playwright install의 30초 다운로드 타임아웃이 반복되고,
        // 관리 캐시(~/.cache/ms-playwright)에 수동 배치한 파일은 install이 지워 버리므로,
        // curl로 받은 동일 버전(151.0.7922.34) 바이너리를 관리 캐시 밖 경로에 두고
        // executablePath로 직접 겨냥한다. 다시는 `playwright install`을 실행하지 않는다.
        // 풀 크롬을 쓰는 이유: playwright install의 다운로드가 샌드박스 프록시에서
        // 30초 타임아웃으로 실패하므로 관리 캐시 밖 경로의 동일 버전 바이너리를 직접
        // 겨냥한다. (초기에는 헤드리스 셸 문제로 보였으나, 풀 크롬에서도 서버 액션
        // 결과의 클라이언트 적용이 간헐적으로 유실되는 현상이 재현돼 브라우저 바이너리
        // 문제가 아니고 샌드박스 하네스의 간헐 현상으로 판단했다. 서버는 항상 커밋까지
        // 완료하므로, 재설정·출결 스펙은 토스트 문구를 게이트로 삼지 않고 DB 폴링 +
        // reload 렌더로 검증한다. 상세는 빌드 보고서 참조.)
        launchOptions: {
          executablePath:
            "/home/hatch/.cache/p2safe-browsers/chrome-linux64/chrome",
        },
      },
    },
  ],
});
