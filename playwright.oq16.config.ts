import { defineConfig, devices } from "@playwright/test";
// The repo gate pins port 55432 by default; this form test runs against the
// isolated integration cluster on 55435 (OQ-16 schema + test ADMIN live
// there), so it explicitly allows 55435 here only — via the repo gate's
// opt-in `additionalPorts`. No /tmp copy is involved: this config must load
// on any machine (including the Vercel build machine, where /tmp is empty),
// so it imports the repo gate like every other Playwright config.
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";

/**
 * OQ-16 폼 계층 회귀 테스트 전용 Playwright 설정 (메인 playwright.config.ts와 별개).
 *
 * 메인 설정은 webServer로 `npm run dev`를 띄우고 baseURL을 127.0.0.1:3000으로
 * 고정한다. 이 스펙은 재현 하네스와 동일하게 `next start -p 3100` 서버를
 * 하네스가 미리 띄우고 스펙이 절대 URL로 직접 겨냥하므로, 이 설정은
 * webServer를 만들지 않고 baseURL도 해당 서버로만 쓴다. .env를 로드하지
 * 않는다 — 모든 값은 셸 환경변수에서만 오며, DB 안전 게이트와 루프백
 * 오리진 검사를 로드 시점에 강제한다. Preview 모드는 허용하지 않는다.
 * 테스트 ADMIN 비밀번호는 OQ16_TEST_ADMIN_PASSWORD 환경변수로만 전달한다
 * (파일·보고서에 남기지 않는다).
 */
if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) {
    throw new Error("OQ16_FORM_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls(
  {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  },
  // Isolated integration cluster only — the default gate stays 55432-only.
  { additionalPorts: ["55435"] },
);

function requiredLoopbackUrl(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.search || parsed.hash) {
        throw new Error(`${name}은 http://127.0.0.1:<port> 루프백 오리진이어야 합니다.`);
    }
    return value.replace(/\/$/, "");
}

const formUrl = requiredLoopbackUrl("OQ16_FORM_BASE_URL");

export default defineConfig({
    testDir: "./tests/e2e",
    testMatch: [/oq16-guidance-form\.spec\.ts$/],
    workers: 1,
    expect: { timeout: 15000 },
    use: {
        baseURL: formUrl,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                // 샌드박스 프록시에서 playwright install의 30초 다운로드 타임아웃이
                // 반복되므로, 관리 캐시 밖 경로의 풀 크롬(Chrome 151, chromium
                // 1234과 동일 버전)을 직접 겨냥한다. `playwright install`을
                // 실행하지 않는다.
                launchOptions: {
                    executablePath: "/home/hatch/.cache/p2safe-browsers/chrome-linux64/chrome",
                },
            },
        },
    ],
});
