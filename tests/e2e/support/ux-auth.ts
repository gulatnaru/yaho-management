import { chmod, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalE2eBaseUrl } from "../../../lib/e2e/local-origin-safety";
import { assertSafeE2eDatabaseUrls } from "./db-safety";
import { loadUxManifest, runtimePath } from "./ux-manifest";
import { probeSecureLoopbackCookie } from "./ux-capability";

/** Auth.js owns every session/cookie. Never mint a JWT or edit password-policy flags. */
export async function prepareUxAuth(path: string) {
  assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
  const baseURL = assertLocalE2eBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
  const manifest = loadUxManifest(path);
  const secureLoopbackCookie = await probeSecureLoopbackCookie(manifest.project);
  manifest.environment.UX_SECURE_LOOPBACK_COOKIE_SUPPORTED = String(secureLoopbackCookie);
  // Only the capability boolean is retained, never probe cookie values.
  console.log(`[UX CAPABILITY] secure-cookie-on-fixed-http-loopback=${secureLoopbackCookie}`);
  const browser = await chromium.launch();
  const db = new PrismaClient();
  try {
    for (const account of manifest.accounts) {
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        async function login(password: string) {
          await page.goto("/login");
          await page.getByLabel("이메일", { exact: true }).fill(account.email);
          await page.getByLabel("비밀번호", { exact: true }).fill(password);
          await page.getByRole("button", { name: "로그인", exact: true }).click();
          await page.waitForURL((url) => url.pathname === "/dashboard" || url.pathname === "/account/password");
        }
        await login(account.password);
        if (account.role !== "ADMIN") {
          if (new URL(page.url()).pathname !== "/account/password") throw new Error("UX_PASSWORD_POLICY_NOT_ENFORCED");
          await page.getByLabel("현재 비밀번호", { exact: true }).fill(account.password);
          await page.getByLabel("새 비밀번호", { exact: true }).fill(account.finalPassword);
          await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(account.finalPassword);
          await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
          await page.waitForURL("**/login");
          await login(account.finalPassword);
        }
        if (new URL(page.url()).pathname !== "/dashboard") throw new Error("UX_REAL_LOGIN_FAILED");
        const row = await db.user.findUniqueOrThrow({ where: { email: account.email } });
        if (row.role !== account.role || row.mustChangePassword || !row.isActive || (account.role === "TEACHER" && !row.teacherId)) throw new Error("UX_REAL_ACCOUNT_POLICY_FAILED");
        const statePath = runtimePath(manifest.environment[`UX_${account.role}_STORAGE_STATE`]);
        await context.storageState({ path: statePath });
        await chmod(statePath, 0o600);
      } finally { await context.close(); }
    }
    await writeFile(runtimePath(path), JSON.stringify(manifest), { mode: 0o600 });
    console.log("UX real login/password-policy setup completed for 3 roles.");
  } finally { await browser.close(); await db.$disconnect(); }
}
