import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

const suffix = `${Date.now()}`;
let programId: string;
let classId: string;
const childIds: string[] = [];
const reservationIds: string[] = [];
const paymentIds: string[] = [];
const paymentItemIds: string[] = [];
const refundIds: string[] = [];

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", ADMIN_EMAIL as string);
  await page.fill("#password", ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function summaryValue(page: Page, label: string) {
  return page.getByTestId(`summary-${label}`).locator(".tabular-nums").innerText();
}

test.beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const program = await prisma.program.create({
    data: { name: `E2E_TEST_REVENUE_${suffix}`, defaultPrice: 100_000 },
  });
  programId = program.id;
  const classSchedule = await prisma.classSchedule.create({
    data: {
      programId,
      startsAt: new Date("2026-07-10T00:00:00.000Z"),
      endsAt: new Date("2026-07-10T02:00:00.000Z"),
      location: `E2E_TEST_REVENUE_${suffix}`,
      capacity: 8,
    },
  });
  classId = classSchedule.id;

  for (const name of ["미결제", "사전취소", "참여후취소", "노쇼", "계좌결제", "취소결제"]) {
    const child = await prisma.child.create({ data: { name: `E2E_TEST_REVENUE_${name}_${suffix}` } });
    childIds.push(child.id);
  }

  const reservations = await Promise.all([
    prisma.reservation.create({ data: { childId: childIds[0], classScheduleId: classId, status: "RESERVED" } }),
    prisma.reservation.create({
      data: {
        childId: childIds[1],
        classScheduleId: classId,
        status: "CANCELLED",
        cancelledAt: new Date("2026-07-09T00:00:00.000Z"),
        cancelReason: "PERSONAL",
      },
    }),
    prisma.reservation.create({
      data: {
        childId: childIds[2],
        classScheduleId: classId,
        status: "CANCELLED",
        attendance: "PRESENT",
        attendanceRecordedAt: new Date("2026-07-10T03:00:00.000Z"),
        attendanceRecordedById: admin.id,
        cancelledAt: new Date("2026-07-11T00:00:00.000Z"),
        cancelReason: "OPERATION",
      },
    }),
    prisma.reservation.create({
      data: {
        childId: childIds[3],
        classScheduleId: classId,
        status: "NO_SHOW",
        attendance: "ABSENT",
        attendanceRecordedAt: new Date("2026-07-10T03:00:00.000Z"),
        attendanceRecordedById: admin.id,
      },
    }),
    prisma.reservation.create({ data: { childId: childIds[4], classScheduleId: classId, status: "RESERVED" } }),
    prisma.reservation.create({ data: { childId: childIds[5], classScheduleId: classId, status: "RESERVED" } }),
  ]);
  reservationIds.push(...reservations.map((reservation) => reservation.id));

  const cardPayment = await prisma.payment.create({
    data: {
      method: "CARD",
      status: "PARTIAL_REFUNDED",
      paidAt: new Date("2026-07-15T00:00:00.000Z"),
      totalAmount: 90_000,
      items: {
        create: {
          reservationId: reservationIds[2],
          amount: 100_000,
          discountAmount: 10_000,
          paidAmount: 90_000,
          refundedAmount: 30_000,
        },
      },
    },
    include: { items: true },
  });
  const transferPayment = await prisma.payment.create({
    data: {
      method: "TRANSFER",
      status: "PAID",
      paidAt: new Date("2026-07-20T00:00:00.000Z"),
      totalAmount: 50_000,
      items: {
        create: {
          reservationId: reservationIds[4],
          amount: 50_000,
          discountAmount: 0,
          paidAmount: 50_000,
        },
      },
    },
    include: { items: true },
  });
  const cancelledPayment = await prisma.payment.create({
    data: {
      method: "CASH",
      status: "CANCELLED",
      paidAt: new Date("2026-07-22T00:00:00.000Z"),
      totalAmount: 40_000,
      items: {
        create: {
          reservationId: reservationIds[5],
          amount: 40_000,
          discountAmount: 0,
          paidAmount: 40_000,
        },
      },
    },
    include: { items: true },
  });
  paymentIds.push(cardPayment.id, transferPayment.id, cancelledPayment.id);
  paymentItemIds.push(cardPayment.items[0].id, transferPayment.items[0].id, cancelledPayment.items[0].id);

  for (const refund of [
    { amount: 10_000, status: "COMPLETED" as const, refundedAt: new Date("2026-08-05T00:00:00.000Z") },
    { amount: 20_000, status: "COMPLETED" as const, refundedAt: new Date("2026-08-06T00:00:00.000Z") },
    { amount: 5_000, status: "REQUESTED" as const, refundedAt: new Date("2026-08-07T00:00:00.000Z") },
    { amount: 5_000, status: "CANCELLED" as const, refundedAt: new Date("2026-08-08T00:00:00.000Z") },
  ]) {
    const created = await prisma.refund.create({
      data: {
        paymentItemId: cardPayment.items[0].id,
        reason: "OPERATION",
        processedById: admin.id,
        ...refund,
      },
    });
    refundIds.push(created.id);
  }
});

