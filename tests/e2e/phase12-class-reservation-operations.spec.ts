import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { DuplicateReservationError } from "@/lib/reservations/errors";
import { getClassDatePresets } from "@/server/classes/filter-presets";

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

function createResources(): Resources {
  return {
    marker: `E2E_P12_${randomUUID()}`,
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

async function createChild(prisma: PrismaClient, resources: Resources, label: string) {
  const child = await prisma.child.create({
    data: { name: `${label}_${resources.marker}`, isActive: true },
  });
  resources.childIds.push(child.id);
  return child;
}

async function createClass(
  prisma: PrismaClient,
  resources: Resources,
  input: { label: string; startsAt: Date; endsAt: Date; capacity: number },
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
      capacity: input.capacity,
      status: "SCHEDULED",
    },
  });
  resources.classIds.push(classSchedule.id);
  return { program, classSchedule };
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

function futureRange(days: number) {
  const startsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return { startsAt, endsAt };
}

async function expectClassFilterRange(
  page: Page,
  range: { dateFrom: string; dateTo: string },
  activePreset?: "오늘" | "이번 주" | "이번 달",
) {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/classes" &&
      url.searchParams.get("dateFrom") === range.dateFrom &&
      url.searchParams.get("dateTo") === range.dateTo &&
      url.searchParams.get("status") === "all"
    );
  });
  await expect(page.getByLabel("시작일")).toHaveValue(range.dateFrom);
  await expect(page.getByLabel("종료일")).toHaveValue(range.dateTo);
  await expect(page.getByLabel("상태")).toHaveValue("all");

  for (const label of ["오늘", "이번 주", "이번 달"] as const) {
    const preset = page.getByRole("link", { name: label, exact: true });
    if (label === activePreset) {
      await expect(preset).toHaveAttribute("aria-current", "page");
    } else {
      await expect(preset).not.toHaveAttribute("aria-current", "page");
    }
  }
}

