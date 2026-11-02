import { expect, test, type Page } from "@playwright/test";
import { hash } from "bcryptjs";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// Fail-closed: 이 스펙은 전용 로컬 격리 DB에서만 실행한다.
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

const run = `logout-${Date.now().toString(36)}`;
const password = `${run}-Password1!`;
const email = (kind: string) => `${run}-${kind}@example.test`;

async function login(page: Page, emailValue: string, passwordValue: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(emailValue);
  await page.getByLabel("비밀번호").fill(passwordValue);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}

function headerLogoutButton(page: Page) {
  // 데스크톱 헤더 오른쪽(사용자 이름 옆) 버튼. 모바일 드로어 버튼과 구분한다.
  return page.locator("header > div > div.hidden.md\\:flex").getByRole("button", { name: "로그아웃" });
}

function drawerLogoutButton(page: Page) {
  return page.locator("#mobile-nav-drawer").getByRole("button", { name: "로그아웃" });
}

async function expectUnauthenticated(page: Page) {
  const response = await page.request.get("/api/auth/session");
  const body = (await response.json()) as { user?: unknown } | null;
  expect(body?.user).toBeUndefined();
}

test.beforeAll(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const hashed = await hash(password, 4);
    const teacher = await db.teacher.create({ data: { name: `${run} teacher` } });
    await db.user.create({
      data: { name: `${run} admin`, email: email("admin"), password: hashed, role: "ADMIN" },
    });
    await db.user.create({
      data: { name: `${run} teacher`, email: email("teacher"), password: hashed, role: "TEACHER", teacherId: teacher.id },
    });
    await db.user.create({
      data: { name: `${run} manager`, email: email("manager"), password: hashed, role: "MANAGER" },
    });
    // STAFF·SUPER_ADMIN은 생성 클라이언트의 Role enum에 없어 raw SQL로만 생성 가능하다.
    // (DB enum에는 RBAC 마이그레이션으로 존재하며, CHECK 제약(role=TEACHER ⟺ teacherId)은 통과한다.)
    await db.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, password, role, "isActive", "mustChangePassword", "authVersion", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'STAFF', true, false, 1, NOW(), NOW())`,
      `${run}-staff`,
      email("staff"),
      `${run} staff`,
      hashed,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, password, role, "isActive", "mustChangePassword", "authVersion", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', true, false, 1, NOW(), NOW())`,
      `${run}-super`,
      email("super"),
      `${run} super`,
      hashed,
    );
    // 비밀번호 변경 회귀용 전용 계정. 메인 admin 계정의 비밀번호를 바꾸지 않는다.
    await db.user.create({
      data: { name: `${run} pwadmin`, email: email("pwadmin"), password: hashed, role: "ADMIN" },
    });
  } finally {
    await db.$disconnect();
  }
});

test("desktop: ADMIN logout ends the session and blocks protected access", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, email("admin"), password);
  await expect(headerLogoutButton(page)).toBeVisible();
  await headerLogoutButton(page).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expectUnauthenticated(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  // 뒤로 가기로 보호 화면이 복원되지 않는다.
  await page.goBack();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
});

test("mobile: ADMIN logout from the drawer ends the session", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 667 });
  await login(page, email("admin"), password);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(drawerLogoutButton(page)).toBeVisible();
  // dev 전용 Next.js 오버레이(Open Next.js Dev Tools 포털)가 뷰포트 하단을 덮어
  // 실제 포인터 클릭을 가로막는 dev 하네스 아티팩트다. 프로덕션 빌드에는 오버레이가
  // 없어 실제 사용자 탭에는 영향이 없다. 버튼 표시(위)와 핸들러 흐름(아래)은 그대로
  // 검증하므로, 클릭만 DOM 디스패치로 수행한다.
  await drawerLogoutButton(page).evaluate((button) => (button as HTMLElement).click());
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expectUnauthenticated(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
});

