import { randomUUID } from "node:crypto";
import {
  PrismaClient,
  type AttendanceStatus,
  type ClassStatus,
  type PaymentStatus,
  type ReservationStatus,
} from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

type Resources = {
  marker: string;
  programIds: string[];
  classIds: string[];
  childIds: string[];
  reservationIds: string[];
  paymentIds: string[];
  paymentItemIds: string[];
};

type HistoryFixtureInput = {
  childId: string;
  adminId: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  classStatus?: ClassStatus;
  reservationStatus?: ReservationStatus;
  attendance?: AttendanceStatus | null;
  paymentStatus?: PaymentStatus;
};

function createResources(): Resources {
  return {
    marker: `E2E_P13_${randomUUID()}`,
    programIds: [],
    classIds: [],
    childIds: [],
    reservationIds: [],
    paymentIds: [],
    paymentItemIds: [],
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(ADMIN_EMAIL as string);
  await page.getByLabel("비밀번호").fill(ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

function futureRange(days: number) {
  const startsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000) };
}

function pastRange(days: number) {
  const startsAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000) };
}

async function createChild(prisma: PrismaClient, resources: Resources, label: string) {
  const child = await prisma.child.create({
    data: { name: `${label}_${resources.marker}`, isActive: true },
  });
  resources.childIds.push(child.id);
  return child;
}

async function createHistoryFixture(
  prisma: PrismaClient,
  resources: Resources,
  input: HistoryFixtureInput,
) {
  const program = await prisma.program.create({
    data: { name: `${input.label}_${resources.marker}`, defaultPrice: 40_000 },
  });
  resources.programIds.push(program.id);

  const classSchedule = await prisma.classSchedule.create({
    data: {
      programId: program.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: `${input.label}_LOCATION_${resources.marker}`,
      status: input.classStatus ?? "SCHEDULED",
      cancelledAt: input.classStatus === "CANCELLED" ? new Date() : null,
    },
  });
  resources.classIds.push(classSchedule.id);

  const attendance = input.attendance ?? null;
  const reservation = await prisma.reservation.create({
    data: {
      childId: input.childId,
      classScheduleId: classSchedule.id,
      status: input.reservationStatus ?? "RESERVED",
      attendance,
      attendanceRecordedAt: attendance ? new Date() : null,
      attendanceRecordedById: attendance ? input.adminId : null,
      cancelledAt: input.reservationStatus === "CANCELLED" ? new Date() : null,
      memo: `${input.label}_${resources.marker}`,
    },
  });
  resources.reservationIds.push(reservation.id);

  if (input.paymentStatus) {
    const payment = await prisma.payment.create({
      data: {
        method: "CARD",
        status: input.paymentStatus,
        totalAmount: 40_000,
        memo: `${input.label}_${resources.marker}`,
      },
    });
    resources.paymentIds.push(payment.id);
    const refundedAmount =
      input.paymentStatus === "PARTIAL_REFUNDED"
        ? 10_000
        : input.paymentStatus === "REFUNDED"
          ? 40_000
          : 0;
    const paymentItem = await prisma.paymentItem.create({
      data: {
        paymentId: payment.id,
        reservationId: reservation.id,
        amount: 40_000,
        paidAmount: 40_000,
        refundedAmount,
      },
    });
    resources.paymentItemIds.push(paymentItem.id);
  }

  return { program, classSchedule, reservation };
}

async function cleanupAndAssert(prisma: PrismaClient, resources: Resources) {
  await prisma.refund.deleteMany({ where: { paymentItemId: { in: resources.paymentItemIds } } });
  await prisma.paymentItem.deleteMany({ where: { id: { in: resources.paymentItemIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: resources.paymentIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: resources.reservationIds } } });
  await prisma.classTeacher.deleteMany({ where: { classScheduleId: { in: resources.classIds } } });
  await prisma.classSchedule.deleteMany({ where: { id: { in: resources.classIds } } });
  await prisma.childSafetyInfo.deleteMany({ where: { childId: { in: resources.childIds } } });
  await prisma.child.deleteMany({ where: { id: { in: resources.childIds } } });
  await prisma.program.deleteMany({ where: { id: { in: resources.programIds } } });

  const markerCounts = await Promise.all([
    prisma.program.count({ where: { name: { contains: resources.marker } } }),
    prisma.classSchedule.count({ where: { location: { contains: resources.marker } } }),
    prisma.child.count({ where: { name: { contains: resources.marker } } }),
    prisma.reservation.count({ where: { memo: { contains: resources.marker } } }),
  ]);
  expect(markerCounts).toEqual([0, 0, 0, 0]);
}

