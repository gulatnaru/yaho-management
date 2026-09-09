import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

type TestResources = {
  marker: string;
  programIds: Set<string>;
  teacherIds: Set<string>;
  classIds: Set<string>;
  classTeacherIds: Set<string>;
  childIds: Set<string>;
  safetyInfoIds: Set<string>;
  reservationIds: Set<string>;
};

function createResources(): TestResources {
  return {
    marker: `E2E_P11_${randomUUID()}`,
    programIds: new Set(),
    teacherIds: new Set(),
    classIds: new Set(),
    classTeacherIds: new Set(),
    childIds: new Set(),
    safetyInfoIds: new Set(),
    reservationIds: new Set(),
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(ADMIN_EMAIL as string);
  await page.getByLabel("비밀번호").fill(ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function discoverCreatedIds(prisma: PrismaClient, resources: TestResources) {
  const marker = resources.marker;
  const [programs, teachers, classes, children, safetyInfos, reservations] = await Promise.all([
    prisma.program.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
    prisma.teacher.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
    prisma.classSchedule.findMany({ where: { location: { contains: marker } }, select: { id: true } }),
    prisma.child.findMany({ where: { name: { contains: marker } }, select: { id: true } }),
    prisma.childSafetyInfo.findMany({
      where: {
        OR: [
          { allergies: { contains: marker } },
          { emergencyNotes: { contains: marker } },
          { emergencyContactName: { contains: marker } },
        ],
      },
      select: { id: true },
    }),
    prisma.reservation.findMany({ where: { memo: { contains: marker } }, select: { id: true } }),
  ]);
  for (const item of programs) resources.programIds.add(item.id);
  for (const item of teachers) resources.teacherIds.add(item.id);
  for (const item of classes) resources.classIds.add(item.id);
  for (const item of children) resources.childIds.add(item.id);
  for (const item of safetyInfos) resources.safetyInfoIds.add(item.id);
  for (const item of reservations) resources.reservationIds.add(item.id);

  const classIds = [...resources.classIds];
  const childIds = [...resources.childIds];
  const [classTeachers, linkedReservations] = await Promise.all([
    prisma.classTeacher.findMany({
      where: { classScheduleId: { in: classIds } },
      select: { id: true },
    }),
    prisma.reservation.findMany({
      where: {
        OR: [{ classScheduleId: { in: classIds } }, { childId: { in: childIds } }],
      },
      select: { id: true },
    }),
  ]);
  for (const item of classTeachers) resources.classTeacherIds.add(item.id);
  for (const item of linkedReservations) resources.reservationIds.add(item.id);
}

async function cleanupAndAssert(prisma: PrismaClient, resources: TestResources) {
  await discoverCreatedIds(prisma, resources);
  const reservationIds = [...resources.reservationIds];
  const safetyInfoIds = [...resources.safetyInfoIds];
  const classTeacherIds = [...resources.classTeacherIds];
  const classIds = [...resources.classIds];
  const childIds = [...resources.childIds];
  const teacherIds = [...resources.teacherIds];
  const programIds = [...resources.programIds];

  await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
  await prisma.childSafetyInfo.deleteMany({ where: { id: { in: safetyInfoIds } } });
  await prisma.classTeacher.deleteMany({ where: { id: { in: classTeacherIds } } });
  await prisma.classSchedule.deleteMany({ where: { id: { in: classIds } } });
  await prisma.child.deleteMany({ where: { id: { in: childIds } } });
  await prisma.teacher.deleteMany({ where: { id: { in: teacherIds } } });
  await prisma.program.deleteMany({ where: { id: { in: programIds } } });

  const marker = resources.marker;
  const [idCounts, markerCounts] = await Promise.all([
    Promise.all([
      prisma.reservation.count({ where: { id: { in: reservationIds } } }),
      prisma.childSafetyInfo.count({ where: { id: { in: safetyInfoIds } } }),
      prisma.classTeacher.count({ where: { id: { in: classTeacherIds } } }),
      prisma.classSchedule.count({ where: { id: { in: classIds } } }),
      prisma.child.count({ where: { id: { in: childIds } } }),
      prisma.teacher.count({ where: { id: { in: teacherIds } } }),
      prisma.program.count({ where: { id: { in: programIds } } }),
    ]),
    Promise.all([
      prisma.reservation.count({ where: { memo: { contains: marker } } }),
      prisma.childSafetyInfo.count({
        where: {
          OR: [
            { allergies: { contains: marker } },
            { emergencyNotes: { contains: marker } },
            { emergencyContactName: { contains: marker } },
          ],
        },
      }),
      prisma.classSchedule.count({ where: { location: { contains: marker } } }),
      prisma.child.count({ where: { name: { contains: marker } } }),
      prisma.teacher.count({ where: { name: { contains: marker } } }),
      prisma.program.count({ where: { name: { contains: marker } } }),
    ]),
  ]);
  expect(idCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(markerCounts).toEqual([0, 0, 0, 0, 0, 0]);
}

async function createProgramAndClass(
  prisma: PrismaClient,
  resources: TestResources,
  input: { programLabel: string; classLabel: string; startsAt: Date; endsAt: Date },
) {
  const program = await prisma.program.create({
    data: { name: `${input.programLabel}_${resources.marker}`, defaultPrice: 0 },
  });
  resources.programIds.add(program.id);
  const teacher = await prisma.teacher.create({
    data: { name: `TEST_TEACHER_${input.classLabel}_${resources.marker}` },
  });
  resources.teacherIds.add(teacher.id);
  const classSchedule = await prisma.classSchedule.create({
    data: {
      programId: program.id,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: `${input.classLabel}_${resources.marker}`,
      capacity: 8,
    },
  });
  resources.classIds.add(classSchedule.id);
  const classTeacher = await prisma.classTeacher.create({
    data: { classScheduleId: classSchedule.id, teacherId: teacher.id },
  });
  resources.classTeacherIds.add(classTeacher.id);
  return { program, teacher, classSchedule };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function childIdFromUrl(page: Page) {
  const match = new URL(page.url()).pathname.match(/^\/children\/([^/]+)$/);
  if (!match || match[1] === "new") throw new Error("생성된 아이 상세 URL을 확인할 수 없습니다.");
  return match[1];
}

function isChildDetailUrl(url: URL) {
  const match = url.pathname.match(/^\/children\/([^/]+)$/);
  return match !== null && match[1] !== "new";
}

function reservationIdFromUrl(page: Page) {
  const match = new URL(page.url()).pathname.match(/^\/reservations\/([^/]+)$/);
  if (!match || match[1] === "new") throw new Error("생성된 예약 상세 URL을 확인할 수 없습니다.");
  return match[1];
}

function isReservationDetailUrl(url: URL) {
  const match = url.pathname.match(/^\/reservations\/([^/]+)$/);
  return match !== null && match[1] !== "new";
}

test.describe("Phase 11 핵심 운영 흐름", () => {
  test("아이 등록·수정, 기존 안전정보 노출 범위, 정상 예약 생성·조회 연결", async ({ page }) => {
    test.setTimeout(180_000);
    const prisma = new PrismaClient();
    const resources = createResources();
    const initialChildName = `TEST_CHILD_INITIAL_${resources.marker}`;
    const updatedChildName = `TEST_CHILD_UPDATED_${resources.marker}`;
    const initialBirthDate = "2018-04-12";
    const updatedBirthDate = "2019-05-13";
    const initialChildMemo = `TEST_CHILD_INITIAL_MEMO_${resources.marker}`;
    const childMemo = `TEST_CHILD_MEMO_${resources.marker}`;
    const safetyAllergies = `TEST_ALLERGIES_${resources.marker}`;
    const safetyNotes = `TEST_EMERGENCY_NOTES_${resources.marker}`;
    const safetyContact = `TEST_CONTACT_${resources.marker}`;
    const safetyProgramLabel = "TEST_SAFETY_PROGRAM";
    const bookingProgramLabel = "TEST_BOOKING_PROGRAM";
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    try {
      const safetyFixture = await createProgramAndClass(prisma, resources, {
        programLabel: safetyProgramLabel,
        classLabel: "TEST_SAFETY_CLASS",
        startsAt: new Date(now + 2 * oneDay),
        endsAt: new Date(now + 2 * oneDay + 60 * 60 * 1000),
      });
      const bookingFixture = await createProgramAndClass(prisma, resources, {
        programLabel: bookingProgramLabel,
        classLabel: "TEST_BOOKING_CLASS",
        startsAt: new Date(now + 3 * oneDay),
        endsAt: new Date(now + 3 * oneDay + 60 * 60 * 1000),
      });

      await login(page);
      await page.goto(`/classes/${safetyFixture.classSchedule.id}`);
      await expect(
        page.getByRole("link", { name: safetyFixture.program.name, exact: true }),
      ).toHaveAttribute("href", `/programs/${safetyFixture.program.id}`);
      await expect(page.getByText(safetyFixture.classSchedule.location, { exact: true })).toBeVisible();

      await page.goto("/children/new");
      await page.getByLabel(/^이름/).fill(initialChildName);
      await page.getByLabel("생년월일").fill(initialBirthDate);
      await page.getByLabel("성별").selectOption("MALE");
      await page.getByLabel("운영 메모").fill(initialChildMemo);
      await page.getByRole("button", { name: "등록" }).click();
      await expect(page).toHaveURL(isChildDetailUrl);
      const childId = childIdFromUrl(page);
      resources.childIds.add(childId);
      await expect(page.getByRole("heading", { name: initialChildName })).toBeVisible();
      await expect(page.getByText(initialBirthDate, { exact: false })).toBeVisible();
      await expect(page.getByText("남아", { exact: true })).toBeVisible();
      await expect(page.getByText(initialChildMemo, { exact: true })).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(`/children/${childId}`);
      await expect(page.getByRole("heading", { name: initialChildName })).toBeVisible();
      await expect(page.getByText(initialBirthDate, { exact: false })).toBeVisible();
      await expect(page.getByText("남아", { exact: true })).toBeVisible();
      await expect(page.getByText(initialChildMemo, { exact: true })).toBeVisible();

      const createdChildren = await prisma.child.findMany({
        where: { name: initialChildName },
        select: { id: true, name: true, birthDate: true, gender: true, memo: true },
      });
      expect(createdChildren).toHaveLength(1);
      const createdChild = createdChildren[0];
      expect(createdChild.id).toBe(childId);
      expect(createdChild.name).toBe(initialChildName);
      expect(createdChild.gender).toBe("MALE");
      expect(createdChild.memo).toBe(initialChildMemo);
      expect(createdChild.birthDate?.toISOString().slice(0, 10)).toBe(initialBirthDate);

      await page.getByRole("link", { name: "정보 수정", exact: true }).click();
      await page.getByLabel(/^이름/).fill(updatedChildName);
      await page.getByLabel("생년월일").fill(updatedBirthDate);
      await page.getByLabel("성별").selectOption("FEMALE");
      await page.getByLabel("운영 메모").fill(childMemo);
      await page.getByRole("button", { name: "저장" }).click();
      await expect(page).toHaveURL(`/children/${childId}`);
      await expect(page.getByRole("heading", { name: updatedChildName })).toBeVisible();
      await expect(page.getByText(updatedBirthDate, { exact: false })).toBeVisible();
      await expect(page.getByText(childMemo, { exact: true })).toBeVisible();
      await expect(page.getByText("여아", { exact: true })).toBeVisible();

      const updatedChild = await prisma.child.findUniqueOrThrow({
        where: { id: childId },
        select: { name: true, birthDate: true, gender: true, memo: true },
      });
      expect(updatedChild).toMatchObject({ name: updatedChildName, gender: "FEMALE", memo: childMemo });
      expect(updatedChild.birthDate?.toISOString().slice(0, 10)).toBe(updatedBirthDate);

      await page.goto(`/children?q=${encodeURIComponent(updatedChildName)}&status=all`);
      const childListLinkName = new RegExp(`^${escapeRegExp(updatedChildName)}(?:\\s|$)`);
      const childListRow = page.getByRole("row").filter({
        has: page.getByRole("link", { name: childListLinkName }),
      });
      const childListLink = childListRow.getByRole("link", { name: childListLinkName });
      await expect(childListRow).toHaveCount(1);
      await expect(childListLink).toHaveAttribute("href", `/children/${childId}`);

      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN_EMAIL },
        select: { id: true },
      });
      const safetyInfo = await prisma.childSafetyInfo.create({
        data: {
          childId,
          allergies: safetyAllergies,
          emergencyNotes: safetyNotes,
          emergencyContactName: safetyContact,
          emergencyContactPhone: `TEST_PHONE_${resources.marker}`,
          updatedById: admin.id,
        },
      });
      resources.safetyInfoIds.add(safetyInfo.id);
      const safetyReservation = await prisma.reservation.create({
        data: {
          childId,
          classScheduleId: safetyFixture.classSchedule.id,
          memo: `TEST_SAFETY_RESERVATION_${resources.marker}`,
        },
      });
      resources.reservationIds.add(safetyReservation.id);

      await page.goto(`/children/${childId}`);
      await expect(page.getByText(safetyAllergies, { exact: true })).toBeVisible();
      await expect(page.getByText(safetyNotes, { exact: true })).toBeVisible();
      await expect(page.getByText(safetyContact, { exact: false })).toBeVisible();

      await page.goto(`/classes/${safetyFixture.classSchedule.id}`);
      const participantRow = page.getByRole("listitem").filter({
        has: page.getByRole("link", { name: updatedChildName, exact: true }),
      });
      await expect(participantRow).toHaveCount(1);
      await expect(participantRow).toContainText(`알레르기: ${safetyAllergies}`);
      await expect(participantRow).toContainText(`응급 유의사항: ${safetyNotes}`);
      await expect(participantRow).toContainText(safetyContact);

      await page.goto(`/children?q=${encodeURIComponent(updatedChildName)}&status=all`);
      await expect(page.getByText(safetyAllergies, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyNotes, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyContact, { exact: false })).toHaveCount(0);
      await page.goto(`/reservations?childName=${encodeURIComponent(updatedChildName)}&status=all`);
      await expect(page.getByText(safetyAllergies, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyNotes, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyContact, { exact: false })).toHaveCount(0);

      await page.goto(`/children/${childId}`);
      await page.getByRole("link", { name: "예약 추가" }).click();
      await expect(page).toHaveURL(`/reservations/new?childId=${childId}`);
      await expect(page.getByLabel("아이", { exact: false })).toHaveValue(childId);
      await page.getByLabel("클래스", { exact: false }).selectOption(bookingFixture.classSchedule.id);
      await expect(page.getByLabel("클래스", { exact: false })).toHaveValue(bookingFixture.classSchedule.id);
      const reservationMemo = `TEST_BOOKING_RESERVATION_${resources.marker}`;
      await page.getByLabel("메모").fill(reservationMemo);
      await page.getByRole("button", { name: "예약 등록" }).click();
      await expect(page).toHaveURL(isReservationDetailUrl);
      const reservationId = reservationIdFromUrl(page);
      resources.reservationIds.add(reservationId);

      await expect(page.getByRole("heading", { name: `${updatedChildName} 예약` })).toBeVisible();
      await expect(page.getByRole("link", { name: updatedChildName, exact: true })).toHaveAttribute(
        "href",
        `/children/${childId}`,
      );
      await expect(
        page.getByRole("link", { name: bookingFixture.program.name, exact: true }),
      ).toHaveAttribute("href", `/classes/${bookingFixture.classSchedule.id}`);
      await expect(page.getByText("예약됨", { exact: true })).toBeVisible();

      await page.goto(
        `/reservations?childName=${encodeURIComponent(updatedChildName)}&programName=${encodeURIComponent(bookingFixture.program.name)}&status=RESERVED`,
      );
      const reservationListRow = page.getByRole("row").filter({
        has: page.getByRole("link", { name: updatedChildName, exact: true }),
      });
      await expect(reservationListRow).toHaveCount(1);
      await expect(reservationListRow.getByRole("link", { name: updatedChildName, exact: true })).toHaveAttribute(
        "href",
        `/reservations/${reservationId}`,
      );
      await expect(reservationListRow).toContainText(bookingFixture.program.name);
      await expect(reservationListRow).toContainText("예약됨");
      await expect(page.getByText(safetyAllergies, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyNotes, { exact: true })).toHaveCount(0);
      await expect(page.getByText(safetyContact, { exact: false })).toHaveCount(0);

      const storedReservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      expect(storedReservation).toMatchObject({
        childId,
        classScheduleId: bookingFixture.classSchedule.id,
        status: "RESERVED",
        memo: reservationMemo,
      });
    } finally {
      await cleanupAndAssert(prisma, resources);
      await prisma.$disconnect();
    }
  });

  for (const scenario of [
    { attendance: "PRESENT" as const, status: "COMPLETED" as const, uiStatus: "참여완료", uiAttendance: "참석" },
    { attendance: "ABSENT" as const, status: "NO_SHOW" as const, uiStatus: "노쇼", uiAttendance: "불참" },
  ]) {
    test(`종료 클래스 RESERVED 예약을 ${scenario.attendance} 출결로 전환하고 이력을 보존`, async ({ page }) => {
      test.setTimeout(90_000);
      const prisma = new PrismaClient();
      const resources = createResources();
      const childName = `TEST_ATTENDANCE_${scenario.attendance}_${resources.marker}`;
      const now = Date.now();

      try {
        const admin = await prisma.user.findUniqueOrThrow({
          where: { email: ADMIN_EMAIL },
          select: { id: true },
        });
        const fixture = await createProgramAndClass(prisma, resources, {
          programLabel: `TEST_${scenario.attendance}_PROGRAM`,
          classLabel: `TEST_${scenario.attendance}_CLASS`,
          startsAt: new Date(now - 2 * 60 * 60 * 1000),
          endsAt: new Date(now - 60 * 60 * 1000),
        });
        const child = await prisma.child.create({ data: { name: childName } });
        resources.childIds.add(child.id);
        const reservation = await prisma.reservation.create({
          data: {
            childId: child.id,
            classScheduleId: fixture.classSchedule.id,
            status: "RESERVED",
            memo: `TEST_ATTENDANCE_RESERVATION_${resources.marker}`,
          },
        });
        resources.reservationIds.add(reservation.id);

        await login(page);
        await page.goto(`/classes/${fixture.classSchedule.id}`);
        const participantRow = page.getByRole("listitem").filter({
          has: page.getByRole("link", { name: childName, exact: true }),
        });
        await expect(participantRow).toHaveCount(1);
        await participantRow.getByRole("combobox").selectOption(scenario.attendance);
        await participantRow.getByRole("button", { name: "출결 기록" }).click();
        await expect(participantRow.getByRole("status")).toHaveText("저장됨");
        await expect(participantRow.getByText(scenario.uiStatus, { exact: true })).toBeVisible();

        const storedReservation = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
        expect(storedReservation.status).toBe(scenario.status);
        expect(storedReservation.attendance).toBe(scenario.attendance);
        expect(storedReservation.attendanceRecordedAt).not.toBeNull();
        expect(storedReservation.attendanceRecordedById).toBe(admin.id);
        console.info("ATTENDANCE_DB_VERIFIED", scenario.attendance, scenario.status);

        await expect(participantRow.getByRole("combobox")).toHaveValue(scenario.attendance);
        await page.reload();
        await expect(participantRow.getByText(scenario.uiStatus, { exact: true })).toBeVisible();
        await expect(participantRow.getByRole("combobox")).toHaveValue(scenario.attendance);
        await expect(participantRow.getByRole("link", { name: "예약 취소" })).toHaveAttribute(
          "href",
          `/reservations/${reservation.id}/cancel`,
        );

        await page.goto(`/reservations/${reservation.id}`);
        await expect(page.getByRole("heading", { name: `${childName} 예약` })).toBeVisible();
        await expect(page.getByText(scenario.uiStatus, { exact: true })).toBeVisible();
        await expect(page.getByText(scenario.uiAttendance, { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: childName, exact: true })).toHaveAttribute(
          "href",
          `/children/${child.id}`,
        );
        await expect(page.getByRole("link", { name: fixture.program.name, exact: true })).toHaveAttribute(
          "href",
          `/classes/${fixture.classSchedule.id}`,
        );
        await expect(page.getByRole("link", { name: "예약 취소" })).toHaveAttribute(
          "href",
          `/reservations/${reservation.id}/cancel`,
        );
      } finally {
        await cleanupAndAssert(prisma, resources);
        await prisma.$disconnect();
      }
    });
  }
});
