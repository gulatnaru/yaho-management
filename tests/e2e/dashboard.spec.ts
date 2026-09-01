import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { formatKstDate } from "@/lib/classes/datetime";
import { getKstDayPeriod } from "@/server/dashboard/period";

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

const suffix = `${Date.now()}`;
const selectedDate = "2026-08-10";
const selectedMonth = selectedDate.slice(0, 7);
const today = formatKstDate(new Date());
const todayMonth = today.slice(0, 7);
const todayStartsAt = new Date(`${today}T10:00:00+09:00`);
const todayEndsAt = new Date(`${today}T12:00:00+09:00`);
const ids = {
  children: [] as string[],
  reservations: [] as string[],
  classes: [] as string[],
  classTeachers: [] as string[],
  payments: [] as string[],
  paymentItems: [] as string[],
  refunds: [] as string[],
};
let programId: string;
let teacherId: string;
let selectedClassId: string;
let cancelledClassId: string;
let todayClassId: string;
let childNames: Record<string, string>;

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", ADMIN_EMAIL as string);
  await page.fill("#password", ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function readTodayExpectedMetrics() {
  const range = getKstDayPeriod(today);
  const [classes, cancellationCount, payment, refund] = await Promise.all([
    prisma.classSchedule.findMany({
      where: { startsAt: { gte: range.startUtc, lt: range.endExclusiveUtc }, status: { not: "CANCELLED" } },
      select: {
        reservations: {
          where: {
            OR: [
              { status: { in: ["RESERVED", "COMPLETED", "NO_SHOW"] } },
              { status: "CANCELLED", attendance: { not: null } },
            ],
          },
          select: { id: true },
        },
      },
    }),
    prisma.reservation.count({ where: { cancelledAt: { gte: range.startUtc, lt: range.endExclusiveUtc } } }),
    prisma.paymentItem.aggregate({
      _sum: { paidAmount: true },
      where: {
        payment: {
          paidAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
          status: { in: ["PAID", "PARTIAL_REFUNDED", "REFUNDED"] },
        },
      },
    }),
    prisma.refund.aggregate({
      _sum: { amount: true },
      where: {
        refundedAt: { gte: range.startUtc, lt: range.endExclusiveUtc },
        status: "COMPLETED",
      },
    }),
  ]);
  const paidAmount = payment._sum.paidAmount ?? 0;
  const refundedAmount = refund._sum.amount ?? 0;
  return {
    classCount: classes.length,
    operationReservationCount: classes.reduce((sum, item) => sum + item.reservations.length, 0),
    cancellationCount,
    paidAmount,
    refundedAmount,
    netRevenue: paidAmount - refundedAmount,
  };
}

function krw(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

test.beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const [program, teacher] = await Promise.all([
    prisma.program.create({ data: { name: `E2E_TEST_DASHBOARD_PROGRAM_${suffix}`, defaultPrice: 50_000 } }),
    prisma.teacher.create({ data: { name: `E2E_TEST_DASHBOARD_TEACHER_${suffix}` } }),
  ]);
  programId = program.id;
  teacherId = teacher.id;

  const classes = await Promise.all([
    prisma.classSchedule.create({
      data: {
        programId,
        startsAt: new Date(`${selectedDate}T09:00:00+09:00`),
        endsAt: new Date(`${selectedDate}T11:00:00+09:00`),
        location: `E2E_TEST_DASHBOARD_SELECTED_${suffix}`,
        capacity: 8,
      },
    }),
    prisma.classSchedule.create({
      data: {
        programId,
        startsAt: new Date(`${selectedDate}T13:00:00+09:00`),
        endsAt: new Date(`${selectedDate}T15:00:00+09:00`),
        location: `E2E_TEST_DASHBOARD_COMPLETED_${suffix}`,
        capacity: 8,
        status: "COMPLETED",
      },
    }),
    prisma.classSchedule.create({
      data: {
        programId,
        startsAt: new Date(`${selectedDate}T16:00:00+09:00`),
        endsAt: new Date(`${selectedDate}T18:00:00+09:00`),
        location: `E2E_TEST_DASHBOARD_CANCELLED_${suffix}`,
        capacity: 8,
        status: "CANCELLED",
        cancelledAt: new Date(`${selectedDate}T08:00:00+09:00`),
        cancelReason: "OPERATION",
        cancelledById: admin.id,
      },
    }),
    prisma.classSchedule.create({
      data: {
        programId,
        startsAt: todayStartsAt,
        endsAt: todayEndsAt,
        location: `E2E_TEST_DASHBOARD_TODAY_${suffix}`,
        capacity: 8,
      },
    }),
  ]);
  ids.classes.push(...classes.map((item) => item.id));
  [selectedClassId, , cancelledClassId, todayClassId] = classes.map((item) => item.id);

  const assignments = await Promise.all([
    prisma.classTeacher.create({ data: { classScheduleId: selectedClassId, teacherId } }),
    prisma.classTeacher.create({ data: { classScheduleId: todayClassId, teacherId } }),
  ]);
  ids.classTeachers.push(...assignments.map((item) => item.id));

  childNames = {
    reserved: `예약_${suffix}`,
    completed: `참여_${suffix}`,
    noShow: `노쇼_${suffix}`,
    preCancelled: `사전취소_${suffix}`,
    cancelledPresent: `참여후취소_${suffix}`,
    cancelledAbsent: `노쇼후취소_${suffix}`,
  };
  const children = await Promise.all(
    Object.values(childNames).map((name) => prisma.child.create({ data: { name } })),
  );
  ids.children.push(...children.map((item) => item.id));
  const [reservedChild, completedChild, noShowChild, preCancelledChild, presentChild, absentChild] = children;

  const selectedReservations = await Promise.all([
    prisma.reservation.create({ data: { childId: reservedChild.id, classScheduleId: selectedClassId } }),
    prisma.reservation.create({
      data: {
        childId: completedChild.id,
        classScheduleId: selectedClassId,
        status: "COMPLETED",
        attendance: "PRESENT",
        attendanceRecordedAt: new Date(`${selectedDate}T12:00:00+09:00`),
        attendanceRecordedById: admin.id,
      },
    }),
    prisma.reservation.create({
      data: {
        childId: noShowChild.id,
        classScheduleId: selectedClassId,
        status: "NO_SHOW",
        attendance: "ABSENT",
        attendanceRecordedAt: new Date(`${selectedDate}T12:00:00+09:00`),
        attendanceRecordedById: admin.id,
      },
    }),
    prisma.reservation.create({
      data: {
        childId: preCancelledChild.id,
        classScheduleId: selectedClassId,
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: "PERSONAL",
        cancelledById: admin.id,
      },
    }),
    prisma.reservation.create({
      data: {
        childId: presentChild.id,
        classScheduleId: selectedClassId,
        status: "CANCELLED",
        attendance: "PRESENT",
        attendanceRecordedAt: new Date(`${selectedDate}T12:00:00+09:00`),
        attendanceRecordedById: admin.id,
        cancelledAt: new Date(`${selectedDate}T13:00:00+09:00`),
        cancelReason: "OPERATION",
        cancelledById: admin.id,
      },
    }),
    prisma.reservation.create({
      data: {
        childId: absentChild.id,
        classScheduleId: selectedClassId,
        status: "CANCELLED",
        attendance: "ABSENT",
        attendanceRecordedAt: new Date(`${selectedDate}T12:00:00+09:00`),
        attendanceRecordedById: admin.id,
        cancelledAt: new Date(`${selectedDate}T13:00:00+09:00`),
        cancelReason: "OPERATION",
        cancelledById: admin.id,
      },
    }),
    prisma.reservation.create({ data: { childId: reservedChild.id, classScheduleId: cancelledClassId } }),
  ]);
  ids.reservations.push(...selectedReservations.map((item) => item.id));

  const todayReservations = await Promise.all([
    prisma.reservation.create({ data: { childId: reservedChild.id, classScheduleId: todayClassId } }),
    prisma.reservation.create({
      data: {
        childId: completedChild.id,
        classScheduleId: todayClassId,
        status: "COMPLETED",
        attendance: "PRESENT",
        attendanceRecordedAt: new Date(),
        attendanceRecordedById: admin.id,
      },
    }),
    prisma.reservation.create({
      data: {
        childId: absentChild.id,
        classScheduleId: todayClassId,
        status: "CANCELLED",
        attendance: "ABSENT",
        attendanceRecordedAt: new Date(),
        attendanceRecordedById: admin.id,
        cancelledAt: new Date(`${selectedDate}T13:00:00+09:00`),
        cancelReason: "OPERATION",
        cancelledById: admin.id,
      },
    }),
  ]);
  ids.reservations.push(...todayReservations.map((item) => item.id));

  const pastPayment = await prisma.payment.create({
    data: {
      method: "CARD",
      status: "PARTIAL_REFUNDED",
      paidAt: new Date("2020-01-01T00:00:00.000Z"),
      totalAmount: 90_000,
      items: {
        create: {
          reservationId: selectedReservations[0].id,
          amount: 100_000,
          discountAmount: 10_000,
          paidAmount: 90_000,
          refundedAmount: 30_000,
        },
      },
    },
    include: { items: true },
  });
  const todayPayment = await prisma.payment.create({
    data: {
      method: "CASH",
      status: "PAID",
      paidAt: new Date(),
      totalAmount: 10_000,
      items: {
        create: {
          reservationId: todayReservations[0].id,
          amount: 10_000,
          discountAmount: 0,
          paidAmount: 10_000,
        },
      },
    },
    include: { items: true },
  });
  ids.payments.push(pastPayment.id, todayPayment.id);
  ids.paymentItems.push(pastPayment.items[0].id, todayPayment.items[0].id);

  const refunds = await Promise.all([
    prisma.refund.create({
      data: {
        paymentItemId: pastPayment.items[0].id,
        amount: 30_000,
        reason: "OPERATION",
        status: "COMPLETED",
        refundedAt: new Date(),
        processedById: admin.id,
      },
    }),
    prisma.refund.create({
      data: {
        paymentItemId: pastPayment.items[0].id,
        amount: 5_000,
        reason: "OPERATION",
        status: "REQUESTED",
        refundedAt: new Date(),
        processedById: admin.id,
      },
    }),
    prisma.refund.create({
      data: {
        paymentItemId: pastPayment.items[0].id,
        amount: 7_000,
        reason: "OPERATION",
        status: "CANCELLED",
        refundedAt: new Date(),
        processedById: admin.id,
      },
    }),
  ]);
  ids.refunds.push(...refunds.map((item) => item.id));
});

