import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { formatKstDateTimeRange } from "@/lib/classes/datetime";

/**
 * ADR-026/027/028 검증: endsAt 이 지난(표시상 "완료") 클래스가
 * - 목록 필터("예정")에서 제외되는지 (a)
 * - 상세 화면에서 "클래스 취소" 버튼이 숨는지 (b)
 * - 새 예약이 서버에서 차단되는지 (c, 버튼 숨김 + URL 직접 조작 우회 시도까지)
 * 를 실제 로그인 세션으로 확인한다.
 */

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 없습니다. .env 에 설정되어 있는지, playwright.config.ts 가 로드하는지 확인하세요.",
  );
}

const PROGRAM_NAME = "E2E_TEST_클래스종료라이프사이클";
const LOCATION = "E2E_TEST_장소";

const now = Date.now();
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// 실제 데이터와 우연히 겹치지 않도록 충분히 먼 과거/미래 + 특이한 분 단위를 쓴다.
const PAST_STARTS_AT = new Date(now - 3 * ONE_DAY_MS);
const PAST_ENDS_AT = new Date(PAST_STARTS_AT.getTime() + ONE_HOUR_MS);
const FUTURE_STARTS_AT = new Date(now + 3 * ONE_DAY_MS);
const FUTURE_ENDS_AT = new Date(FUTURE_STARTS_AT.getTime() + ONE_HOUR_MS);

const PAST_CLASS_ROW_TEXT = formatKstDateTimeRange(PAST_STARTS_AT, PAST_ENDS_AT);
const FUTURE_CLASS_ROW_TEXT = formatKstDateTimeRange(FUTURE_STARTS_AT, FUTURE_ENDS_AT);

let programId: string;
let pastClassId: string;
let futureClassId: string;
let childId: string;

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", ADMIN_EMAIL as string);
  await page.fill("#password", ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async () => {
  const program = await prisma.program.create({
    data: { name: PROGRAM_NAME, defaultPrice: 0 },
  });
  programId = program.id;

  const pastClass = await prisma.classSchedule.create({
    data: {
      programId,
      startsAt: PAST_STARTS_AT,
      endsAt: PAST_ENDS_AT,
      location: LOCATION,
      capacity: 8,
      status: "SCHEDULED",
    },
  });
  pastClassId = pastClass.id;

  const futureClass = await prisma.classSchedule.create({
    data: {
      programId,
      startsAt: FUTURE_STARTS_AT,
      endsAt: FUTURE_ENDS_AT,
      location: LOCATION,
      capacity: 8,
      status: "SCHEDULED",
    },
  });
  futureClassId = futureClass.id;

  const child = await prisma.child.create({
    data: { name: "E2E_TEST_아이", isActive: true },
  });
  childId = child.id;
});

test.afterAll(async () => {
  // FK 순서: Reservation → ClassTeacher → ClassSchedule → Child → Program.
  // 와일드카드 없이 beforeAll 에서 저장해둔 id 로만 지운다.
  await prisma.reservation.deleteMany({
    where: { classScheduleId: { in: [pastClassId, futureClassId] } },
  });
  await prisma.classTeacher.deleteMany({
    where: { classScheduleId: { in: [pastClassId, futureClassId] } },
  });
  await prisma.classSchedule.deleteMany({
    where: { id: { in: [pastClassId, futureClassId] } },
  });
  await prisma.child.delete({ where: { id: childId } });
  await prisma.program.delete({ where: { id: programId } });
  await prisma.$disconnect();
});

test.describe("클래스 종료(endsAt 경과) 라이프사이클", () => {
  test("(a) '예정' 필터에는 이미 끝난 클래스가 나오지 않는다", async ({ page }) => {
    await login(page);

    await page.goto("/classes?status=SCHEDULED");

    await expect(page.getByText(FUTURE_CLASS_ROW_TEXT, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(PAST_CLASS_ROW_TEXT, { exact: false })).toHaveCount(0);
  });

  test("(a-2) '완료' 필터에는 이미 끝난 클래스만 나온다", async ({ page }) => {
    await login(page);

    await page.goto("/classes?status=COMPLETED");

    await expect(page.getByText(PAST_CLASS_ROW_TEXT, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(FUTURE_CLASS_ROW_TEXT, { exact: false })).toHaveCount(0);
  });

  test("(b) 종료된 클래스 상세에는 '완료' 배지가 보이고 '클래스 취소' 버튼이 없다", async ({ page }) => {
    await login(page);

    await page.goto(`/classes/${pastClassId}`);

    await expect(page.getByText("완료", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "클래스 취소" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "정보 수정" })).toHaveCount(0);
  });

  test("(c) 종료된 클래스 상세에는 '예약 추가' 버튼이 없다", async ({ page }) => {
    await login(page);

    await page.goto(`/classes/${pastClassId}`);

    await expect(page.getByRole("link", { name: "예약 추가" })).toHaveCount(0);
  });

  test("(c) URL을 직접 조작해 종료된 클래스에 예약을 시도하면 서버가 거부한다", async ({ page }) => {
    await login(page);

    await page.goto(`/reservations/new?classScheduleId=${pastClassId}`);
    await page.waitForLoadState("networkidle");

    // 종료된 클래스는 후보 목록에 없으므로 프리필 경고가 뜬다(제출 자체를 막지는 않는다).
    await expect(page.getByText("선택한 클래스는 이미 종료되었습니다.")).toBeVisible();

    // 브라우저 개발자도구 등으로 select 를 강제 조작해 제출하는 상황을 재현한다 —
    // 버튼 숨김/후보 목록 제외를 우회해도 서버가 실제로 막는지 확인하기 위함이다.
    await page.evaluate((id) => {
      const select = document.querySelector<HTMLSelectElement>("#classScheduleId");
      if (!select) throw new Error("classScheduleId select not found");
      const option = document.createElement("option");
      option.value = id;
      option.textContent = "FORCED_ENDED_CLASS_OPTION";
      select.appendChild(option);
      select.value = id;
    }, pastClassId);

    await expect(page.locator("#classScheduleId")).toHaveValue(pastClassId);
    await page.selectOption("#childId", childId);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/reservations/new") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "예약 등록" }).click(),
    ]);

    await expect(page.getByText("취소되었거나 완료된 클래스에는 예약할 수 없습니다.")).toBeVisible();

    // 실제로 예약이 생성되지 않았는지 DB 로도 확인한다.
    const reservation = await prisma.reservation.findUnique({
      where: { classScheduleId_childId: { classScheduleId: pastClassId, childId } },
    });
    expect(reservation).toBeNull();
  });
});
