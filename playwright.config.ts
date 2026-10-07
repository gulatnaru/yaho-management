import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./tests/e2e/support/db-safety";
import { assertLocalE2eBaseUrl } from "./lib/e2e/local-origin-safety";
import {
  assertPreviewE2eRunnerProof,
  PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS,
  PREVIEW_E2E_TEST_FILES,
  readPreviewE2eConfiguration,
} from "./lib/e2e/preview-runner";

// Playwright 테스트 러너는 Next.js 와 별도 프로세스라 .env 를 자동으로 읽지 않는다.
// Next.js 가 실제로 쓰는 로더(@next/env)를 그대로 재사용해 .env/.env.local 을 로드한다
// (dev 서버가 읽는 값과 완전히 동일한 우선순위/병합 규칙을 보장하기 위함 — dotenv 를 별도로 추가하지 않는다).
loadEnvConfig(process.cwd());
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const previewE2e = process.env.PLAYWRIGHT_PREVIEW_E2E === "1";
let localBaseUrl: string | undefined;
if (previewE2e) {
  // The script also performs the connected-DB, deployment and migration checks
  // before Playwright starts. This keeps direct Preview invocations fail-closed.
  readPreviewE2eConfiguration();
  assertPreviewE2eRunnerProof({
    proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH,
    proof: process.env.PREVIEW_E2E_RUNNER_PROOF,
  });
} else {
  localBaseUrl = assertLocalE2eBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
  assertSafeE2eDatabaseUrls({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: previewE2e
    ? PREVIEW_E2E_TEST_FILES.map((file) => new RegExp(`${escapeRegExp(file).replaceAll("/", "[\\\\/]")}$`))
    : undefined,
  // This suite intentionally throws before creating a client unless the Preview
  // runner proof is present. Ignore it during ordinary local discovery so the
  // local safety check can list the browser suite without weakening that guard.
  testIgnore: previewE2e ? undefined : /phase20-postgres-races\.spec\.ts$/,
  // 로컬 Next dev cold compilation 환경에서 전체 E2E 실행의 결정성을 우선한다.
  workers: 1,
  // The outer runner adds cleanup/startup time beyond this browser budget.
  globalTimeout: previewE2e ? PREVIEW_E2E_BROWSER_GLOBAL_TIMEOUT_MS : undefined,
  expect: { timeout: 15000 },
  use: {
    baseURL: previewE2e ? process.env.PLAYWRIGHT_BASE_URL : localBaseUrl,
    trace: previewE2e ? "off" : "on-first-retry",
    screenshot: previewE2e ? "off" : "only-on-failure",
    extraHTTPHeaders: previewE2e
      ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET as string, "x-yaho-phase20-preview-run": process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN as string }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: previewE2e
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
      },
});
