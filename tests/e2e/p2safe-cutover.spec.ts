import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

/**
 * 단순화 결정(ADR-071) — 계정 관리는 전환 모드와 무관함을 실제 HTTP 요청과
 * 브라우저를 통해 검증한다.
 *
 * 이 스펙은 서버 가드·액션·DB 수준이 아니라 실제 Next.js 서버(next start 3대)와
 * 브라우저 상호작용을 검증한다. 서버 3대는 하네스가 미리 띄운다:
 * - LEGACY_ADMIN 모드 (P2SAFE_LEGACY_URL)
 * - SUPER_ADMIN 모드 (P2SAFE_SUPERADMIN_URL)
 * - INVALID 모드 (P2SAFE_INVALID_URL): 오타·미등록 설정
 * 각 서버는 같은 격리 PG를 보지만 포트가 달라 오리진이 분리되고, 모드는 서버별
 * 환경변수로 고정된다. 이 스펙은 모드를 바꾸지 않는다 (서버 재시작·재배포 영역).
 * 단순화 결정 이후 모드는 계정 관리 접근을 바꾸지 않는다 — 세 서버 모두에서
 * ADMIN·SUPER_ADMIN이 계정을 관리할 수 있음을 검증한다.
 *
 * 안전 가드: Preview/Production DB 접속 금지, 격리 PG·루프백 오리진만 허용,
 * 합성 계정만 사용, afterAll에서 합성 데이터 정리.
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

const LEGACY_URL = parseLoopbackUrl("P2SAFE_LEGACY_URL");
const SUPERADMIN_URL = parseLoopbackUrl("P2SAFE_SUPERADMIN_URL");
const INVALID_URL = parseLoopbackUrl("P2SAFE_INVALID_URL");
// 전용 하네스 환경변수가 없으면 import 시 throw하지 않고 파일 전체를 skip한다.
// 메인 설정의 `playwright test --list`(단위 테스트 local-origin-safety가 실행)는
// 이 환경변수를 주지 않으므로, throw하면 --list 자체가 실패한다. 전용 설정으로
// 실행할 때는 환경변수가 주어져 정상 실행된다.
const p2safeEnvReady = Boolean(LEGACY_URL && SUPERADMIN_URL && INVALID_URL);

if (process.env.PLAYWRIGHT_PREVIEW_E2E === "1" || process.env.VERCEL_ENV) {
  throw new Error("P2SAFE_LOCAL_ONLY");
}
assertSafeE2eDatabaseUrls({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

const suffix = `${Date.now()}`;
const userPassword = `P2safe-${suffix}!`;
const resetPassword = `P2safe-reset-${suffix}!`;

const ids = {
  users: [] as string[],
  teachers: [] as string[],
};

let superId = "";
let adminId = "";
let managerId = "";
let teacherId = "";
let teacherUserId = "";
let staffId = "";
let sessionUserId = "";
let staff2Id = "";
let legacyCreatedId = "";
let superCreatedId = "";
let auditUserId = "";

async function blockPrefetch(page: Page) {
  // 테스트 하네스 최적화(제품 동작 변경 없음): 관리자 레이아웃의 네비게이션 링크가
  // 페이지마다 ~12개 경로를 RSC prefetch하는데, 이 렌더링이 단일 스레드 서버의
  // 이벤트 루프를 차지해 서버 액션 응답 적용이 15초를 넘기는 현상이 반복됐다.
  // prefetch 요청만 중단하고 실제 네비게이션·액션 요청은 그대로 통과시킨다.
  await page.route("**/*", (route) => {
    if (route.request().headers()["next-router-prefetch"] === "1") {
      return route.abort();
    }
    return route.continue();
  });
}