test("클래스 목록 좌석 상태·KST 프리셋·양방향 예약 진입이 모바일에서도 동작한다", async ({ page }) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();

  try {
    const childA = await createChild(prisma, resources, "AVAILABLE_CHILD");
    const childB = await createChild(prisma, resources, "FULL_CHILD");
    const childC = await createChild(prisma, resources, "OVER_CHILD");
    const available = await createClass(prisma, resources, {
      label: "AVAILABLE_PROGRAM",
      ...futureRange(3),
      capacity: 8,
    });
    const full = await createClass(prisma, resources, {
      label: "FULL_PROGRAM",
      ...futureRange(4),
      capacity: 1,
    });
    const over = await createClass(prisma, resources, {
      label: "OVER_PROGRAM",
      ...futureRange(5),
      capacity: 1,
    });
    const pastStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const ended = await createClass(prisma, resources, {
      label: "ENDED_PROGRAM",
      startsAt: pastStart,
      endsAt: new Date(pastStart.getTime() + 60 * 60 * 1000),
      capacity: 99,
    });

    for (const data of [
      { classScheduleId: full.classSchedule.id, childId: childA.id, memo: `FULL_${resources.marker}` },
      { classScheduleId: over.classSchedule.id, childId: childB.id, memo: `OVER_A_${resources.marker}` },
      { classScheduleId: over.classSchedule.id, childId: childC.id, memo: `OVER_B_${resources.marker}` },
    ]) {
      const reservation = await prisma.reservation.create({ data });
      resources.reservationIds.push(reservation.id);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/classes?status=all");

    const availableRow = page.getByRole("row").filter({ hasText: available.program.name });
    const fullRow = page.getByRole("row").filter({ hasText: full.program.name });
    const overRow = page.getByRole("row").filter({ hasText: over.program.name });
    const endedRow = page.getByRole("row").filter({ hasText: ended.program.name });
    await expect(availableRow).toContainText("잔여 8석");
    await expect(fullRow).toContainText("만석");
    await expect(overRow).toContainText("정원 초과 1명");
    await expect(endedRow).toContainText("종료");
    await expect(page.getByRole("columnheader")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const presets = getClassDatePresets(new Date());
    const todayLink = page.getByRole("link", { name: "오늘", exact: true });
    await expect(todayLink).toHaveAttribute(
      "href",
      `/classes?dateFrom=${presets.today.dateFrom}&dateTo=${presets.today.dateTo}&status=all`,
    );
    await page.getByLabel("시작일").fill("2026-07-01");
    await page.getByLabel("종료일").fill("2026-07-31");
    await todayLink.click();
    await expectClassFilterRange(page, presets.today, "오늘");
    await page.getByRole("button", { name: "검색" }).click();
    await expectClassFilterRange(page, presets.today, "오늘");

    await page.getByLabel("시작일").fill("2026-07-02");
    await page.getByLabel("종료일").fill("2026-07-30");
    await page.getByRole("link", { name: "이번 주", exact: true }).click();
    await expectClassFilterRange(page, presets.week, "이번 주");
    await page.getByRole("button", { name: "검색" }).click();
    await expectClassFilterRange(page, presets.week, "이번 주");

    await page.getByLabel("시작일").fill("2026-06-01");
    await page.getByLabel("종료일").fill("2026-06-30");
    await page.getByRole("link", { name: "이번 달", exact: true }).click();
    await expectClassFilterRange(page, presets.month, "이번 달");
    await page.getByRole("button", { name: "검색" }).click();
    await expectClassFilterRange(page, presets.month, "이번 달");

    await page.getByRole("link", { name: "오늘", exact: true }).click();
    await expectClassFilterRange(page, presets.today, "오늘");
    await page.getByRole("link", { name: "이번 달", exact: true }).click();
    await expectClassFilterRange(page, presets.month, "이번 달");

    const customRange = { dateFrom: "2026-06-03", dateTo: "2026-06-05" };
    await page.getByLabel("시작일").fill(customRange.dateFrom);
    await page.getByLabel("종료일").fill(customRange.dateTo);
    await page.getByRole("button", { name: "검색" }).click();
    await expectClassFilterRange(page, customRange);

    await page.goto(`/classes/${available.classSchedule.id}`);
    await page.getByRole("link", { name: "예약 추가" }).click();
    await expect(page).toHaveURL(`/reservations/new?classScheduleId=${available.classSchedule.id}`);
    await expect(page.getByLabel("클래스", { exact: false })).toHaveValue(available.classSchedule.id);

    await page.goto(`/children/${childA.id}`);
    await page.getByRole("link", { name: "예약 추가" }).click();
    await expect(page).toHaveURL(`/reservations/new?childId=${childA.id}`);
    await expect(page.getByLabel("아이", { exact: false })).toHaveValue(childA.id);

    await page.goto("/classes/new");
    const capacityInput = page.getByLabel("정원");
    await expect(capacityInput).toHaveValue("8");
    await expect(capacityInput).toHaveAttribute("min", "1");
    await expect(capacityInput).toHaveAttribute("max", "99");
    await expect(capacityInput).toHaveAttribute("step", "1");
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("만석 후보는 명시 확인 후 초과 예약되고 참가자 이력은 상태별로 분리된다", async ({ page }) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();

  try {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      select: { id: true },
    });
    const paidChild = await createChild(prisma, resources, "PAID_CHILD");
    const targetChild = await createChild(prisma, resources, "TARGET_CHILD");
    const cancelledPresentChild = await createChild(prisma, resources, "CANCELLED_PRESENT_CHILD");
    const cancelledAbsentChild = await createChild(prisma, resources, "CANCELLED_ABSENT_CHILD");
    const fixture = await createClass(prisma, resources, {
      label: "OVERBOOKING_PROGRAM",
      ...futureRange(3),
      capacity: 1,
    });

    const paidReservation = await prisma.reservation.create({
      data: {
        classScheduleId: fixture.classSchedule.id,
        childId: paidChild.id,
        memo: `PAID_${resources.marker}`,
      },
    });
    resources.reservationIds.push(paidReservation.id);
    const cancelledPresent = await prisma.reservation.create({
      data: {
        classScheduleId: fixture.classSchedule.id,
        childId: cancelledPresentChild.id,
        status: "CANCELLED",
        attendance: "PRESENT",
        attendanceRecordedAt: new Date(),
        attendanceRecordedById: admin.id,
        memo: `CANCELLED_PRESENT_${resources.marker}`,
      },
    });
    const cancelledAbsent = await prisma.reservation.create({
      data: {
        classScheduleId: fixture.classSchedule.id,
        childId: cancelledAbsentChild.id,
        status: "CANCELLED",
        attendance: "ABSENT",
        attendanceRecordedAt: new Date(),
        attendanceRecordedById: admin.id,
        memo: `CANCELLED_ABSENT_${resources.marker}`,
      },
    });
    resources.reservationIds.push(cancelledPresent.id, cancelledAbsent.id);

    const payment = await prisma.payment.create({
      data: { method: "CARD", status: "PAID", totalAmount: 40_000 },
    });
    resources.paymentIds.push(payment.id);
    const paymentItem = await prisma.paymentItem.create({
      data: {
        paymentId: payment.id,
        reservationId: paidReservation.id,
        amount: 40_000,
        paidAmount: 40_000,
      },
    });
    resources.paymentItemIds.push(paymentItem.id);

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/classes/${fixture.classSchedule.id}`);

    await expect(page.getByRole("heading", { name: /일반 참가자/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /취소 예약/ })).toBeVisible();
    const paidCard = page.getByRole("listitem").filter({ hasText: paidChild.name });
    await expect(paidCard).toContainText("예약됨");
    await expect(paidCard).toContainText("출결 미처리");
    await expect(paidCard).toContainText("결제완료");
    const presentCard = page.getByRole("listitem").filter({ hasText: cancelledPresentChild.name });
    const absentCard = page.getByRole("listitem").filter({ hasText: cancelledAbsentChild.name });
    await expect(presentCard).toContainText("취소");
    await expect(presentCard).toContainText("참석");
    await expect(presentCard).toContainText("미결제");
    await expect(absentCard).toContainText("취소");
    await expect(absentCard).toContainText("불참");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("link", { name: "예약 추가" }).click();
    await expect(page.getByLabel("클래스", { exact: false })).toHaveValue(fixture.classSchedule.id);
    await page.getByLabel("아이", { exact: false }).selectOption(targetChild.id);
    await page.getByLabel("메모").fill(`OVERBOOKED_${resources.marker}`);
    await page.getByRole("button", { name: "예약 등록", exact: true }).click();

    await expect(page.getByText(/현재 예약 1명 \/ 정원 1명입니다/)).toBeVisible();
    await expect(page.getByText(/추가하면 정원 초과 1명이 됩니다/)).toBeVisible();
    await expect(page.getByRole("button", { name: "초과 예약 확인 후 등록" })).toBeVisible();
    expect(
      await prisma.reservation.count({
        where: { classScheduleId: fixture.classSchedule.id, childId: targetChild.id },
      }),
    ).toBe(0);

    await page.getByRole("button", { name: "초과 예약 확인 후 등록" }).click();
    await page.waitForURL((url) => /^\/reservations\/(?!new$)[^/]+$/.test(url.pathname));
    const createdId = new URL(page.url()).pathname.split("/").pop();
    if (!createdId) throw new Error("초과 예약 id를 확인할 수 없습니다.");
    resources.reservationIds.push(createdId);
    expect(
      await prisma.reservation.count({
        where: { classScheduleId: fixture.classSchedule.id, status: "RESERVED" },
      }),
    ).toBe(2);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("실제 로컬 DB 행 잠금은 동시 요청 한 건만 정상 생성하고 나머지는 확인 흐름으로 보낸다", async () => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();

  try {
    const childA = await createChild(prisma, resources, "CONCURRENT_A");
    const childB = await createChild(prisma, resources, "CONCURRENT_B");
    const fixture = await createClass(prisma, resources, {
      label: "CONCURRENT_PROGRAM",
      ...futureRange(3),
      capacity: 1,
    });
    const { createReservationCore } = await import("@/server/reservations/create");

    const inputs = [childA.id, childB.id].map((childId) => ({
      classScheduleId: fixture.classSchedule.id,
      childId,
      memo: `CONCURRENT_${resources.marker}`,
    }));
    const results = await Promise.allSettled(inputs.map((input) => createReservationCore(prisma, input)));
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      name: "OverbookingConfirmationRequiredError",
      capacity: 1,
      reservedCount: 1,
      overByAfterCreate: 1,
    });

    const rejectedIndex = results.findIndex((result) => result.status === "rejected");
    const rejectedInput = inputs[rejectedIndex];
    const confirmed = await createReservationCore(prisma, {
      ...rejectedInput,
      confirmOverbooking: "true",
      confirmedClassScheduleId: rejectedInput.classScheduleId,
      confirmedChildId: rejectedInput.childId,
    });
    resources.reservationIds.push(confirmed.id);

    const reservations = await prisma.reservation.findMany({
      where: { classScheduleId: fixture.classSchedule.id, status: "RESERVED" },
      select: { id: true },
    });
    resources.reservationIds.push(...reservations.map((reservation) => reservation.id));
    expect(reservations).toHaveLength(2);

    await expect(
      createReservationCore(prisma, {
        ...rejectedInput,
        confirmOverbooking: "true",
        confirmedClassScheduleId: rejectedInput.classScheduleId,
        confirmedChildId: rejectedInput.childId,
      }),
    ).rejects.toBeInstanceOf(DuplicateReservationError);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});