test("logout button disables while pending and recovers on failure", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, email("admin"), password);
  // 처리 중 상태를 관측하기 위해 signout 응답을 지연시킨다.
  await page.route("**/api/auth/signout", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await headerLogoutButton(page).click();
  await expect(headerLogoutButton(page)).toBeDisabled();
  await expect(headerLogoutButton(page)).toHaveText("로그아웃 중...");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await page.unroute("**/api/auth/signout");

  // 실패 시: 이동하지 않고 버튼이 다시 활성화되며 일반 문구만 보인다.
  await login(page, email("admin"), password);
  await page.route("**/api/auth/signout", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await headerLogoutButton(page).click();
  await expect(page.getByText("로그아웃에 실패했습니다. 다시 시도해 주세요.")).toBeVisible();
  await expect(headerLogoutButton(page)).toBeEnabled();
  await expect(headerLogoutButton(page)).toHaveText("로그아웃");
  await expect(page).toHaveURL(/\/dashboard/);
  // 세션은 살아 있다.
  const session = (await (await page.request.get("/api/auth/session")).json()) as { user?: unknown };
  expect(session?.user).toBeDefined();
  await page.unroute("**/api/auth/signout");
});

test("double failure: signout 500 + session check 500 stays put with a generic message", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, email("admin"), password);
  await page.route("**/api/auth/signout", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await headerLogoutButton(page).click();
  await expect(page.getByText("로그아웃에 실패했습니다. 다시 시도해 주세요.")).toBeVisible();
  await expect(headerLogoutButton(page)).toBeEnabled();
  await expect(headerLogoutButton(page)).toHaveText("로그아웃");
  await expect(page).toHaveURL(/\/dashboard/);
  // 조회 실패가 소멸로 오독되어 이동하지 않는다. 인터셉트 해제 후 실제 세션을
  // 확인하면 살아 있다 (signout 실패 + 조회 실패 모두 fail-closed).
  await page.unroute("**/api/auth/signout");
  await page.unroute("**/api/auth/session");
  const session = (await (await page.request.get("/api/auth/session")).json()) as { user?: unknown };
  expect(session?.user).toBeDefined();
});

test("all roles render the logout button with their own menu sets", async ({ page }) => {
  test.setTimeout(180_000);
  const cases = [
    { kind: "teacher", present: ["내 클래스", "내 정보", "비밀번호 변경"], absent: ["계정 관리", "예약 신청"] },
    { kind: "staff", present: ["대시보드", "비밀번호 변경"], absent: ["계정 관리", "예약 신청", "아이 관리"] },
    { kind: "manager", present: ["대시보드", "아이 관리", "비밀번호 변경"], absent: ["계정 관리"] },
    // LEGACY_ADMIN 모드: SUPER_ADMIN은 계정 관리를 보지 못하고 직원 초대를 본다.
    { kind: "super", present: ["직원 초대", "예약 신청"], absent: ["계정 관리"] },
  ] as const;
  for (const roleCase of cases) {
    const context = await page.context().browser()?.newContext();
    if (!context) throw new Error("browser context unavailable");
    const rolePage = await context.newPage();
    try {
      await login(rolePage, email(roleCase.kind), password);
      await expect(headerLogoutButton(rolePage)).toBeVisible();
      for (const label of roleCase.present) {
        await expect(rolePage.getByRole("link", { name: label })).toBeVisible();
      }
      for (const label of roleCase.absent) {
        await expect(rolePage.getByRole("link", { name: label })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
  // STAFF 가드 스팟 체크: 계정 관리 진입 시 계정 관리 화면이 열리지 않는다.
  const staffContext = await page.context().browser()?.newContext();
  if (!staffContext) throw new Error("browser context unavailable");
  const staffPage = await staffContext.newPage();
  try {
    await login(staffPage, email("staff"), password);
    await staffPage.goto("/accounts");
    await expect(staffPage.getByText("내부 운영자의 역할")).toHaveCount(0);
  } finally {
    await staffContext.close();
  }
});

test("password change still forces logout (existing server signOut regression)", async ({ page }) => {
  test.setTimeout(180_000);
  const newPassword = `${run}-NewPass1!`;
  await login(page, email("pwadmin"), password);
  await page.goto("/account/password");
  await page.getByLabel("현재 비밀번호").fill(password);
  await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
  await page.getByLabel("새 비밀번호 확인").fill(newPassword);
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expectUnauthenticated(page);
  // 새 비밀번호로는 로그인되고, 구 비밀번호로는 거부된다.
  await login(page, email("pwadmin"), newPassword);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email("pwadmin"));
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeVisible();
});
