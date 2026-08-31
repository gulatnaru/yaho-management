import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

const suffix = `${Date.now()}`;
let adminId: string;
let programId: string;
let classId: string;
let childId: string;
let reservationId: string;
let paymentId: string | undefined;
let paymentItemId: string | undefined;

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", ADMIN_EMAIL as string);
  await page.fill("#password", ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  adminId = admin.id;
  const program = await prisma.program.create({ data: { name: `E2E_TEST_PAYMENT_${suffix}`, defaultPrice: 40000 } });
  programId = program.id;
  const classSchedule = await prisma.classSchedule.create({
    data: {
      programId,
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 3_600_000),
      location: `E2E_TEST_PAYMENT_${suffix}`,
      capacity: 8,
    },
  });
  classId = classSchedule.id;
  const child = await prisma.child.create({ data: { name: `E2E_TEST_PAYMENT_CHILD_${suffix}`, guardianName: "테스트 보호자" } });
  childId = child.id;
  const reservation = await prisma.reservation.create({
    data: {
      childId,
      classScheduleId: classId,
      status: "NO_SHOW",
      attendance: "ABSENT",
      attendanceRecordedAt: new Date(),
      attendanceRecordedById: adminId,
    },
  });
  reservationId = reservation.id;
});

test.afterAll(async () => {
  const item = await prisma.paymentItem.findUnique({ where: { reservationId }, select: { id: true, paymentId: true } });
  if (item) {
    await prisma.refund.deleteMany({ where: { paymentItemId: item.id } });
    await prisma.paymentItem.delete({ where: { id: item.id } });
    await prisma.payment.delete({ where: { id: item.paymentId } });
  }
  await prisma.reservation.deleteMany({ where: { id: reservationId } });
  await prisma.classSchedule.deleteMany({ where: { id: classId } });
  await prisma.child.deleteMany({ where: { id: childId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.$disconnect();
});

test.describe.serial("Phase 8 결제·환불 라이프사이클", () => {
  test("서버가 할인 후 paidAmount를 계산하고 동일 예약 중복 결제를 막는다", async ({ page }) => {
    await login(page);
    await page.goto(`/payments/new?reservationId=${reservationId}`);
    await page.fill("#amount", "40000");
    await page.fill("#discountAmount", "50000");
    await page.selectOption("#method", "CARD");
    await page.fill("#payerName", "QA 결제자");
    await page.fill("#memo", "QA 결제 메모");

    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/payments/new") && response.request().method() === "POST"),
      page.getByRole("button", { name: "결제 등록" }).click(),
    ]);
    await expect(page.getByText("할인금액은 정가를 초과할 수 없습니다.")).toBeVisible();
    await expect(page.locator("#amount")).toHaveValue("40000");
    await expect(page.locator("#discountAmount")).toHaveValue("50000");
    await expect(page.locator("#method")).toHaveValue("CARD");
    await expect(page.locator("#payerName")).toHaveValue("QA 결제자");
    await expect(page.locator("#memo")).toHaveValue("QA 결제 메모");

    await page.fill("#discountAmount", "5000");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/payments/new") && response.request().method() === "POST"),
      page.getByRole("button", { name: "결제 등록" }).click(),
    ]);
    await expect(page).toHaveURL(/\/payments\/(?!new(?:\?|$))[^/?]+$/);

    const item = await prisma.paymentItem.findUniqueOrThrow({ where: { reservationId } });
    paymentItemId = item.id;
    paymentId = item.paymentId;
    expect(item.paidAmount).toBe(35000);

    await page.goto(`/payments/new?reservationId=${reservationId}`);
    await expect(page.getByText("이미 결제가 등록된 예약입니다.")).toBeVisible();
  });

  test("모바일 결제 목록은 아이·금액·상태 3열만 노출한다", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/payments");

    await expect(page.getByRole("columnheader", { name: "아이" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "금액" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "상태" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "클래스" })).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "결제일시" })).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("columnheader", { name: "클래스" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "결제일시" })).toBeVisible();
  });

  test("NO_SHOW 환불은 상세 사유가 필수이고 부분 환불 누계를 반영한다", async ({ page }) => {
    await login(page);
    await page.goto(`/refunds/new?paymentItemId=${paymentItemId}`);
    await page.fill("#amount", "10000");
    await page.selectOption("#reason", "OTHER");
    await page.getByRole("button", { name: "환불 처리" }).click();
    await expect(page.getByText("노쇼 환불은 상세 사유를 반드시 입력해주세요.")).toBeVisible();

    await page.fill("#reasonDetail", "운영상 승인한 예외 환불");
    await page.getByRole("button", { name: "환불 처리" }).click();
    await expect(page).toHaveURL(`/payments/${paymentId}`);
    await expect(page.getByText("완료", { exact: true })).toBeVisible();

    const item = await prisma.paymentItem.findUniqueOrThrow({ where: { id: paymentItemId } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(item.refundedAmount).toBe(10000);
    expect(payment.status).toBe("PARTIAL_REFUNDED");
  });

  test("NO_SHOW 예약 취소는 출결과 환불 이력을 보존하며 자동 환불하지 않는다", async ({ page }) => {
    await login(page);
    await page.goto(`/reservations/${reservationId}/cancel`);
    await page.selectOption("#cancelReason", "PERSONAL");
    await page.getByRole("button", { name: "예약 취소" }).click();
    await expect(page).toHaveURL(`/reservations/${reservationId}`);

    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    const item = await prisma.paymentItem.findUniqueOrThrow({ where: { id: paymentItemId } });
    expect(reservation.status).toBe("CANCELLED");
    expect(reservation.attendance).toBe("ABSENT");
    expect(reservation.attendanceRecordedAt).not.toBeNull();
    expect(item.refundedAmount).toBe(10000);
  });
});
