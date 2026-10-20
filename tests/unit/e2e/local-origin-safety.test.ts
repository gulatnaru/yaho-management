import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalE2eBaseUrl } from "@/lib/e2e/local-origin-safety";
import { playwrightCliPath } from "@/lib/e2e/preview-runner";

const localDatabaseUrl = "postgresql://yaho_e2e:not-a-real-password@127.0.0.1:55432/yaho_e2e";

function runPlaywright(args: string[], env: NodeJS.ProcessEnv = process.env) {
  // Some restricted Linux runtimes return EPERM for spawnSync pipe capture even
  // after the child runs. Regular files retain the real exit and diagnostics.
  const directory = mkdtempSync(join(tmpdir(), "yaho-origin-safety-"));
  const stdoutPath = join(directory, "stdout");
  const stderrPath = join(directory, "stderr");
  const descriptors: number[] = [];
  try {
    descriptors.push(openSync(stdoutPath, "w"));
    descriptors.push(openSync(stderrPath, "w"));
    const result = spawnSync(process.execPath, [playwrightCliPath(), ...args], {
      cwd: process.cwd(), env, stdio: ["ignore", descriptors[0]!, descriptors[1]!],
    });
    return { ...result, stdout: readFileSync(stdoutPath, "utf8"), stderr: readFileSync(stderrPath, "utf8") };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

function listE2eTests(baseUrl: string | undefined) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: localDatabaseUrl,
    DIRECT_URL: localDatabaseUrl,
    ADMIN_EMAIL: "preview-e2e-test@example.invalid",
    ADMIN_PASSWORD: "not-a-real-password",
    RESERVATION_APPLICATION_BANK_NAME: "Test Bank",
    RESERVATION_APPLICATION_BANK_ACCOUNT_NUMBER: "000-000",
    RESERVATION_APPLICATION_BANK_ACCOUNT_HOLDER: "Test Holder",
    YAHO_BLOG_URL: "https://example.invalid/blog",
    YAHO_INSTAGRAM_URL: "https://example.invalid/instagram",
    YAHO_KAKAO_CHANNEL_URL: "https://example.invalid/kakao",
  };
  delete environment.PLAYWRIGHT_PREVIEW_E2E;
  delete environment.PREVIEW_E2E_RUNNER_PROOF_PATH;
  delete environment.PREVIEW_E2E_RUNNER_PROOF;
  if (baseUrl === undefined) delete environment.PLAYWRIGHT_BASE_URL;
  else environment.PLAYWRIGHT_BASE_URL = baseUrl;

  return runPlaywright(["test", "--list"], environment);
}

describe("Playwright local origin safety", () => {
  it("allows the default local webServer origin", () => {
    expect(assertLocalE2eBaseUrl(undefined)).toBe("http://127.0.0.1:3000");
    const version = runPlaywright(["--version"]);
    expect(version.error).toBeUndefined();
    expect(version.status).toBe(0);
    const local = listE2eTests(undefined);
    expect(local.error).toBeUndefined();
    expect(local.status).toBe(0);
  }, 30_000);

  it.each([
    "https://yaho-management.vercel.app",
    "https://yaho-management-git-arbitrary.vercel.app",
  ])("direct --list rejects remote origin %s before specs load", (baseUrl) => {
    const result = listE2eTests(baseUrl);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("PLAYWRIGHT_BASE_URL must be http://127.0.0.1:3000");
  });
});