async function gotoReady(page: Page, url: string) {
  // 수화 완료 전 폼 클릭이 서버 액션의 클라이언트 상태 갱신을 유실하는 현상을
  // 확인했으므로(서버는 커밋까지 완료, 버튼만 "처리 중..."에 멈춤), 폼 상호작용
  // 전에는 networkidle까지 기다린다. 순수 단언용 이동에는 쓰지 않는다.
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

async function expectDenied(page: Page, url: string) {
  const response = await page.goto(url);
  if (response?.status() !== 404) {
    await expect(page.locator("body")).toContainText(/404|This page could not be found/i);
  }
}

async function createUserViaUi(
  page: Page,
  origin: string,
  email: string,
  name: string,
  role: "STAFF" | "MANAGER",
) {
  await gotoReady(page, `${origin}/accounts/new`);
  await page.getByLabel("이름 *", { exact: true }).fill(name);
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/역할/).selectOption(role);
  await page.getByRole("button", { name: "계정 생성" }).click();
  await expect(page).toHaveURL(/\/accounts\/(?!new$)[^/?]+$/);
  const created = await prisma.user.findUniqueOrThrow({ where: { email } });
  ids.users.push(created.id);
  return created;
}

const p2safeSuite = p2safeEnvReady ? test.describe.serial : test.describe.skip;
p2safeSuite("단순화 결정(ADR-071) — 계정 관리는 모드와 무관하다 (HTTP/E2E)", () => {
  test.beforeAll(async () => {
    const passwordHash = await hash(userPassword, 4);
    const teacher = await prisma.teacher.create({
      data: { name: `P2safe 선생님 ${suffix}`, phone: "010-1111-2222" },
    });
    teacherId = teacher.id;
    ids.teachers.push(teacher.id);
    const users = await Promise.all([
      prisma.user.create({ data: { name: `P2safe 최고관리자 ${suffix}`, email: `super-${suffix}@p2safe.test`, password: passwordHash, role: "SUPER_ADMIN" } }),
      prisma.user.create({ data: { name: `P2safe 관리자 ${suffix}`, email: `admin-${suffix}@p2safe.test`, password: passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: `P2safe 매니저 ${suffix}`, email: `manager-${suffix}@p2safe.test`, password: passwordHash, role: "MANAGER" } }),
      prisma.user.create({ data: { name: `P2safe 계정 선생님 ${suffix}`, email: `teacher-${suffix}@p2safe.test`, password: passwordHash, role: "TEACHER", teacherId } }),
      prisma.user.create({ data: { name: `P2safe 직원 ${suffix}`, email: `staff-${suffix}@p2safe.test`, password: passwordHash, role: "STAFF" } }),
      prisma.user.create({ data: { name: `P2safe 세션 ${suffix}`, email: `session-${suffix}@p2safe.test`, password: passwordHash, role: "MANAGER" } }),
      prisma.user.create({ data: { name: `P2safe 직원2 ${suffix}`, email: `staff2-${suffix}@p2safe.test`, password: passwordHash, role: "STAFF" } }),
    ]);
    [superId, adminId, managerId, teacherUserId, staffId, sessionUserId, staff2Id] = users.map((user) => user.id);
    ids.users.push(...users.map((user) => user.id));
  });

  test.afterAll(async () => {
    await prisma.userAccountChange.deleteMany({
      where: { OR: [{ targetUserId: { in: ids.users } }, { actorAdminId: { in: ids.users } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.teacher.deleteMany({ where: { id: { in: ids.teachers } } });
    await prisma.$disconnect();
  });

  test("시나리오 1 — LEGACY 모드에서 기존 ADMIN이 계정을 생성·수정·재설정·비활성화한다", async ({ page }) => {
    await login(page, LEGACY_URL, `admin-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${LEGACY_URL}/dashboard`);
    expect(await page.content()).toContain('href="/accounts"');

    const created = await createUserViaUi(
      page,
      LEGACY_URL,
      `legacy-new-${suffix}@p2safe.test`,
      `P2safe LEGACY 신규 ${suffix}`,
      "STAFF",
    );
    legacyCreatedId = created.id;
    expect(created.password).toBeNull();
    expect(created.isActive).toBe(false);
    expect(created.mustChangePassword).toBe(false);
    const createdAudit = await prisma.userAccountChange.findFirstOrThrow({
      where: { targetUserId: created.id, type: "CREATED" },
      select: { actorAdminId: true, nextRole: true, nextIsActive: true },
    });
    expect(createdAudit.actorAdminId).toBe(adminId);
    expect(createdAudit.nextRole).toBe("STAFF");
    expect(createdAudit.nextIsActive).toBe(false);

    // 역할 변경: STAFF → MANAGER.
    await gotoReady(page, `${LEGACY_URL}/accounts/${created.id}/edit`);
    await page.getByLabel(/역할/).selectOption("MANAGER");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe("MANAGER");
    expect(
      await prisma.userAccountChange.count({
        where: { targetUserId: created.id, type: "ROLE_CHANGED", actorAdminId: adminId },
      }),
    ).toBe(1);

    // 재설정: 해시 교체·강제 변경·authVersion 증가.
    // 토스트 문구는 샌드박스 하네스에서 간헐적으로 클라이언트 적용이 유실되므로
    // (서버는 200 응답 + DB 커밋까지 완료, 버튼만 "처리 중..."에 멈춤 — 동일 흐름이
    // 다른 실행에서는 5초 내 적용됨) 게이트로 삼지 않고 관찰만 기록한다. 실질 계약은
    // DB 폴링 + reload 후 렌더로 검증한다.
    await gotoReady(page, `${LEGACY_URL}/accounts/${created.id}`);
    await page.getByLabel("새 임시 비밀번호").fill(resetPassword);
    await page.getByRole("button", { name: "비밀번호 재설정" }).click();
    const toastShown = await page.getByText("임시 비밀번호를 재설정했습니다.").waitFor({ timeout: 10000 }).then(() => true, () => false);
    console.log(`scenario1-reset-toast-shown=${toastShown}`);
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).mustChangePassword, { timeout: 30000 }).toBe(true);
    const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterReset.mustChangePassword).toBe(true);
    expect(afterReset.authVersion).toBe(3); // role change and password reset each increment once
    expect(
      await prisma.userAccountChange.count({
        where: { targetUserId: created.id, type: "PASSWORD_RESET", actorAdminId: adminId },
      }),
    ).toBe(1);
    await page.reload();
    await expect(page.locator("ol").getByText("비밀번호 재설정", { exact: true })).toBeVisible();
    await expect(page.getByText("변경 필요")).toBeVisible();
    expect(await page.content()).not.toContain(resetPassword);

    // 생성 시 비활성이므로, 활성 체크 → 저장(활성화) → 체크 해제 → 저장(비활성화)
    // 순서로 양방향을 확인한다.
    await gotoReady(page, `${LEGACY_URL}/accounts/${created.id}/edit`);
    const activeBox = page.getByLabel("활성 계정");
    await expect(activeBox).not.toBeChecked();
    await activeBox.click();
    await expect(activeBox).toBeChecked();
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(true);
    await gotoReady(page, `${LEGACY_URL}/accounts/${created.id}/edit`);
    await expect(page.getByLabel("활성 계정")).toBeChecked();
    await page.getByLabel("활성 계정").click();
    await expect(page.getByLabel("활성 계정")).not.toBeChecked();
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false);
    expect(
      await prisma.userAccountChange.count({
        where: { targetUserId: created.id, type: "ACTIVE_CHANGED", actorAdminId: adminId },
      }),
    ).toBe(2);
  });

  test("시나리오 2 — LEGACY 모드에서 일반 ADMIN의 SUPER_ADMIN 생성·승격이 가능하다", async ({ page }) => {
    await login(page, LEGACY_URL, `admin-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${LEGACY_URL}/accounts/new`);
    const options = await page.locator("#role option").evaluateAll((elements) =>
      elements.map((element) => (element as HTMLOptionElement).value),
    );
    expect(options).toContain("SUPER_ADMIN");
    expect(options).toEqual(expect.arrayContaining(["ADMIN", "MANAGER", "TEACHER", "STAFF"]));

    // ADMIN이 SUPER_ADMIN 계정을 직접 생성한다 (비밀번호 없이 비활성 생성).
    await page.getByLabel("이름 *", { exact: true }).fill(`P2safe LEGACY 신규 최고관리자 ${suffix}`);
    await page.getByLabel(/이메일/).fill(`legacy-super-${suffix}@p2safe.test`);
    await page.getByLabel(/역할/).selectOption("SUPER_ADMIN");
    await page.getByRole("button", { name: "계정 생성" }).click();
    await expect(page).toHaveURL(/\/accounts\/(?!new$)[^/?]+$/);
    const created = await prisma.user.findUniqueOrThrow({ where: { email: `legacy-super-${suffix}@p2safe.test` } });
    ids.users.push(created.id);
    expect(created.role).toBe("SUPER_ADMIN");
    expect(created.password).toBeNull();
    expect(created.isActive).toBe(false);

    // 시드된 SUPER_ADMIN 행도 일반 행처럼 편집할 수 있다 (읽기 전용이 아니다).
    await page.goto(`${LEGACY_URL}/accounts/${superId}/edit`);
    await expect(page.locator('button[type="submit"]')).toHaveCount(1);
  });

  test("시나리오 3 — SUPER_ADMIN 모드에서 SUPER_ADMIN이 계정을 생성·수정·비활성화한다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, `super-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${SUPERADMIN_URL}/dashboard`);
    expect(await page.content()).toContain('href="/accounts"');

    const created = await createUserViaUi(
      page,
      SUPERADMIN_URL,
      `super-new-${suffix}@p2safe.test`,
      `P2safe SUPER 신규 ${suffix}`,
      "STAFF",
    );
    superCreatedId = created.id;
    expect(created.password).toBeNull();
    expect(created.isActive).toBe(false);
    const createdAudit = await prisma.userAccountChange.findFirstOrThrow({
      where: { targetUserId: created.id, type: "CREATED" },
      select: { actorAdminId: true },
    });
    expect(createdAudit.actorAdminId).toBe(superId);

    await gotoReady(page, `${SUPERADMIN_URL}/accounts/${created.id}/edit`);
    await page.getByLabel(/역할/).selectOption("MANAGER");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe("MANAGER");

    // 생성 시 비활성이므로 활성 체크 → 저장으로 활성화까지 확인한다.
    await gotoReady(page, `${SUPERADMIN_URL}/accounts/${created.id}/edit`);
    const activeBox = page.getByLabel("활성 계정");
    await expect(activeBox).not.toBeChecked();
    await activeBox.click();
    await expect(activeBox).toBeChecked();
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(true);
    expect(
      await prisma.userAccountChange.count({
        where: { targetUserId: created.id, type: "ACTIVE_CHANGED", actorAdminId: superId },
      }),
    ).toBe(1);
  });

  test("시나리오 4 — SUPER_ADMIN 모드에서 ADMIN의 계정 관리가 허용된다", async ({ page }) => {
    const usersBefore = await prisma.user.count();
    await login(page, SUPERADMIN_URL, `admin-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${SUPERADMIN_URL}/dashboard`);
    expect(await page.content()).toContain('href="/accounts"');
    expect((await page.goto(`${SUPERADMIN_URL}/accounts`))?.status()).toBe(200);
    expect((await page.goto(`${SUPERADMIN_URL}/accounts/new`))?.status()).toBe(200);
    expect((await page.goto(`${SUPERADMIN_URL}/accounts/${superCreatedId}`))?.status()).toBe(200);
    const created = await createUserViaUi(
      page,
      SUPERADMIN_URL,
      `super-admin-created-${suffix}@p2safe.test`,
      `P2safe ADMIN 생성 ${suffix}`,
      "STAFF",
    );
    expect(created.role).toBe("STAFF");
    expect(await prisma.user.count()).toBe(usersBefore + 1);
  });

  test("시나리오 5 — ADMIN의 기존 수업·예약·금융 화면이 SUPER_ADMIN 모드에서도 정상 접근된다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, `admin-${suffix}@p2safe.test`, userPassword);
    for (const path of ["/dashboard", "/children", "/programs", "/classes", "/reservations", "/payments", "/revenue"]) {
      expect((await page.goto(`${SUPERADMIN_URL}${path}`))?.status()).toBe(200);
    }
  });

  test("시나리오 6 — MANAGER·TEACHER·STAFF의 계정 관리가 SUPER_ADMIN 모드에서 차단된다", async ({ page }) => {
    const cases = [
      `manager-${suffix}@p2safe.test`,
      `teacher-${suffix}@p2safe.test`,
      `staff-${suffix}@p2safe.test`,
    ];
    for (const email of cases) {
      await login(page, SUPERADMIN_URL, email, userPassword);
      await expectDenied(page, `${SUPERADMIN_URL}/accounts`);
      await expectDenied(page, `${SUPERADMIN_URL}/accounts/new`);
      await page.goto(`${SUPERADMIN_URL}/dashboard`);
      expect(await page.content()).not.toContain('href="/accounts"');
    }
  });

  test("시나리오 7 — 비활성 계정 및 authVersion 변경 후 기존 세션이 거부된다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, `session-${suffix}@p2safe.test`, userPassword);
    expect((await page.goto(`${SUPERADMIN_URL}/dashboard`))?.status()).toBe(200);

    await prisma.user.update({ where: { id: sessionUserId }, data: { isActive: false } });
    await page.goto(`${SUPERADMIN_URL}/dashboard`);
    await expect(page).toHaveURL(/\/login/);

    await prisma.user.update({ where: { id: sessionUserId }, data: { isActive: true } });
    await login(page, SUPERADMIN_URL, `session-${suffix}@p2safe.test`, userPassword);
    await prisma.user.update({ where: { id: sessionUserId }, data: { authVersion: { increment: 1 } } });
    await page.goto(`${SUPERADMIN_URL}/dashboard`);
    await expect(page).toHaveURL(/\/login/);

    await login(page, SUPERADMIN_URL, `session-${suffix}@p2safe.test`, userPassword);
    await prisma.user.update({ where: { id: sessionUserId }, data: { mustChangePassword: true } });
    await page.goto(`${SUPERADMIN_URL}/dashboard`);
    await expect(page).toHaveURL(/\/account\/password/);
    await prisma.user.update({ where: { id: sessionUserId }, data: { mustChangePassword: false } });
  });

  test("시나리오 8 — 계정 변경 시 DB 상태와 감사 기록이 일치한다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, `super-${suffix}@p2safe.test`, userPassword);
    const created = await createUserViaUi(
      page,
      SUPERADMIN_URL,
      `audit-${suffix}@p2safe.test`,
      `P2safe 감사 ${suffix}`,
      "STAFF",
    );
    auditUserId = created.id;

    await gotoReady(page, `${SUPERADMIN_URL}/accounts/${created.id}/edit`);
    await page.getByLabel(/역할/).selectOption("MANAGER");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    // 역할 변경 리다이렉트를 기다리지 않고 상세로 이동하면 진행 중 액션이 중단돼
    // 변경이 유실된다 — 시나리오 1과 동일하게 이동 완료를 확인한 뒤 진행한다.
    await expect(page).toHaveURL(new RegExp(`/accounts/${created.id}$`));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe("MANAGER");

    await gotoReady(page, `${SUPERADMIN_URL}/accounts/${created.id}`);
    await page.getByLabel("새 임시 비밀번호").fill(resetPassword);
    await page.getByRole("button", { name: "비밀번호 재설정" }).click();
    // 토스트는 시나리오 1과 같은 이유로 게이트로 삼지 않는다 (관찰만 기록).
    const toastShown = await page.getByText("임시 비밀번호를 재설정했습니다.").waitFor({ timeout: 10000 }).then(() => true, () => false);
    console.log(`scenario8-reset-toast-shown=${toastShown}`);
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).mustChangePassword, { timeout: 30000 }).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.role).toBe("MANAGER");
    expect(row.mustChangePassword).toBe(true);
    const audits = await prisma.userAccountChange.findMany({
      where: { targetUserId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((audit) => audit.type)).toEqual(["CREATED", "ROLE_CHANGED", "PASSWORD_RESET"]);
    expect(audits.every((audit) => audit.actorAdminId === superId)).toBe(true);
    const roleChanged = audits.find((audit) => audit.type === "ROLE_CHANGED")!;
    expect(roleChanged.previousRole).toBe("STAFF");
    expect(roleChanged.nextRole).toBe("MANAGER");
    expect(JSON.stringify(audits)).not.toContain(resetPassword);

    await page.reload();
    await expect(page.locator("ol").getByText("계정 생성", { exact: true })).toBeVisible();
    await expect(page.locator("ol").getByText("역할 변경", { exact: true })).toBeVisible();
    await expect(page.locator("ol").getByText("비밀번호 재설정", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(resetPassword);
  });

  test("시나리오 9 — 비인가 HTTP 요청에서 DB 변경이 없다", async ({ page }) => {
    const usersBefore = await prisma.user.count();
    const auditsBefore = await prisma.userAccountChange.count();

    // 익명 요청: 계정 목록은 로그인으로 리다이렉트된다.
    await page.goto(`${SUPERADMIN_URL}/accounts`);
    await expect(page).toHaveURL(/\/login/);

    // MANAGER의 계정 생성 페이지 직접 요청: 404로 거부된다.
    await login(page, SUPERADMIN_URL, `manager-${suffix}@p2safe.test`, userPassword);
    await expectDenied(page, `${SUPERADMIN_URL}/accounts/new`);

    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.userAccountChange.count()).toBe(auditsBefore);
  });

  test("시나리오 10 — SUPER_ADMIN이 계정 변경 이력을 조회하고 본인 이력은 본인 행만 보인다", async ({ page }) => {
    await login(page, SUPERADMIN_URL, `super-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${SUPERADMIN_URL}/accounts/${auditUserId}`);
    await expect(page.locator("ol").getByText("계정 생성", { exact: true })).toBeVisible();
    await expect(page.locator("ol").getByText("역할 변경", { exact: true })).toBeVisible();

    // staff2의 이메일을 SUPER_ADMIN이 바꾸면(역할은 STAFF 유지 — 본인 이력 경로가
    // STAFF에게 열려 있으므로), staff2 본인 이력에는 그 행 1건만 보인다.
    await gotoReady(page, `${SUPERADMIN_URL}/accounts/${staff2Id}/edit`);
    await page.getByLabel(/이메일/).fill(`staff2-new-${suffix}@p2safe.test`);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    // 이메일 변경 리다이렉트 완료를 확인한 뒤 로그인한다 (진행 중 액션 중단 방지).
    await expect(page).toHaveURL(new RegExp(`/accounts/${staff2Id}$`));
    await login(page, SUPERADMIN_URL, `staff2-new-${suffix}@p2safe.test`, userPassword);
    await page.goto(`${SUPERADMIN_URL}/account/history`);
    await expect(page.locator("ol li")).toHaveCount(1);
    await expect(page.locator("ol").getByText("이메일 변경", { exact: true })).toBeVisible();
    expect(await page.content()).toContain(`staff2-${suffix}@p2safe.test → staff2-new-${suffix}@p2safe.test`);
    expect(await page.content()).not.toContain(`admin-${suffix}@p2safe.test`);

    await login(page, SUPERADMIN_URL, `manager-${suffix}@p2safe.test`, userPassword);
    await expectDenied(page, `${SUPERADMIN_URL}/account/history`);
  });

  test("INVALID 모드 — 설정이 잘못돼도 SUPER_ADMIN·ADMIN 모두 계정 관리에 접근할 수 있다", async ({ page }) => {
    await login(page, INVALID_URL, `super-${suffix}@p2safe.test`, userPassword);
    expect((await page.goto(`${INVALID_URL}/dashboard`))?.status()).toBe(200);
    expect((await page.goto(`${INVALID_URL}/accounts`))?.status()).toBe(200);
    await page.goto(`${INVALID_URL}/dashboard`);
    expect(await page.content()).toContain('href="/accounts"');

    await login(page, INVALID_URL, `admin-${suffix}@p2safe.test`, userPassword);
    expect((await page.goto(`${INVALID_URL}/accounts`))?.status()).toBe(200);
  });
});