test.afterAll(async () => {
  await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  await prisma.paymentItem.deleteMany({ where: { id: { in: paymentItemIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
  await prisma.classSchedule.deleteMany({ where: { id: classId } });
  await prisma.child.deleteMany({ where: { id: { in: childIds } } });
  await prisma.program.deleteMany({ where: { id: programId } });

  const leftovers = await Promise.all([
    prisma.program.count({ where: { name: { startsWith: `E2E_TEST_REVENUE_${suffix}` } } }),
    prisma.child.count({ where: { name: { startsWith: "E2E_TEST_REVENUE_", endsWith: suffix } } }),
    prisma.classSchedule.count({ where: { location: `E2E_TEST_REVENUE_${suffix}` } }),
  ]);
  expect(leftovers).toEqual([0, 0, 0]);
  await prisma.$disconnect();
});

test.describe.serial("Phase 9 매출 집계", () => {
  test("미인증 직접 URL 접근을 차단한다", async ({ page }) => {
    await page.goto("/revenue");
    await expect(page).toHaveURL(/\/login/);
  });

  test("7월 결제와 운영 지표를 집계하고 8월 환불을 소급하지 않는다", async ({ page }) => {
    await login(page);
    await page.goto(`/revenue?dateFrom=2026-07-01&dateTo=2026-07-31&programId=${programId}`);

    await expect(page.getByText("결제수단·환불 여부는 금액 지표에만 적용됩니다.")).toBeVisible();
    expect(await summaryValue(page, "예약 수")).toBe("5건");
    expect(await summaryValue(page, "참여 인원")).toBe("1명");
    expect(await summaryValue(page, "총 정가")).toBe("150,000원");
    expect(await summaryValue(page, "총 할인")).toBe("10,000원");
    expect(await summaryValue(page, "총 결제")).toBe("140,000원");
    expect(await summaryValue(page, "총 환불")).toBe("0원");
    expect(await summaryValue(page, "순매출")).toBe("140,000원");

    const programRow = page.getByTestId(`program-row-${programId}`);
    const classRow = page.getByTestId(`class-row-${classId}`);
    await expect(programRow).toContainText("150,000원");
    await expect(classRow).toContainText("150,000원");
  });

  test("8월에는 완료 환불만 합산하고 여러 Refund가 결제 원금을 중복시키지 않는다", async ({ page }) => {
    await login(page);
    await page.goto(`/revenue?dateFrom=2026-08-01&dateTo=2026-08-31&programId=${programId}`);

    expect(await summaryValue(page, "총 결제")).toBe("0원");
    expect(await summaryValue(page, "총 환불")).toBe("30,000원");
    expect(await summaryValue(page, "순매출")).toBe("-30,000원");
  });

  test("결제수단과 환불 여부를 바꿔도 운영 지표는 같고 금액만 달라진다", async ({ page }) => {
    await login(page);
    const base = `/revenue?dateFrom=2026-07-01&dateTo=2026-07-31&programId=${programId}`;

    await page.goto(`${base}&paymentMethod=CARD`);
    expect(await summaryValue(page, "예약 수")).toBe("5건");
    expect(await summaryValue(page, "참여 인원")).toBe("1명");
    expect(await summaryValue(page, "총 결제")).toBe("90,000원");

    await page.goto(`${base}&paymentMethod=TRANSFER`);
    expect(await summaryValue(page, "예약 수")).toBe("5건");
    expect(await summaryValue(page, "참여 인원")).toBe("1명");
    expect(await summaryValue(page, "총 결제")).toBe("50,000원");

    await page.goto(`${base}&refundState=NONE`);
    expect(await summaryValue(page, "예약 수")).toBe("5건");
    expect(await summaryValue(page, "참여 인원")).toBe("1명");
    expect(await summaryValue(page, "총 결제")).toBe("50,000원");

    await page.goto(`${base}&refundState=PARTIAL`);
    expect(await summaryValue(page, "예약 수")).toBe("5건");
    expect(await summaryValue(page, "참여 인원")).toBe("1명");
    expect(await summaryValue(page, "총 결제")).toBe("90,000원");
  });

  test("모바일은 3열, 데스크톱은 5열을 표시한다", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/revenue?dateFrom=2026-07-01&dateTo=2026-07-31&programId=${programId}`);

    const programSection = page.getByRole("heading", { name: "프로그램별 집계" }).locator("..", { hasText: "프로그램별 집계" });
    const headers = page.getByRole("columnheader");
    await expect(headers.filter({ hasText: "결제" }).first()).toBeHidden();
    await expect(headers.filter({ hasText: "환불" }).first()).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(headers.filter({ hasText: "결제" }).first()).toBeVisible();
    await expect(headers.filter({ hasText: "환불" }).first()).toBeVisible();
    await expect(programSection).toBeVisible();
  });
});