test.afterAll(async () => {
  await prisma.refund.deleteMany({ where: { id: { in: ids.refunds } } });
  await prisma.paymentItem.deleteMany({ where: { id: { in: ids.paymentItems } } });
  await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await prisma.reservation.deleteMany({ where: { id: { in: ids.reservations } } });
  await prisma.classTeacher.deleteMany({ where: { id: { in: ids.classTeachers } } });
  await prisma.classSchedule.deleteMany({ where: { id: { in: ids.classes } } });
  await prisma.child.deleteMany({ where: { id: { in: ids.children } } });
  await prisma.teacher.deleteMany({ where: { id: teacherId } });
  await prisma.program.deleteMany({ where: { id: programId } });

  const leftovers = await Promise.all([
    prisma.program.count({ where: { name: `E2E_TEST_DASHBOARD_PROGRAM_${suffix}` } }),
    prisma.teacher.count({ where: { name: `E2E_TEST_DASHBOARD_TEACHER_${suffix}` } }),
    prisma.child.count({ where: { name: { endsWith: suffix } } }),
    prisma.classSchedule.count({ where: { location: { endsWith: suffix } } }),
  ]);
  expect(leftovers).toEqual([0, 0, 0, 0]);
  await prisma.$disconnect();
});

test.describe.serial("Phase 10 관리자 홈", () => {
  test("미인증 dashboard 접근을 차단한다", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("월 집계와 선택 날짜 명단의 상태 포함 규칙을 적용하고 상세 링크를 제공한다", async ({ page }) => {
    await login(page);
    await page.goto(`/dashboard?month=${selectedMonth}&date=${selectedDate}`);

    await expect(page).toHaveURL(new RegExp(`month=${selectedMonth}.*date=${selectedDate}`));
    await expect(page.getByRole("heading", { name: `${selectedDate} 예약자 명단` })).toBeVisible();
    const dateCell = page.locator(`[data-date="${selectedDate}"]`);
    await expect(dateCell).toHaveAttribute("aria-label", `${selectedDate}, 클래스 2개, 운영 예약 5명`);
    await expect(page.getByTestId(`dashboard-class-${cancelledClassId}`)).toHaveCount(0);
    await expect(page.getByText(childNames.reserved)).toBeVisible();
    await expect(page.getByText(childNames.completed)).toBeVisible();
    await expect(page.getByText(childNames.noShow)).toBeVisible();
    await expect(page.getByText(childNames.preCancelled)).toHaveCount(0);
    await expect(page.getByText(childNames.cancelledPresent)).toBeVisible();
    await expect(page.getByText(childNames.cancelledAbsent)).toBeVisible();
    await expect(page.getByText("참여완료 후 취소")).toBeVisible();
    await expect(page.getByText("노쇼 후 취소")).toBeVisible();
    await expect(page.getByRole("link", { name: childNames.reserved })).toHaveAttribute(
      "href",
      `/children/${ids.children[0]}`,
    );
    await expect(page.getByTestId(`dashboard-class-${selectedClassId}`).getByRole("link").first()).toHaveAttribute(
      "href",
      `/classes/${selectedClassId}`,
    );
  });

  test("월 이동에서 date를 제거하고 뒤로가기·새로고침으로 URL 상태를 복원한다", async ({ page }) => {
    await login(page);
    const selectedUrl = `/dashboard?month=${selectedMonth}&date=${selectedDate}`;
    await page.goto(selectedUrl);
    await page.getByRole("link", { name: "다음 달" }).click();
    await expect(page).toHaveURL(/month=2026-09$/);
    await expect(page.getByText("날짜를 선택하면 클래스별 예약자 명단이 표시됩니다.")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`month=${selectedMonth}.*date=${selectedDate}`));
    await page.reload();
    await expect(page.getByRole("heading", { name: `${selectedDate} 예약자 명단` })).toBeVisible();
  });

  test("오늘 운영·취소·ADR-040 순매출을 서로 독립된 시간축으로 표시한다", async ({ page }) => {
    const expected = await readTodayExpectedMetrics();
    await login(page);
    await page.goto(`/dashboard?month=${todayMonth}&date=${today}`);

    await expect(page.getByTestId("summary-class-count")).toContainText(`${expected.classCount}개`);
    await expect(page.getByTestId("summary-operation-reservations")).toContainText(
      `${expected.operationReservationCount}명`,
    );
    await expect(page.getByTestId("summary-cancellations")).toContainText(`${expected.cancellationCount}건`);
    await expect(page.getByTestId("summary-paid-amount")).toContainText(krw(expected.paidAmount));
    await expect(page.getByTestId("summary-refunded-amount")).toContainText(krw(expected.refundedAmount));
    await expect(page.getByTestId("summary-net-revenue")).toContainText(krw(expected.netRevenue));
    await expect(page.getByTestId(`dashboard-class-${todayClassId}`).first()).toContainText(
      "운영 3명 · 예약 1/8명 · 남은 자리 7명",
    );
  });

  test("390px에서도 월간 7열을 유지하고 범위 밖 UI를 노출하지 않는다", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboard?month=${selectedMonth}&date=${selectedDate}`);

    const calendar = page.getByTestId("monthly-calendar");
    await expect(calendar).toBeVisible();
    const calendarGrid = calendar.locator(":scope > div").last();
    type CalendarLayout = {
      cells: Array<{ x: number; y: number; width: number; height: number }>;
      gridClientWidth: number;
      gridScrollWidth: number;
      calendarClientWidth: number;
      calendarScrollWidth: number;
      calendarLeft: number;
      calendarRight: number;
      viewportWidth: number;
    };
    let layout: CalendarLayout | undefined;
    await expect.poll(async () => {
      const measured = await calendarGrid.evaluate((grid) => {
        const calendar = grid.parentElement;
        if (!calendar) throw new Error("캘린더 컨테이너를 찾을 수 없습니다.");
        const calendarBox = calendar.getBoundingClientRect();
        return {
          cells: Array.from(grid.children).map((cell) => {
            const box = cell.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          }),
          gridClientWidth: grid.clientWidth,
          gridScrollWidth: grid.scrollWidth,
          calendarClientWidth: calendar.clientWidth,
          calendarScrollWidth: calendar.scrollWidth,
          calendarLeft: calendarBox.left,
          calendarRight: calendarBox.right,
          viewportWidth: window.innerWidth,
        };
      });
      const firstEightCells = measured.cells.slice(0, 8);
      const firstRow = firstEightCells.slice(0, 7);
      const firstEightCellsHaveLayout =
        measured.cells.length >= 8 && firstEightCells.every((cell) => cell.width > 0 && cell.height > 0);
      const firstRowHasSameY =
        firstRow.length === 7 && firstRow.every((cell) => Math.abs(cell.y - firstRow[0].y) < 0.1);
      const firstRowXIncreases = firstRow.every(
        (cell, index) => index === 0 || cell.x > firstRow[index - 1].x,
      );
      const nextRowStartsBelow = firstEightCells[7]?.y > firstRow[0]?.y;
      const hasNoHorizontalOverflow =
        measured.gridScrollWidth <= measured.gridClientWidth &&
        measured.calendarScrollWidth <= measured.calendarClientWidth;
      const calendarIsWithinViewport =
        measured.calendarLeft >= 0 && measured.calendarRight <= measured.viewportWidth;
      const layoutIsStable =
        firstEightCellsHaveLayout &&
        firstRowHasSameY &&
        firstRowXIncreases &&
        nextRowStartsBelow &&
        hasNoHorizontalOverflow &&
        calendarIsWithinViewport;
      if (layoutIsStable) layout = measured;
      return layoutIsStable;
    }).toBe(true);
    if (!layout) throw new Error("캘린더 날짜 셀 레이아웃이 안정화되지 않았습니다.");
    expect(layout.cells.length).toBeGreaterThanOrEqual(8);
    const firstRow = layout.cells.slice(0, 7);
    for (const cell of firstRow) expect(cell.y).toBeCloseTo(firstRow[0].y, 1);
    for (let index = 1; index < firstRow.length; index += 1) {
      expect(firstRow[index].x).toBeGreaterThan(firstRow[index - 1].x);
    }
    expect(layout.cells[7].y).toBeGreaterThan(firstRow[0].y);
    expect(layout.gridScrollWidth).toBeLessThanOrEqual(layout.gridClientWidth);
    expect(layout.calendarScrollWidth).toBeLessThanOrEqual(layout.calendarClientWidth);
    expect(layout.calendarLeft).toBeGreaterThanOrEqual(0);
    expect(layout.calendarRight).toBeLessThanOrEqual(layout.viewportWidth);
    await expect(page.getByText("예약 추가")).toHaveCount(0);
    await expect(page.getByText(/환불 처리 필요/)).toHaveCount(0);
    await expect(page.getByText(/인기 프로그램|재참여율/)).toHaveCount(0);
  });
});
