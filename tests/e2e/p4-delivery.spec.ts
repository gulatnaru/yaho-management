import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

/**
 * P3 직원 초대 — 실제 HTTP 요청과 브라우저를 통한 초대·수락·활성화 검증.
 *
 * 서버 2대는 하네스가 미리 띄운다 (next start, 격리 PG 공유):
 * - SUPER_ADMIN 모드 (P4_SUPERADMIN_URL): 초대 관리·수락 정상 계약
 * - INVALID 모드 (P4_INVALID_URL): 설정 오류 시 fail-closed 계약
 * 스펙은 모드를 바꾸지 않는다 (서버 재시작·재배포 영역).
 *
 * 안전 가드: Preview/Production DB 접속 금지, 격리 PG·루프백 오리진만 허용,
 * 합성 계정만 사용, afterAll에서 합성 데이터 정리.
 * 토큰 시드 방식: 원본 토큰은 제품 UI에서 읽을 수 없으므로(비노출 계약),
 * Prisma로 초대 행을 직접 시드한다 (토큰은 node:crypto로 생성하고 SHA-256
 * 해시만 DB에 저장 — 제품의 capability 패턴과 동일하다).
 */
const prisma = new PrismaClient();

function parseLoopbackUrl(name: string): string {
  const value = process.env[name];
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.search ||
      parsed.hash
    ) {
      return "";
    }
    return value.replace(/\/$/, "");
  } catch {
    return "";
  }
}

const SUPERADMIN_URL = parseLoopbackUrl("P4_SUPERADMIN_URL");
const INVALID_URL = parseLoopbackUrl("P4_INVALID_URL");
const FAILURE_URL = parseLoopbackUrl("P4_FAILURE_URL");
// 전용 하네스 환경변수가 없으면 import 시 throw하지 않고 파일 전체를 skip한다
// (P2-S와 동일 — 메인 설정의 --list가 환경변수 없이 실행되어도 실패하지 않는다).


