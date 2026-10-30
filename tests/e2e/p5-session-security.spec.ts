import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { expect, request, test, type Page } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// These are pre-started next start servers, sharing only the isolated local test DB.
if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) throw new Error("P5_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
function origin(name: string) {
  try {
    const u = new URL(process.env[name] || "");
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.pathname === "/" && !u.search && !u.hash ? u.origin : "";
  } catch { return ""; }
}
const superUrl = origin("P5_SUPERADMIN_URL");
const legacyUrl = origin("P5_LEGACY_URL");
const invalidUrl = origin("P5_INVALID_URL");
const suite = superUrl && legacyUrl && invalidUrl ? test.describe.serial : test.describe.skip;
const db = new PrismaClient();
const run = `p5-${randomBytes(8).toString("hex")}`;
const password = `${run}-Password1!`;
const newPassword = `${run}-Password2!`;
const ids: string[] = [];
let superId = "";
let staffId = "";
let adminId = "";
const email = (kind: string) => `${run}-${kind}@example.test`;

async function ready(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
async function login(page: Page, url: string, address: string, pass: string, destination = /\/dashboard/) {
  await page.route("**/*", route => route.request().headers()["next-router-prefetch"] === "1" ? route.abort() : route.continue());
  await ready(page, `${url}/login`);
  await page.getByLabel("이메일").fill(address);
  await page.getByLabel("비밀번호").fill(pass);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(destination);
}
async function edit(page: Page, change: (page: Page) => Promise<void>) {
  await ready(page, `${superUrl}/accounts/${staffId}/edit`);
  await change(page);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${staffId}$`));
}

suite("P5 session security through HTTP", () => {
  test.describe.configure({ timeout: 180_000 });
  test.beforeAll(async () => {
    const hashed = await hash(password, 4);
    const [superUser, staff, admin] = await Promise.all([
      db.user.create({ data: { name: `${run} super`, email: email("super"), password: hashed, role: "SUPER_ADMIN" } }),
      db.user.create({ data: { name: `${run} staff`, email: email("staff"), password: hashed, role: "STAFF" } }),
      db.user.create({ data: { name: `${run} admin`, email: email("admin"), password: hashed, role: "ADMIN" } }),
    ]);
    superId = superUser.id; staffId = staff.id; adminId = admin.id;
    ids.push(superId, staffId, adminId);
  });
  test.afterAll(async () => {
    // Include any UI-created target even if an assertion failed before it was recorded.
    const created = await db.user.findMany({ where: { email: { startsWith: run } }, select: { id: true } });
    ids.push(...created.map(user => user.id));
    await db.invitationDeliveryAttempt.deleteMany({ where: { invitation: { issuedById: superId } } });
    await db.adminInvitation.deleteMany({ where: { issuedById: superId } });
    await db.userAccountChange.deleteMany({ where: { OR: [{ targetUserId: { in: ids } }, { actorAdminId: { in: ids } }] } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  test("role, deactivation, reactivation and password reset invalidate prior browser sessions", async ({ browser }) => {
    const superContext = await browser.newContext();
    const staffContext = await browser.newContext();
    const superPage = await superContext.newPage();
    const staffPage = await staffContext.newPage();
    await login(superPage, superUrl, email("super"), password);
    await login(staffPage, superUrl, email("staff"), password);
    const firstSession = await staffContext.storageState();
    await edit(superPage, async p => { await p.getByLabel(/역할/).selectOption("MANAGER"); });
    await staffPage.goto(`${superUrl}/dashboard`);
    await expect(staffPage).toHaveURL(/\/login/);
    await login(staffPage, superUrl, email("staff"), password);
    // STAFF cannot reach the operational route; MANAGER can after relogin.
    expect((await staffPage.goto(`${superUrl}/children`))?.status()).toBe(200);
    const secondSession = await staffContext.storageState();
    await edit(superPage, async p => { await p.getByLabel("활성 계정").uncheck(); });
    await staffPage.goto(`${superUrl}/dashboard`);
    await expect(staffPage).toHaveURL(/\/login/);
    await login(staffPage, superUrl, email("staff"), password, /\/login/);
    await expect(staffPage.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();
    await edit(superPage, async p => { await p.getByLabel("활성 계정").check(); });
    for (const state of [firstSession, secondSession]) {
      const oldContext = await browser.newContext({ storageState: state });
      const oldPage = await oldContext.newPage();
      await oldPage.goto(`${superUrl}/dashboard`);
      await expect(oldPage).toHaveURL(/\/login/);
      await oldContext.close();
    }
    await login(staffPage, superUrl, email("staff"), password);
    const beforeReset = await staffContext.storageState();
    await ready(superPage, `${superUrl}/accounts/${staffId}`);
    await superPage.getByLabel("새 임시 비밀번호").fill(newPassword);
    await superPage.getByRole("button", { name: "비밀번호 재설정" }).click();
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: staffId } })).mustChangePassword).toBe(true);
    const resetContext = await browser.newContext({ storageState: beforeReset });
    const resetPage = await resetContext.newPage();
    await resetPage.goto(`${superUrl}/dashboard`);
    await expect(resetPage).toHaveURL(/\/login/);
    await login(staffPage, superUrl, email("staff"), newPassword, /\/account\/password/);
    const finalPassword = `${run}-Password3!`;
    await staffPage.getByLabel("현재 비밀번호", { exact: true }).fill(newPassword);
    await staffPage.getByLabel("새 비밀번호", { exact: true }).fill(finalPassword);
    await staffPage.getByLabel("새 비밀번호 확인", { exact: true }).fill(finalPassword);
    await staffPage.getByRole("button", { name: "비밀번호 변경" }).click();
    await expect(staffPage).toHaveURL(/\/login/);
    await expect(staffPage.locator("body")).not.toContainText("비밀번호를 변경하지 못했습니다");
    await login(staffPage, superUrl, email("staff"), finalPassword);
    await resetContext.close(); await staffContext.close(); await superContext.close();
  });

  test("captured protected server action rejects anonymous and stale session POSTs", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, superUrl, email("super"), password);
    const staleState = await adminContext.storageState();
    await ready(adminPage, `${superUrl}/accounts/${staffId}/edit`);
    await adminPage.getByLabel("이름 *", { exact: true }).fill(`${run} changed`);
    const actionRequest = adminPage.waitForRequest(req => req.method() === "POST" && Boolean(req.headers()["next-action"]));
    await adminPage.getByRole("button", { name: "변경사항 저장" }).click();
    const captured = await actionRequest;
    await expect(adminPage).toHaveURL(new RegExp(`/accounts/${staffId}$`));
    const body = captured.postDataBuffer();
    expect(body).not.toBeNull();
    const headers = captured.headers();
    // Synthetic actor session is made stale after capturing a valid action request.
    await db.user.update({ where: { id: superId }, data: { authVersion: { increment: 1 } } });
    const before = await db.user.findUniqueOrThrow({ where: { id: staffId } });
    const audits = await db.userAccountChange.count({ where: { targetUserId: staffId } });
    for (const state of [undefined, staleState]) {
      const client = await request.newContext({ storageState: state, maxRedirects: 0 });
      const response = await client.post(captured.url(), { data: body!, headers: {
        "next-action": headers["next-action"], "content-type": headers["content-type"], origin: superUrl,
        accept: "text/x-component",
      } });
      const redirect = response.headers()["x-action-redirect"] || response.headers().location || "";
      expect(redirect).toContain("/login");
      await client.dispose();
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: staffId } })).toEqual(before);
    expect(await db.userAccountChange.count({ where: { targetUserId: staffId } })).toBe(audits);
    await adminContext.close();
  });

  test("cutover modes, invitation acceptance and P4 invitation access regressions", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, legacyUrl, email("admin"), password);
    expect((await page.goto(`${legacyUrl}/accounts`))?.status()).toBe(200);
    await context.close();
    const invalidContext = await browser.newContext();
    const invalidPage = await invalidContext.newPage();
    await login(invalidPage, invalidUrl, email("admin"), password);
    const denied = await invalidPage.goto(`${invalidUrl}/accounts`);
    if (denied?.status() !== 404) await expect(invalidPage.locator("body")).toContainText(/404|This page could not be found/i);
    await invalidContext.close();
    const superContext = await browser.newContext();
    const superPage = await superContext.newPage();
    await login(superPage, superUrl, email("super"), password);
    expect((await superPage.goto(`${superUrl}/invitations`))?.status()).toBe(200);
    // P4 server must be configured by the harness for approved fake delivery.
    const deliveryEmail = email("delivery");
    await superPage.waitForLoadState("networkidle");
    await superPage.getByLabel("이름 *", { exact: true }).fill(`${run} delivery`);
    await superPage.getByLabel(/이메일/).fill(deliveryEmail);
    await superPage.getByLabel(/역할/).selectOption("STAFF");
    await superPage.getByRole("button", { name: "초대 발급" }).click();
    await expect(superPage.locator("body")).toContainText("발송 요청 접수");
    const deliveryTarget = await db.user.findUniqueOrThrow({ where: { email: deliveryEmail } });
    ids.push(deliveryTarget.id);
    const delivery = await db.adminInvitation.findFirstOrThrow({ where: { email: deliveryEmail } });
    expect((await db.invitationDeliveryAttempt.findUniqueOrThrow({ where: { invitationId: delivery.id } })).status).toBe("ACCEPTED");
    const token = randomBytes(32).toString("base64url");
    const inviteEmail = email("invite");
    const invitee = await db.user.create({ data: { name: `${run} invite`, email: inviteEmail, role: "STAFF", isActive: false } });
    ids.push(invitee.id);
    await db.adminInvitation.create({ data: {
      email: inviteEmail, role: "STAFF", tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000), issuedById: superId, targetUserId: invitee.id,
    } });
    await ready(superPage, `${superUrl}/invite/${token}`);
    await superPage.getByLabel("새 비밀번호 *", { exact: true }).fill(password);
    await superPage.getByLabel("새 비밀번호 확인 *", { exact: true }).fill(password);
    await superPage.getByRole("button", { name: "비밀번호 설정하고 계정 활성화" }).click();
    await expect(superPage.locator("body")).toContainText("초대를 수락했습니다");
    await login(superPage, superUrl, inviteEmail, password);
    expect((await db.user.findUniqueOrThrow({ where: { id: invitee.id } })).isActive).toBe(true);
    await superContext.close();
  });
});
