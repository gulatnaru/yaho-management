import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { formatKstDate } from "@/lib/classes/datetime";
import { generateRecurringClassDates } from "@/lib/classes/recurrence";
import { recurringClassInputSchema } from "@/lib/validation/class";
import {
  createRecurringClassesCore,
  RecurringClassDuplicateError,
} from "@/server/classes/create-recurring";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

type Resources = {
  marker: string;
  programIds: string[];
  teacherIds: string[];
};

function createResources(): Resources {
  return {
    marker: `E2E_P15_${randomUUID()}`,
    programIds: [],
    teacherIds: [],
  };
}

function nextMonthRange() {
  const [currentYear, currentMonth] = formatKstDate(new Date()).split("-").map(Number);
  const start = new Date(Date.UTC(currentYear, currentMonth, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const format = (date: Date) => {
    const year = String(date.getUTCFullYear()).padStart(4, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { repeatStartDate: format(start), repeatEndDate: format(end) };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(ADMIN_EMAIL as string);
  await page.getByLabel("비밀번호").fill(ADMIN_PASSWORD as string);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

function isClassDetailUrl(url: URL) {
  const match = url.pathname.match(/^\/classes\/([^/]+)$/);
  return match !== null && match[1] !== "new";
}

async function createProgramAndTeachers(prisma: PrismaClient, resources: Resources) {
  const program = await prisma.program.create({
    data: { name: `RECURRING_PROGRAM_${resources.marker}`, defaultPrice: 40_000 },
  });
  resources.programIds.push(program.id);
  const teachers = await Promise.all(
    ["A", "B"].map((suffix) =>
      prisma.teacher.create({ data: { name: `RECURRING_TEACHER_${suffix}_${resources.marker}` } }),
    ),
  );
  resources.teacherIds.push(...teachers.map(({ id }) => id));
  return { program, teachers };
}

async function discoverClassIds(prisma: PrismaClient, marker: string) {
  const classes = await prisma.classSchedule.findMany({
    where: { location: { contains: marker } },
    select: { id: true },
  });
  return classes.map(({ id }) => id);
}

async function cleanupAndAssert(prisma: PrismaClient, resources: Resources) {
  const classIds = await discoverClassIds(prisma, resources.marker);
  await prisma.classTeacher.deleteMany({ where: { classScheduleId: { in: classIds } } });
  await prisma.classSchedule.deleteMany({ where: { id: { in: classIds } } });
  await prisma.teacher.deleteMany({ where: { id: { in: resources.teacherIds } } });
  await prisma.program.deleteMany({ where: { id: { in: resources.programIds } } });

  const markerCounts = await Promise.all([
    prisma.program.count({ where: { name: { contains: resources.marker } } }),
    prisma.teacher.count({ where: { name: { contains: resources.marker } } }),
    prisma.classSchedule.count({ where: { location: { contains: resources.marker } } }),
  ]);
  expect(markerCounts).toEqual([0, 0, 0]);
}

async function fillRecurringForm(
  page: Page,
  input: {
    programId: string;
    teacherNames: string[];
    repeatStartDate: string;
    repeatEndDate: string;
    location: string;
  },
) {
  await page.getByLabel("반복 등록").check();
  await page.getByLabel(/^프로그램/).selectOption(input.programId);
  await page.getByLabel(/^시작일/).fill(input.repeatStartDate);
  await page.getByLabel(/^종료일/).fill(input.repeatEndDate);
  await page.getByLabel("토요일").check();
  await page.getByLabel("일요일").check();
  await page.getByLabel(/^시작 시간/).fill("09:00");
  await page.getByLabel(/^종료 시간/).fill("11:00");
  await page.getByLabel(/^장소/).fill(input.location);
  await page.getByLabel("정원").fill("12");
  for (const teacherName of input.teacherNames) {
    await page.getByLabel(teacherName, { exact: true }).check();
  }
}

test("반복 등록은 미리보기한 날짜와 공통 값을 한 번에 생성하고 필터 목록으로 이동한다", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();
  const range = nextMonthRange();
  const recurrence = generateRecurringClassDates({ ...range, weekdays: [0, 6] });
  if (!recurrence.success) throw new Error(recurrence.message);
  const location = `RECURRING_LOCATION_${resources.marker}`;
  const memo = `RECURRING_MEMO_${resources.marker}`;

  try {
    const { program, teachers } = await createProgramAndTeachers(prisma, resources);
    await prisma.classSchedule.create({
      data: {
        programId: program.id,
        startsAt: new Date("2099-12-30T00:00:00.000Z"),
        endsAt: new Date("2099-12-30T02:00:00.000Z"),
        location: `INSURANCE_PREFILL_${resources.marker}`,
        insured: true,
        insurer: "테스트 보험사",
        insurancePolicyNo: `POLICY_${resources.marker}`,
        safetyMemo: `SAFETY_${resources.marker}`,
      },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/classes/new");
    await expect(page.getByRole("radiogroup", { name: "등록 방식" })).toBeVisible();
    await fillRecurringForm(page, {
      programId: program.id,
      teacherNames: teachers.map(({ name }) => name),
      ...range,
      location: `  ${location}  `,
    });
    await page.getByLabel("메모").fill("미리보기 전 메모");
    await page.getByRole("button", { name: "생성 일정 미리보기" }).click();
    const preview = page.getByRole("region", { name: "생성 일정 미리보기" });
    await expect(preview).toContainText(`${range.repeatStartDate} ~ ${range.repeatEndDate}`);
    await expect(preview).toContainText("토요일");
    await expect(preview).toContainText("일요일");
    await expect(preview).toContainText(`총 ${recurrence.dates.length}개 클래스`);
    for (const date of recurrence.dates) {
      await expect(preview.getByText(date, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "직전 클래스 값 불러오기" }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByLabel("보험 가입")).toBeChecked();
    await expect(page.getByLabel("보험사")).toHaveValue("테스트 보험사");
    await expect(page.getByLabel("증권번호")).toHaveValue(`POLICY_${resources.marker}`);
    await expect(page.getByLabel("활동 장소 안전 특이사항")).toHaveValue(
      `SAFETY_${resources.marker}`,
    );
    await page.getByRole("button", { name: "생성 일정 미리보기" }).click();
    await expect(preview).toBeVisible();

    await page.getByLabel("메모").fill(memo);
    await expect(preview).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `${recurrence.dates.length}개 클래스 등록` }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "생성 일정 미리보기" }).click();
    await page.getByRole("button", { name: `${recurrence.dates.length}개 클래스 등록` }).click();

    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === "/classes" &&
        url.searchParams.get("dateFrom") === range.repeatStartDate &&
        url.searchParams.get("dateTo") === range.repeatEndDate &&
        url.searchParams.get("status") === "all"
      );
    });

    const created = await prisma.classSchedule.findMany({
      where: { location },
      orderBy: { startsAt: "asc" },
      include: { teachers: { select: { teacherId: true } } },
    });
    expect(created).toHaveLength(recurrence.dates.length);
    expect(created.map(({ startsAt }) => formatKstDate(startsAt))).toEqual(recurrence.dates);
    for (const classSchedule of created) {
      expect(classSchedule).toMatchObject({
        programId: program.id,
        location,
        capacity: 12,
        memo,
        insured: true,
        insurer: "테스트 보험사",
        insurancePolicyNo: `POLICY_${resources.marker}`,
        safetyMemo: `SAFETY_${resources.marker}`,
      });
      expect(classSchedule.teachers.map(({ teacherId }) => teacherId).sort()).toEqual(
        resources.teacherIds.toSorted(),
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
      true,
    );
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("반복 등록은 중복 하나가 있으면 전체를 거부하고 입력값을 보존한다", async ({ page }) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();
  const range = nextMonthRange();
  const recurrence = generateRecurringClassDates({ ...range, weekdays: [0, 6] });
  if (!recurrence.success) throw new Error(recurrence.message);
  const location = `DUPLICATE_LOCATION_${resources.marker}`;

  try {
    const { program, teachers } = await createProgramAndTeachers(prisma, resources);
    await prisma.classSchedule.create({
      data: {
        programId: program.id,
        startsAt: new Date(`${recurrence.dates[0]}T00:00:00.000Z`),
        endsAt: new Date(`${recurrence.dates[0]}T02:00:00.000Z`),
        location,
        status: "CANCELLED",
      },
    });

    await login(page);
    await page.goto("/classes/new");
    await fillRecurringForm(page, {
      programId: program.id,
      teacherNames: [teachers[0].name],
      ...range,
      location,
    });
    await page.getByLabel("메모").fill(`DUPLICATE_MEMO_${resources.marker}`);
    await page.getByRole("button", { name: "생성 일정 미리보기" }).click();
    await page.getByRole("button", { name: `${recurrence.dates.length}개 클래스 등록` }).click();

    await expect(page.getByText(/이미 같은 클래스가 있는 날짜가 있습니다/)).toBeVisible();
    await expect(page.getByLabel("반복 등록")).toBeChecked();
    await expect(page.getByLabel(/^시작일/)).toHaveValue(range.repeatStartDate);
    await expect(page.getByLabel(/^종료일/)).toHaveValue(range.repeatEndDate);
    await expect(page.getByLabel("토요일")).toBeChecked();
    await expect(page.getByLabel("일요일")).toBeChecked();
    await expect(page.getByLabel(/^장소/)).toHaveValue(location);
    await expect(page.getByLabel("메모")).toHaveValue(`DUPLICATE_MEMO_${resources.marker}`);
    expect(await prisma.classSchedule.count({ where: { location } })).toBe(1);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("기존 단건 등록은 과거·중복을 허용하고 상세로 이동하며 비로그인 접근은 차단한다", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();
  const location = `SINGLE_LOCATION_${resources.marker}`;

  try {
    const { program, teachers } = await createProgramAndTeachers(prisma, resources);
    const duplicateData = {
      programId: program.id,
      startsAt: new Date("2020-01-04T00:00:00.000Z"),
      endsAt: new Date("2020-01-04T02:00:00.000Z"),
      location,
    };
    await prisma.classSchedule.create({ data: duplicateData });

    await login(page);
    await page.goto("/classes/new");
    await expect(page.getByLabel("단건 등록")).toBeChecked();
    await page.getByLabel(/^프로그램/).selectOption(program.id);
    await page.getByLabel(/^날짜/).fill("2020-01-04");
    await page.getByLabel(/^시작 시간/).fill("09:00");
    await page.getByLabel(/^종료 시간/).fill("11:00");
    await page.getByLabel(/^장소/).fill(location);
    await page.getByLabel(teachers[0].name, { exact: true }).check();
    await page.getByRole("button", { name: "등록", exact: true }).click();
    await expect(page).toHaveURL(isClassDetailUrl);
    expect(await prisma.classSchedule.count({ where: duplicateData })).toBe(2);

    await page.context().clearCookies();
    await page.goto("/classes/new");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "운영자 로그인" })).toBeVisible();
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});

test("같은 Program의 동시 반복 요청은 한 batch만 생성하고 부분 ClassTeacher를 남기지 않는다", async () => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  const resources = createResources();
  const range = nextMonthRange();
  const location = `CONCURRENT_LOCATION_${resources.marker}`;

  try {
    const { program, teachers } = await createProgramAndTeachers(prisma, resources);
    const input = recurringClassInputSchema.parse({
      programId: program.id,
      ...range,
      weekdays: ["6"],
      startTime: "09:00",
      endTime: "11:00",
      location,
      capacity: 8,
      teacherIds: teachers.map(({ id }) => id),
      memo: `CONCURRENT_MEMO_${resources.marker}`,
      insured: false,
    });

    const results = await Promise.allSettled([
      createRecurringClassesCore(input, prisma),
      createRecurringClassesCore(input, prisma),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(RecurringClassDuplicateError);
    }

    const classes = await prisma.classSchedule.findMany({
      where: { programId: program.id, location },
      select: { id: true },
    });
    expect(classes).toHaveLength(input.targetDates.length);
    expect(
      await prisma.classTeacher.count({
        where: { classScheduleId: { in: classes.map(({ id }) => id) } },
      }),
    ).toBe(input.targetDates.length * teachers.length);
  } finally {
    await cleanupAndAssert(prisma, resources);
    await prisma.$disconnect();
  }
});