async function expectSummaryValue(page: Page, label: string, value: number) {
  const summary = page.getByRole("region", { name: "통합 이력 요약" });
  const card = summary.getByText(label, { exact: true }).locator("..");
  await expect(card.getByText(`${value}건`, { exact: true })).toBeVisible();
}

test("아이 통합 이력은 네 상태축과 요약·이동을 모바일에서 독립적으로 보여준다", async ({ page }) => {
  const prisma = new PrismaClient();
  const resources = createResources();

  try {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { id: true },
    });
    const child = await createChild(prisma, resources, "HISTORY_CHILD");
    const upcoming = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "UPCOMING_PAID",
      ...futureRange(7),
      paymentStatus: "PAID",
    });
    const endedReserved = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "ENDED_PARTIAL",
      ...pastRange(1),
      paymentStatus: "PARTIAL_REFUNDED",
    });
    const completed = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "COMPLETED_REFUNDED",
      ...pastRange(2),
      reservationStatus: "COMPLETED",
      attendance: "PRESENT",
      paymentStatus: "REFUNDED",
    });
    const noShow = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "NO_SHOW_CANCELLED_PAYMENT",
      ...pastRange(3),
      reservationStatus: "NO_SHOW",
      attendance: "ABSENT",
      paymentStatus: "CANCELLED",
    });
    const reservationCancelled = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "RESERVATION_CANCELLED_PRESENT",
      ...futureRange(8),
      reservationStatus: "CANCELLED",
      attendance: "PRESENT",
    });
    const classCancelled = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "CLASS_CANCELLED_RESERVED",
      ...futureRange(9),
      classStatus: "CANCELLED",
      paymentStatus: "PAID",
    });
    const bothCancelled = await createHistoryFixture(prisma, resources, {
      childId: child.id,
      adminId: admin.id,
      label: "BOTH_CANCELLED_ABSENT",
      ...futureRange(10),
      classStatus: "CANCELLED",
      reservationStatus: "CANCELLED",
      attendance: "ABSENT",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/children/${child.id}`);

    await expectSummaryValue(page, "총 예약", 7);
    await expectSummaryValue(page, "참석", 2);
    await expectSummaryValue(page, "불참", 2);
    await expectSummaryValue(page, "취소", 2);
    await expectSummaryValue(page, "예정", 1);

    const upcomingSection = page.getByRole("region", { name: "예정된 클래스" });
    const pastSection = page.getByRole("region", { name: "지난 이력" });
    await expect(upcomingSection.getByRole("article")).toHaveCount(1);
    await expect(
      upcomingSection.getByRole("article", { name: `${upcoming.program.name} 예약 이력` }),
    ).toContainText("결제완료");
    await expect(pastSection.getByRole("article")).toHaveCount(6);

    const classCancelledCard = pastSection.getByRole("article", {
      name: `${classCancelled.program.name} 예약 이력`,
    });
    const classCancelledReservationState = classCancelledCard
      .getByText("예약", { exact: true })
      .locator("..");
    await expect(classCancelledCard.getByText("수업 취소", { exact: true })).toBeVisible();
    await expect(classCancelledReservationState.getByText("예약됨", { exact: true })).toBeVisible();
    await expect(classCancelledCard.getByText("출결 미처리", { exact: true })).toBeVisible();
    await expect(classCancelledCard.getByText("결제완료", { exact: true })).toBeVisible();
    await expect(
      classCancelledReservationState.getByText("예약 취소", { exact: true }),
    ).toHaveCount(0);

    const reservationCancelledCard = pastSection.getByRole("article", {
      name: `${reservationCancelled.program.name} 예약 이력`,
    });
    await expect(reservationCancelledCard.getByText("수업 예정", { exact: true })).toBeVisible();
    await expect(reservationCancelledCard.getByText("예약 취소", { exact: true })).toBeVisible();
    await expect(reservationCancelledCard.getByText("참석", { exact: true })).toBeVisible();
    await expect(reservationCancelledCard.getByText("미결제", { exact: true })).toBeVisible();

    const bothCancelledCard = pastSection.getByRole("article", {
      name: `${bothCancelled.program.name} 예약 이력`,
    });
    await expect(bothCancelledCard.getByText("수업 취소", { exact: true })).toBeVisible();
    await expect(bothCancelledCard.getByText("예약 취소", { exact: true })).toBeVisible();
    await expect(bothCancelledCard.getByText("불참", { exact: true })).toBeVisible();

    await expect(
      pastSection.getByRole("article", { name: `${endedReserved.program.name} 예약 이력` }),
    ).toContainText("부분환불");
    await expect(
      pastSection.getByRole("article", { name: `${completed.program.name} 예약 이력` }),
    ).toContainText("전액환불");
    await expect(
      pastSection.getByRole("article", { name: `${noShow.program.name} 예약 이력` }),
    ).toContainText("미결제");

    const endedCard = pastSection.getByRole("article", {
      name: `${endedReserved.program.name} 예약 이력`,
    });
    await expect(endedCard.getByRole("link", { name: "클래스 상세" })).toHaveAttribute(
      "href",
      `/classes/${endedReserved.classSchedule.id}`,
    );
    await expect(endedCard.getByRole("link", { name: "예약 상세" })).toHaveAttribute(
      "href",
      `/reservations/${endedReserved.reservation.id}`,
    );
    await endedCard.getByRole("link", { name: "클래스 상세" }).click();
    await expect(page).toHaveURL(`/classes/${endedReserved.classSchedule.id}`);
    await page.goBack();
    await expect(page).toHaveURL(`/children/${child.id}`);
    await pastSection
      .getByRole("article", { name: `${endedReserved.program.name} 예약 이력` })
      .getByRole("link", { name: "예약 상세" })
      .click();
    await expect(page).toHaveURL(`/reservations/${endedReserved.reservation.id}`);

    await page.goto(`/children/${child.id}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "예약 추가" }).click();
    await expect(page).toHaveURL(`/reservations/new?childId=${child.id}`);
    await expect(page.getByLabel("아이", { exact: false })).toHaveValue(child.id);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("지난 이력 더보기는 URL 기준으로 10건씩 누적하며 중복·누락 없이 복원된다", async ({ page }) => {
  const prisma = new PrismaClient();
  const resources = createResources();

  try {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { id: true },
    });
    const child = await createChild(prisma, resources, "PAGINATION_CHILD");
    const reservations = [];
    for (let index = 0; index < 21; index += 1) {
      const fixture = await createHistoryFixture(prisma, resources, {
        childId: child.id,
        adminId: admin.id,
        label: `PAGE_${String(index).padStart(2, "0")}`,
        ...pastRange(index + 1),
      });
      reservations.push(fixture.reservation);
    }

    await login(page);
    await page.goto(`/children/${child.id}`);
    const pastSection = page.getByRole("region", { name: "지난 이력" });
    const reservationLinks = pastSection.getByRole("link", { name: "예약 상세" });

    await expect(reservationLinks).toHaveCount(10);
    await expect.poll(async () => reservationLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      reservations.slice(0, 10).map((reservation) => `/reservations/${reservation.id}`),
    );

    await pastSection.getByRole("link", { name: "지난 이력 더보기" }).click();
    await expect(page).toHaveURL((url) => {
      return url.pathname === `/children/${child.id}` && url.searchParams.get("historyPage") === "2";
    });
    await expect(reservationLinks).toHaveCount(20);
    await expect.poll(async () => reservationLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      reservations.slice(0, 20).map((reservation) => `/reservations/${reservation.id}`),
    );

    await pastSection.getByRole("link", { name: "지난 이력 더보기" }).click();
    await expect(page).toHaveURL((url) => {
      return url.pathname === `/children/${child.id}` && url.searchParams.get("historyPage") === "3";
    });
    await expect(reservationLinks).toHaveCount(21);
    await expect.poll(async () => reservationLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(
      reservations.map((reservation) => `/reservations/${reservation.id}`),
    );
    await expect(pastSection.getByRole("link", { name: "지난 이력 더보기" })).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL((url) => url.searchParams.get("historyPage") === "2");
    await expect(reservationLinks).toHaveCount(20);
    await page.reload();
    await expect(reservationLinks).toHaveCount(20);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("미인증 사용자는 아이 통합 이력 URL에 직접 접근할 수 없다", async ({ page }) => {
  await page.goto(`/children/${randomUUID()}`);
  await expect(page).toHaveURL(/\/login/);
});