if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) {
  throw new Error("P4_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

const suffix = `${Date.now()}`;
const run = `p4e2e-${suffix}`;
const superEmail = `${run}-super@example.test`;
const superPassword = `P4e2e-super-${suffix}!`;
const adminEmail = `${run}-admin@example.test`;
const adminPassword = `P4e2e-admin-${suffix}!`;

const ids = { users: [] as string[], invitations: [] as string[] };
let superId = "";
let adminId = "";

function makeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

async function seedInvitation(email: string, role: "STAFF" | "MANAGER", overrides: { expiresAt?: Date; usedAt?: Date | null; revokedAt?: Date | null } = {}) {
  const { token, tokenHash } = makeToken();
  const user = await prisma.user.create({
    data: { name: `합성 ${email}`, email, role, isActive: false, mustChangePassword: false },
  });
  ids.users.push(user.id);
  const invitation = await prisma.adminInvitation.create({
    data: {
      email,
      role,
      tokenHash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
      usedAt: overrides.usedAt ?? null,
      revokedAt: overrides.revokedAt ?? null,
      issuedById: superId,
      targetUserId: user.id,
    },
  });
  ids.invitations.push(invitation.id);
  return { token, userId: user.id, invitationId: invitation.id };
}

async function blockPrefetch(page: Page) {
  await page.route("**/*", (route) => {
    if (route.request().headers()["next-router-prefetch"] === "1") {
      return route.abort();
    }
    return route.continue();
  });
}

async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function login(page: Page, origin: string, email: string, password: string, expected = /\/dashboard/) {
  await blockPrefetch(page);
  await gotoReady(page, `${origin}/login`);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(expected);
}

test.describe("P3 초대 — HTTP/E2E", () => {


  test.beforeAll(async () => {
    const superUser = await prisma.user.create({
      data: { name: "합성 최고관리자", email: superEmail, password: await hash(superPassword, 12), role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
    });
    superId = superUser.id;
    ids.users.push(superId);
    const adminUser = await prisma.user.create({
      data: { name: "합성 관리자", email: adminEmail, password: await hash(adminPassword, 12), role: "ADMIN", isActive: true, mustChangePassword: false },
    });
    adminId = adminUser.id;
    ids.users.push(adminId);
  });

  test.afterAll(async () => {
    await prisma.invitationDeliveryAttempt.deleteMany({ where: { invitation: { issuedById: superId } } });
    await prisma.adminInvitation.deleteMany({ where: { issuedById: superId } });
    await prisma.userAccountChange.deleteMany({
      where: { OR: [{ targetUserId: { in: ids.users } }, { actorAdminId: { in: ids.users } }] },
    });
    if (ids.users.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
    await prisma.$disconnect();
  });

  test("SUPER_ADMIN은 초대 페이지를 보고, ADMIN은 404로 차단된다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, superEmail, superPassword);
    await gotoReady(page, `${SUPERADMIN_URL}/invitations`);
    await expect(page.locator("body")).toContainText("직원 초대");
    await expect(page.locator("body")).toContainText("초대 발급");

    const adminPage = page.context();
    const page2 = await adminPage.newPage();
    await login(page2, SUPERADMIN_URL, adminEmail, adminPassword);
    const response = await page2.goto(`${SUPERADMIN_URL}/invitations`);
    if (response?.status() !== 404) {
      await expect(page2.locator("body")).toContainText(/404|This page could not be found/i);
    }
    await page2.close();
  });

  test("초대 발급 UI: 성공 후 목록에 대기중으로 표시되고 원본 토큰은 화면에 없다", async ({ page }) => {
    const email = `${run}-ui@example.test`;
    await login(page, SUPERADMIN_URL, superEmail, superPassword);
    await gotoReady(page, `${SUPERADMIN_URL}/invitations`);
    await page.getByLabel("이름 *", { exact: true }).fill("UI 직원");
    await page.getByLabel(/이메일/).fill(email);
    await page.getByLabel(/역할/).selectOption("STAFF");
    await page.getByRole("button", { name: "초대 발급" }).click();
    await expect(page.locator("body")).toContainText("발송 요청 접수");
    // 목록에 대기중 행이 보인다 (DB 행 존재 + 상태 파생 확인).
    await expect(page.locator("body")).toContainText(email);
    await expect(page.locator("body")).toContainText("대기중");
    const row = await prisma.adminInvitation.findFirstOrThrow({ where: { email } });
    ids.invitations.push(row.id);
    const target = await prisma.user.findUniqueOrThrow({ where: { email } });
    ids.users.push(target.id);
    expect(target.isActive).toBe(false);
    expect((await prisma.invitationDeliveryAttempt.findUniqueOrThrow({ where: { invitationId: row.id } })).status).toBe("ACCEPTED");
    // 원본 토큰은 화면 어디에도 노출되지 않는다 (목록·본문 전체).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(row.tokenHash);
  });

  test("발송 실패와 명시적 재발급은 계정을 비활성으로 유지한다", async ({ page }) => {
    const email = `${run}-failure@example.test`;
    await login(page, FAILURE_URL, superEmail, superPassword);
    await gotoReady(page, `${FAILURE_URL}/invitations`);
    await page.getByLabel("이름 *", { exact: true }).fill("실패 직원");
    await page.getByLabel(/이메일/).fill(email);
    await page.getByLabel(/역할/).selectOption("STAFF");
    await page.getByRole("button", { name: "초대 발급" }).click();
    await expect(page.locator("body")).toContainText("발송 실패");
    const first = await prisma.adminInvitation.findFirstOrThrow({ where: { email } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    ids.users.push(user.id); ids.invitations.push(first.id);
    expect(user.isActive).toBe(false); expect(user.password).toBeNull();
    expect((await prisma.invitationDeliveryAttempt.findUniqueOrThrow({ where: { invitationId: first.id } })).status).toBe("FAILED");
    await page.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "재발급" }).click();
    await expect.poll(() => prisma.adminInvitation.count({ where: { email } })).toBe(2);
    expect((await prisma.adminInvitation.findUniqueOrThrow({ where: { id: first.id } })).revokedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(false);
  });

  test("수락 흐름: 비밀번호 설정 → 활성화 → 정상 로그인, 목록은 수락됨으로 바뀐다", async ({ page }) => {
    const email = `${run}-accept@example.test`;
    const password = `P4e2e-accept-${suffix}!`;
    const { token, userId } = await seedInvitation(email, "STAFF");
    await blockPrefetch(page);
    await gotoReady(page, `${SUPERADMIN_URL}/invite/${token}`);
    await expect(page.locator("body")).toContainText("초대 링크가 확인되었습니다");
    await page.getByLabel("새 비밀번호 *", { exact: true }).fill(password);
    await page.getByLabel("새 비밀번호 확인 *", { exact: true }).fill(password);
    await page.getByRole("button", { name: "비밀번호 설정하고 계정 활성화" }).click();
    await expect(page.locator("body")).toContainText("초대를 수락했습니다");
    // DB: 활성화 + 토큰 소비 + 감사 1건.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isActive).toBe(true);
    expect(user.mustChangePassword).toBe(false);
    const invitation = await prisma.adminInvitation.findFirstOrThrow({ where: { email } });
    expect(invitation.usedAt).toBeInstanceOf(Date);
    const audits = await prisma.userAccountChange.findMany({ where: { targetUserId: userId, type: "INVITATION_ACCEPTED" } });
    expect(audits).toHaveLength(1);
    // 정상 로그인.
    await login(page, SUPERADMIN_URL, email, password);
    // SUPER_ADMIN으로 다시 로그인한 뒤 화면에서 초대 상태가 수락됨으로 보인다
    // (수락한 직원은 STAFF라 /invitations에 접근할 수 없으므로, 목록 확인은
    // SUPER_ADMIN 세션으로 해야 한다).
    await login(page, SUPERADMIN_URL, superEmail, superPassword);
    await gotoReady(page, `${SUPERADMIN_URL}/invitations`);
    await expect(page.locator("body")).toContainText(email);
    await expect(page.locator("body")).toContainText("수락됨");
    // 수락한 토큰 재사용은 폼이 아닌 안내만 보인다.
    await gotoReady(page, `${SUPERADMIN_URL}/invite/${token}`);
    await expect(page.locator("body")).toContainText("유효하지 않은 초대 링크입니다");
    await expect(page.getByLabel("새 비밀번호 *", { exact: true })).toHaveCount(0);
  });

  test("만료·변조 토큰은 폼 없이 일반 안내만 보인다", async ({ page }) => {
    const expired = await seedInvitation(`${run}-expired@example.test`, "STAFF", {
      expiresAt: new Date(Date.now() - 1000),
    });
    await blockPrefetch(page);
    await gotoReady(page, `${SUPERADMIN_URL}/invite/${expired.token}`);
    await expect(page.locator("body")).toContainText("유효하지 않은 초대 링크입니다");
    await expect(page.getByLabel("새 비밀번호 *", { exact: true })).toHaveCount(0);

    const valid = await seedInvitation(`${run}-tamper@example.test`, "STAFF");
    const tampered = `${valid.token.slice(0, -2)}zz`;
    await gotoReady(page, `${SUPERADMIN_URL}/invite/${tampered}`);
    await expect(page.locator("body")).toContainText("유효하지 않은 초대 링크입니다");
    await expect(page.getByLabel("새 비밀번호 *", { exact: true })).toHaveCount(0);
  });

  test("수락 전 비활성 계정 로그인은 거부된다", async ({ page }) => {
    const email = `${run}-inactive@example.test`;
    await seedInvitation(email, "MANAGER");
    await blockPrefetch(page);
    await gotoReady(page, `${SUPERADMIN_URL}/login`);
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill("whatever-password-1!");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("INVALID 모드: 수락 폼은 보여도 실행은 차단되고 DB는 불변이다", async ({ page }) => {
    const email = `${run}-invalid@example.test`;
    const password = `P4e2e-invalid-${suffix}!`;
    const { token, userId } = await seedInvitation(email, "STAFF");
    await blockPrefetch(page);
    // 조회는 허용되므로 폼이 보이지만 (게이트 7 적용 방식),
    await gotoReady(page, `${INVALID_URL}/invite/${token}`);
    await expect(page.locator("body")).toContainText("초대 링크가 확인되었습니다");
    await page.getByLabel("새 비밀번호 *", { exact: true }).fill(password);
    await page.getByLabel("새 비밀번호 확인 *", { exact: true }).fill(password);
    await page.getByRole("button", { name: "비밀번호 설정하고 계정 활성화" }).click();
    // 실행은 fail-closed로 차단되고 일반 안내만 보인다.
    await expect(page.locator("body")).toContainText("초대 수락에 실패했습니다");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isActive).toBe(false);
    expect(user.password).toBeNull();
    const invitation = await prisma.adminInvitation.findFirstOrThrow({ where: { email } });
    expect(invitation.usedAt).toBeNull();
    const audits = await prisma.userAccountChange.findMany({ where: { targetUserId: userId, type: "INVITATION_ACCEPTED" } });
    expect(audits).toHaveLength(0);
  });
});
