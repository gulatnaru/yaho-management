import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { readPublicApplicationConfig } from "@/lib/reservation-applications/config";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { APPLICATION_CLOSED_MESSAGE } from "@/lib/reservation-applications/constants";
import { generateApplicationLinkToken } from "@/lib/reservation-applications/token";

/**
 * Phase 18 예약 신청 E2E (로컬 전용, ADR-009).
 * 로컬 dev 서버가 읽는 .env/.env.local 에 입금 안내·채널 링크 환경변수(테스트 값)가 있어야 한다.
 * RESERVATION_APPLICATION_BANK_NAME / _BANK_ACCOUNT_NUMBER / _BANK_ACCOUNT_HOLDER,
 * YAHO_BLOG_URL / YAHO_INSTAGRAM_URL / YAHO_KAKAO_CHANNEL_URL (https)
 * 테스트 데이터는 모두 합성 값이며 실제 개인정보를 쓰지 않는다.
 */

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const configOrNull = readPublicApplicationConfig(process.env);

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}
if (!configOrNull) {
  throw new Error(
    "예약 신청 E2E에는 RESERVATION_APPLICATION_BANK_* 와 YAHO_*_URL(https) 테스트 환경변수가 필요합니다.",
  );
}

// 모듈 최상위에서 좁힌 타입을 고정해 테스트 콜백 안에서도 string/설정 타입으로 쓴다.
const adminEmail: string = ADMIN_EMAIL;
const adminPassword: string = ADMIN_PASSWORD;
const config = configOrNull;

const marker = `P18_${randomUUID().slice(0, 8)}`;
const priceMarker = 87_654;
const memoMarker = `CLASS_MEMO_${marker}`;
const safetyMarker = `SAFETY_MEMO_${marker}`;
const insurerMarker = `INSURER_${marker}`;
const teacherMarker = `TEACHER_${marker}`;
const staffPassword = `Phase18-${marker}!`;
const guardianPhone = "010-0000-1818";

const ids = {
  users: [] as string[],
  teachers: [] as string[],
  programs: [] as string[],
  classes: [] as string[],
  children: [] as string[],
  payments: [] as string[],
};

const tokens = {
  open: generateApplicationLinkToken(),
  full: generateApplicationLinkToken(),
  cancelled: generateApplicationLinkToken(),
  started: generateApplicationLinkToken(),
  stopped: generateApplicationLinkToken(),
  missing: generateApplicationLinkToken(),
};

let adminUserId: string;
let openClassId: string;
let fullClassId: string;
let managerEmail: string;
let teacherEmail: string;

const DAY = 24 * 60 * 60 * 1000;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function expectDenied(page: Page, path: string) {
  const response = await page.goto(path);
  if (response?.status() !== 404) {
    await expect(page.locator("body")).toContainText(/404|This page could not be found/i);
  }
}

async function fillApplicationForm(
  page: Page,
  childName: string,
  options?: { photoShare?: boolean; marketing?: boolean },
) {
  await page.getByLabel("아이 이름").fill(childName);
  await page.getByLabel("생년월일").fill("2019-05-01");
  await page.getByLabel("여", { exact: true }).check();
  await page.getByLabel("보호자 이름").fill(`보호자_${marker}`);
  await page.getByLabel("보호자 연락처").fill(guardianPhone);
  await page.getByLabel("모", { exact: true }).check();
  await page.getByLabel("요청사항").fill("합성 요청사항");
  await page.getByLabel(/위 안전 및 프로그램 이용사항을 확인하였습니다/).check();
  await page.getByLabel(/개인정보 수집·이용에 동의합니다/).check();
  await page.getByLabel(/본인은 위 아동의 법정대리인이며/).check();
  if (options?.photoShare) await page.getByLabel(/활동 사진·영상 촬영 및 참여 보호자 공유에 동의합니다/).check();
  if (options?.marketing) await page.getByLabel(/사진·영상 YAHO 홍보 활용에 동의합니다/).check();
  await page.getByLabel(/취소 및 환불규정을 확인하였습니다/).check();
}

async function createClass(input: {
  label: string;
  startsAt: Date;
  endsAt: Date;
  capacity?: number;
  status?: "SCHEDULED" | "CANCELLED";
  programId: string;
  teacherId: string;
}) {
  const created = await prisma.classSchedule.create({
    data: {
      programId: input.programId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: `장소_${input.label}_${marker}`,
      capacity: input.capacity ?? 8,
      status: input.status ?? "SCHEDULED",
      memo: memoMarker,
      insured: true,
      insurer: insurerMarker,
      safetyMemo: safetyMarker,
      teachers: { create: { teacherId: input.teacherId } },
    },
  });
  ids.classes.push(created.id);
  return created;
}

async function createApplication(input: {
  classScheduleId: string;
  childName: string;
  photoShareConsentAgreed?: boolean;
  photoMarketingConsentAgreed?: boolean;
  depositConfirmed?: boolean;
  status?: "REJECTED";
}) {
  return prisma.reservationApplication.create({
    data: {
      classScheduleId: input.classScheduleId,
      childName: input.childName,
      childBirthDate: new Date("2019-05-01"),
      childGender: "FEMALE",
      guardianName: `신청보호자_${marker}`,
      guardianPhone,
      guardianRelationship: "MOTHER",
      programTermsAcknowledged: true,
      privacyConsentAgreed: true,
      legalGuardianConfirmed: true,
      refundTermsAcknowledged: true,
      photoShareConsentAgreed: input.photoShareConsentAgreed ?? false,
      photoMarketingConsentAgreed: input.photoMarketingConsentAgreed ?? false,
      consentVersion: "e2e",
      submittedAt: new Date(Date.now() - 60 * 60 * 1000),
      ...(input.depositConfirmed
        ? { depositConfirmedAt: new Date(Date.now() - 30 * 60 * 1000), depositConfirmedById: adminUserId }
        : {}),
      ...(input.status === "REJECTED"
        ? { status: "REJECTED" as const, resolvedAt: new Date(), resolvedById: adminUserId, resolutionNote: "합성 반려" }
        : {}),
    },
  });
}

test.describe.serial("Phase 18 예약자용 고객 예약신청", () => {
  test.beforeAll(async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { id: true } });
    adminUserId = admin.id;

    const [program, teacher, passwordHash] = await Promise.all([
      prisma.program.create({
        data: { name: `프로그램_${marker}`, description: `설명_${marker}`, targetAgeMin: 5, targetAgeMax: 9, defaultPrice: priceMarker },
      }),
      prisma.teacher.create({ data: { name: teacherMarker, phone: "010-0000-2929" } }),
      hash(staffPassword, 4),
    ]);
    ids.programs.push(program.id);
    ids.teachers.push(teacher.id);

    const now = Date.now();
    const openClass = await createClass({
      label: "open",
      startsAt: new Date(now + 3 * DAY),
      endsAt: new Date(now + 3 * DAY + 2 * 60 * 60 * 1000),
      programId: program.id,
      teacherId: teacher.id,
    });
    const fullClass = await createClass({
      label: "full",
      startsAt: new Date(now + 4 * DAY),
      endsAt: new Date(now + 4 * DAY + 2 * 60 * 60 * 1000),
      capacity: 1,
      programId: program.id,
      teacherId: teacher.id,
    });
    const cancelledClass = await createClass({
      label: "cancelled",
      startsAt: new Date(now + 5 * DAY),
      endsAt: new Date(now + 5 * DAY + 2 * 60 * 60 * 1000),
      status: "CANCELLED",
      programId: program.id,
      teacherId: teacher.id,
    });
    const startedClass = await createClass({
      label: "started",
      startsAt: new Date(now - 60 * 60 * 1000),
      endsAt: new Date(now + 60 * 60 * 1000),
      programId: program.id,
      teacherId: teacher.id,
    });
    const stoppedClass = await createClass({
      label: "stopped",
      startsAt: new Date(now + 6 * DAY),
      endsAt: new Date(now + 6 * DAY + 2 * 60 * 60 * 1000),
      programId: program.id,
      teacherId: teacher.id,
    });
    openClassId = openClass.id;
    fullClassId = fullClass.id;

    const seatedChild = await prisma.child.create({ data: { name: `좌석아이_${marker}` } });
    ids.children.push(seatedChild.id);
    await prisma.reservation.create({ data: { classScheduleId: fullClass.id, childId: seatedChild.id } });

    await prisma.reservationApplicationLink.createMany({
      data: [
        { classScheduleId: openClass.id, token: tokens.open, issuedById: adminUserId },
        { classScheduleId: fullClass.id, token: tokens.full, issuedById: adminUserId },
        { classScheduleId: cancelledClass.id, token: tokens.cancelled, issuedById: adminUserId },
        { classScheduleId: startedClass.id, token: tokens.started, issuedById: adminUserId },
        { classScheduleId: stoppedClass.id, token: tokens.stopped, issuedById: adminUserId, isActive: false },
      ],
    });

    managerEmail = `manager-${marker.toLowerCase()}@phase18.test`;
    teacherEmail = `teacher-${marker.toLowerCase()}@phase18.test`;
    const [manager, teacherUser] = await Promise.all([
      prisma.user.create({ data: { name: `준관리자_${marker}`, email: managerEmail, password: passwordHash, role: "MANAGER" } }),
      prisma.user.create({
        data: { name: `선생님계정_${marker}`, email: teacherEmail, password: passwordHash, role: "TEACHER", teacherId: teacher.id },
      }),
    ]);
    ids.users.push(manager.id, teacherUser.id);
  });

  test.afterAll(async () => {
    const applications = await prisma.reservationApplication.findMany({
      where: { classScheduleId: { in: ids.classes } },
      select: { id: true, childId: true },
    });
    const childIds = [...new Set([...ids.children, ...applications.flatMap((row) => (row.childId ? [row.childId] : []))])];
    await prisma.childConsent.deleteMany({
      where: { OR: [{ reservationApplicationId: { in: applications.map((row) => row.id) } }, { childId: { in: childIds } }] },
    });
    await prisma.reservationApplication.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.reservationApplicationLink.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.paymentItem.deleteMany({ where: { reservation: { classScheduleId: { in: ids.classes } } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
    await prisma.reservation.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.classTeacher.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.classSchedule.deleteMany({ where: { id: { in: ids.classes } } });
    await prisma.child.deleteMany({ where: { id: { in: childIds } } });
    await prisma.program.deleteMany({ where: { id: { in: ids.programs } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.teacher.deleteMany({ where: { id: { in: ids.teachers } } });
    await prisma.$disconnect();
  });

  test("공개 신청 화면은 허용된 클래스 정보만 보여주고 운영·가용성 정보는 응답에 없다", async ({ page }) => {
    await page.goto(`/apply/${tokens.open}`);

    await expect(page.getByRole("heading", { name: "예약 신청" })).toBeVisible();
    await expect(page.getByText(`프로그램_${marker}`)).toBeVisible();
    await expect(page.getByText(`설명_${marker}`)).toBeVisible();
    await expect(page.getByText(`장소_open_${marker}`)).toBeVisible();
    await expect(page.getByText("만 5~9세")).toBeVisible();

    const html = await page.content();
    for (const forbidden of [memoMarker, safetyMarker, insurerMarker, teacherMarker, "87,654", "정원", "잔여", "만석"]) {
      expect(html).not.toContain(forbidden);
    }
    await expect(page.getByRole("link", { name: "예약 관리" })).toHaveCount(0);
  });

  test("만석 클래스도 신청 화면이 여유 있는 클래스와 같다", async ({ page }) => {
    await page.goto(`/apply/${tokens.open}`);
    const openForm = await page.locator("form").innerText();

    await page.goto(`/apply/${tokens.full}`);
    await expect(page.getByRole("button", { name: "신청하기" })).toBeVisible();
    expect(await page.locator("form").innerText()).toBe(openForm);
    expect(await page.content()).not.toContain("만석");
  });

  test("취소·시작된 클래스, 중지·없는 링크는 모두 같은 안내만 보여준다", async ({ page }) => {
    for (const token of [tokens.cancelled, tokens.started, tokens.stopped, tokens.missing, "not-a-valid-token"]) {
      await page.goto(`/apply/${token}`);
      await expect(page.getByTestId("application-closed")).toHaveText(APPLICATION_CLOSED_MESSAGE);
      await expect(page.getByRole("button", { name: "신청하기" })).toHaveCount(0);
      expect(await page.content()).not.toContain(`장소_`);
    }
  });

  test("필수 항목과 동의가 없으면 필드별 오류를 보여주고 입력값을 유지한다", async ({ page }) => {
    await page.goto(`/apply/${tokens.open}`);
    await page.getByLabel("아이 이름").fill(`검증아이_${marker}`);
    await page.getByLabel("보호자 연락처").fill("abc");
    await page.getByRole("button", { name: "신청하기" }).click();

    await expect(page.getByText("생년월일을 입력해주세요")).toBeVisible();
    await expect(page.getByText("성별을 선택해주세요")).toBeVisible();
    await expect(page.getByText("아이와의 관계를 선택해주세요")).toBeVisible();
    await expect(page.getByText("프로그램 안전 및 이용사항을 확인해주세요")).toBeVisible();
    await expect(page.getByText("법정대리인 확인에 동의해주세요")).toBeVisible();
    await expect(page.getByText("취소 및 환불규정을 확인해주세요")).toBeVisible();
    await expect(page.getByText("전화번호 형식이 올바르지 않습니다 (숫자, 하이픈만 가능)")).toBeVisible();
    await expect(page.getByText("개인정보 수집·이용에 동의해주세요")).toBeVisible();
    await expect(page.getByLabel("아이 이름")).toHaveValue(`검증아이_${marker}`);
    await expect(page.getByLabel("보호자 연락처")).toHaveValue("abc");
    expect(await prisma.reservationApplication.count({ where: { childName: `검증아이_${marker}` } })).toBe(0);
  });

  test("선택 동의 없이도 제출되고, 신청만 저장되며 완료 화면에 입금 계좌와 채널 링크만 안내한다", async ({ page }) => {
    const childName = `신청아이_${marker}`;
    const reservationsBefore = await prisma.reservation.count({ where: { classScheduleId: openClassId } });
    const [paymentsBefore, consentsBefore] = await Promise.all([prisma.payment.count(), prisma.childConsent.count()]);

    await page.goto(`/apply/${tokens.open}`);
    await fillApplicationForm(page, childName, { marketing: true });
    await page.getByRole("button", { name: "신청하기" }).click();

    await expect(page).toHaveURL(/\/apply\/complete$/);
    await expect(page.getByRole("heading", { name: "신청이 접수되었습니다" })).toBeVisible();
    await expect(page.getByText(config.bankName, { exact: true })).toBeVisible();
    await expect(page.getByText(config.bankAccountNumber, { exact: true })).toBeVisible();
    await expect(page.getByText(config.bankAccountHolder, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "YAHO 블로그" })).toHaveAttribute("href", config.blogUrl);
    await expect(page.getByRole("link", { name: "YAHO Instagram" })).toHaveAttribute("href", config.instagramUrl);
    await expect(page.getByRole("link", { name: "YAHO 카카오톡 채널" })).toHaveAttribute("href", config.kakaoChannelUrl);
    const completeHtml = await page.content();
    for (const forbidden of ["입금 기한", "입금자명", "환불", childName, guardianPhone]) {
      expect(completeHtml).not.toContain(forbidden);
    }

    const application = await prisma.reservationApplication.findFirstOrThrow({ where: { childName } });
    expect(application).toMatchObject({
      status: "SUBMITTED",
      classScheduleId: openClassId,
      guardianPhone,
      requestNote: "합성 요청사항",
      guardianRelationship: "MOTHER",
      programTermsAcknowledged: true,
      privacyConsentAgreed: true,
      legalGuardianConfirmed: true,
      refundTermsAcknowledged: true,
      photoShareConsentAgreed: false,
      photoMarketingConsentAgreed: true,
      childId: null,
      reservationId: null,
    });
    expect(application.consentVersion).toBe(APPLICATION_CONSENT_CONTENT.version);
    expect(await prisma.child.count({ where: { name: childName } })).toBe(0);
    expect(await prisma.reservation.count({ where: { classScheduleId: openClassId } })).toBe(reservationsBefore);
    expect(await prisma.payment.count()).toBe(paymentsBefore);
    expect(await prisma.childConsent.count()).toBe(consentsBefore);
  });

  test("화면을 연 뒤 링크가 중지되면 제출이 거부된다", async ({ page }) => {
    const childName = `중지후아이_${marker}`;
    await page.goto(`/apply/${tokens.open}`);
    await fillApplicationForm(page, childName);
    await prisma.reservationApplicationLink.update({ where: { token: tokens.open }, data: { isActive: false } });
    try {
      await page.getByRole("button", { name: "신청하기" }).click();
      await expect(page.getByText(APPLICATION_CLOSED_MESSAGE)).toBeVisible();
      expect(await prisma.reservationApplication.count({ where: { childName } })).toBe(0);
    } finally {
      await prisma.reservationApplicationLink.update({ where: { token: tokens.open }, data: { isActive: true } });
    }
  });

  test("ADMIN은 처리 대기 신청을 보고 입금 확인 후 새 아이로 예약을 확정한다", async ({ page }) => {
    const childName = `신청아이_${marker}`;
    const duplicate = await createApplication({ classScheduleId: openClassId, childName });
    await login(page, adminEmail, adminPassword);

    await expect(page.getByRole("link", { name: /예약 신청 \(\d+\)/ }).first()).toBeAttached();
    await page.goto("/reservation-applications");
    const rows = page.getByTestId("application-row").filter({ hasText: childName });
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByText("중복 가능")).toBeVisible();

    const application = await prisma.reservationApplication.findFirstOrThrow({
      where: { childName, id: { not: duplicate.id } },
    });
    await page.goto(`/reservation-applications/${application.id}`);
    await expect(page.getByRole("button", { name: "예약 확정" })).toHaveCount(0);
    await expect(page.getByText("아이와의 관계")).toBeVisible();
    const consents = page.getByTestId("application-consents");
    await expect(consents).toContainText("[필수] 법정대리인 확인");
    await expect(consents).toContainText("[필수] 취소 및 환불규정");
    await expect(consents).toContainText("[선택] 사진·영상 촬영 및 참여 보호자 공유");
    await expect(consents).toContainText("미동의");
    await expect(consents).toContainText(application.consentVersion);
    await expect(page.getByTestId("application-retention")).toContainText("수업일로부터 1년");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "입금 확인 기록" }).click();
    await expect(page.getByRole("button", { name: "예약 확정" })).toBeVisible();

    await page.getByLabel("신청 정보로 새 아이 등록").check();
    await page.getByRole("button", { name: "예약 확정" }).click();
    await expect(page).toHaveURL(/\/reservations\/[^/]+$/);

    const confirmed = await prisma.reservationApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.depositConfirmedById).toBe(adminUserId);
    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: confirmed.reservationId! },
      include: { child: true, paymentItem: true },
    });
    expect(reservation).toMatchObject({ status: "RESERVED", classScheduleId: openClassId, memo: "합성 요청사항" });
    expect(reservation.child).toMatchObject({ name: childName, guardianPhone });
    expect(reservation.paymentItem).toBeNull();

    const consentRows = await prisma.childConsent.findMany({ where: { reservationApplicationId: application.id } });
    expect(consentRows.map((row) => `${row.consentType}:${row.action}`).sort()).toEqual([
      "PHOTO_MARKETING:AGREED",
      "PHOTO_SHARE:DECLINED",
      "PRIVACY:AGREED",
    ]);
    for (const consent of consentRows) {
      expect(consent.recordedAt.getTime()).toBe(application.submittedAt.getTime());
      expect(consent.recordedById).toBe(adminUserId);
    }

    await page.goto(`/children/${reservation.childId}`);
    await expect(page.getByText(/보호자 온라인 동의\(예약 신청\)/).first()).toBeAttached();
    await expect(page.getByText("미동의").first()).toBeVisible();
  });

  test("기존 아이에 연결하면 아이 정보는 그대로 두고 홍보 동의는 철회로 기록한다", async ({ page }) => {
    const childName = `기존아이_${marker}`;
    const existing = await prisma.child.create({
      data: { name: childName, guardianName: `원래보호자_${marker}`, guardianPhone },
    });
    ids.children.push(existing.id);
    await prisma.childConsent.create({
      data: {
        childId: existing.id,
        consentType: "PHOTO_MARKETING",
        action: "AGREED",
        recordedAt: new Date(Date.now() - 10 * DAY),
        recordedById: adminUserId,
      },
    });
    const application = await createApplication({ classScheduleId: openClassId, childName, depositConfirmed: true });

    await login(page, adminEmail, adminPassword);
    await page.goto(`/reservation-applications/${application.id}`);
    await page.getByRole("radio", { name: new RegExp(`${childName}.*이름·연락처 일치`) }).check();
    await page.getByRole("button", { name: "예약 확정" }).click();
    await expect(page).toHaveURL(/\/reservations\/[^/]+$/);

    const child = await prisma.child.findUniqueOrThrow({ where: { id: existing.id } });
    expect(child.guardianName).toBe(`원래보호자_${marker}`);
    const latestMarketing = await prisma.childConsent.findFirstOrThrow({
      where: { childId: existing.id, consentType: "PHOTO_MARKETING" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    });
    expect(latestMarketing).toMatchObject({ action: "REVOKED", reservationApplicationId: application.id });
  });

  test("만석 클래스는 초과 예약 확인 후에만 확정된다", async ({ page }) => {
    const childName = `초과아이_${marker}`;
    const application = await createApplication({ classScheduleId: fullClassId, childName, depositConfirmed: true });

    await login(page, adminEmail, adminPassword);
    await page.goto(`/reservation-applications/${application.id}`);
    await page.getByLabel("신청 정보로 새 아이 등록").check();
    await page.getByRole("button", { name: "예약 확정" }).click();

    await expect(page.getByText(/정원 초과 1명/)).toBeVisible();
    expect((await prisma.reservationApplication.findUniqueOrThrow({ where: { id: application.id } })).status).toBe(
      "SUBMITTED",
    );

    await page.getByRole("button", { name: "초과 예약 확인 후 확정" }).click();
    await expect(page).toHaveURL(/\/reservations\/[^/]+$/);
    expect(await prisma.reservation.count({ where: { classScheduleId: fullClassId, status: "RESERVED" } })).toBe(2);
  });

  test("반려하면 사유가 남고 예약은 만들어지지 않는다", async ({ page }) => {
    const childName = `반려아이_${marker}`;
    const application = await createApplication({ classScheduleId: openClassId, childName });

    await login(page, adminEmail, adminPassword);
    await page.goto(`/reservation-applications/${application.id}`);
    await page.getByLabel(/반려 사유/).fill("합성 반려 사유");
    await page.getByRole("button", { name: "신청 반려" }).click();

    await expect(page.getByText("사유: 합성 반려 사유")).toBeVisible();
    const rejected = await prisma.reservationApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(rejected).toMatchObject({ status: "REJECTED", resolutionNote: "합성 반려 사유", reservationId: null });
    expect(rejected.resolvedById).toBe(adminUserId);
  });

  test("ADMIN은 클래스 상세에서 링크를 재발급하고 이전 링크는 즉시 닫힌다", async ({ page }) => {
    await login(page, adminEmail, adminPassword);
    await page.goto(`/classes/${openClassId}`);
    const card = page.getByTestId("application-link-card");
    await expect(card.getByLabel("예약 신청 링크 주소")).toHaveValue(new RegExp(`/apply/${tokens.open}$`));

    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "재발급" }).click();
    await expect(card.getByLabel("예약 신청 링크 주소")).not.toHaveValue(new RegExp(`/apply/${tokens.open}$`));

    const reissued = await prisma.reservationApplicationLink.findUniqueOrThrow({ where: { classScheduleId: openClassId } });
    expect(reissued.token).not.toBe(tokens.open);
    await page.goto(`/apply/${tokens.open}`);
    await expect(page.getByTestId("application-closed")).toHaveText(APPLICATION_CLOSED_MESSAGE);
    await page.goto(`/apply/${reissued.token}`);
    await expect(page.getByRole("button", { name: "신청하기" })).toBeVisible();
  });

  test("보관기간이 지난 반려 신청은 ADMIN 보관기간 관리에서 개인정보만 파기된다", async ({ page }) => {
    const now = Date.now();
    const oldClass = await createClass({
      label: "expired",
      startsAt: new Date(now - 400 * DAY),
      endsAt: new Date(now - 400 * DAY + 2 * 60 * 60 * 1000),
      programId: ids.programs[0]!,
      teacherId: ids.teachers[0]!,
    });
    const childName = `만료아이_${marker}`;
    const expired = await createApplication({ classScheduleId: oldClass.id, childName, status: "REJECTED" });
    const pendingName = `만료대기아이_${marker}`;
    const pending = await createApplication({ classScheduleId: oldClass.id, childName: pendingName });

    await login(page, adminEmail, adminPassword);
    await page.goto("/reservation-applications/retention");
    await expect(page.getByTestId("retention-purgeable")).toContainText(childName);
    await expect(page.getByTestId("retention-expired-pending")).toContainText(pendingName);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "보관기간 지난 개인정보 파기" }).click();
    await expect(page.getByText(/개인정보를 파기했습니다/)).toBeVisible();

    const purged = await prisma.reservationApplication.findUniqueOrThrow({ where: { id: expired.id } });
    expect(purged).toMatchObject({
      status: "REJECTED",
      childName: null,
      childBirthDate: null,
      guardianName: null,
      guardianPhone: null,
      guardianRelationship: null,
      requestNote: null,
      personalDataPurgedById: adminUserId,
      privacyConsentAgreed: true,
      consentVersion: "e2e",
    });
    expect(purged.personalDataPurgedAt).not.toBeNull();
    const stillPending = await prisma.reservationApplication.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stillPending).toMatchObject({ status: "SUBMITTED", childName: pendingName, personalDataPurgedAt: null });

    await page.goto(`/reservation-applications/${expired.id}`);
    await expect(page.getByTestId("application-purged")).toBeVisible();
    expect(await page.content()).not.toContain(guardianPhone);
  });

  test("마지막 예약 수업일로부터 5년이 지난 확정 고객은 비식별화되고 예약·결제 기록은 남는다", async ({ page }) => {
    const now = Date.now();
    const sixYearsAgo = await createClass({
      label: "six-years",
      startsAt: new Date(now - 6 * 366 * DAY),
      endsAt: new Date(now - 6 * 366 * DAY + 2 * 60 * 60 * 1000),
      programId: ids.programs[0]!,
      teacherId: ids.teachers[0]!,
    });
    const recentPast = await createClass({
      label: "four-years",
      startsAt: new Date(now - 4 * 366 * DAY),
      endsAt: new Date(now - 4 * 366 * DAY + 2 * 60 * 60 * 1000),
      programId: ids.programs[0]!,
      teacherId: ids.teachers[0]!,
    });
    const oldName = `오년경과아이_${marker}`;
    const keptName = `사년경과아이_${marker}`;
    const [oldChild, keptChild, sibling] = await Promise.all([
      prisma.child.create({
        data: {
          name: oldName,
          birthDate: new Date("2015-01-01"),
          gender: "FEMALE",
          guardianName: `오래된보호자_${marker}`,
          guardianPhone: "010-0000-5555",
          memo: "합성 운영 메모",
          safetyInfo: { create: { allergies: "합성 알레르기" } },
        },
      }),
      prisma.child.create({ data: { name: keptName, guardianPhone: "010-0000-4444" } }),
      prisma.child.create({ data: { name: `형제아이_${marker}` } }),
    ]);
    ids.children.push(oldChild.id, keptChild.id, sibling.id);
    const [childAId, childBId] = [oldChild.id, sibling.id].sort();
    await prisma.relationship.create({ data: { childAId: childAId!, childBId: childBId!, type: "SIBLING" } });
    await prisma.childConsent.create({
      data: { childId: oldChild.id, consentType: "PRIVACY", action: "AGREED", recordedById: adminUserId },
    });
    const [oldReservation] = await Promise.all([
      prisma.reservation.create({
        data: {
          classScheduleId: sixYearsAgo.id,
          childId: oldChild.id,
          status: "COMPLETED",
          attendance: "PRESENT",
          memo: "합성 예약 메모",
        },
      }),
      prisma.reservation.create({
        data: { classScheduleId: recentPast.id, childId: keptChild.id, status: "COMPLETED", attendance: "PRESENT" },
      }),
    ]);
    const payerName = `결제자_${marker}`;
    const payment = await prisma.payment.create({
      data: {
        payerName,
        method: "TRANSFER",
        totalAmount: 30_000,
        items: { create: { reservationId: oldReservation.id, amount: 30_000, paidAmount: 30_000 } },
      },
    });
    ids.payments.push(payment.id);

    await login(page, adminEmail, adminPassword);
    await page.goto("/reservation-applications/retention");
    await expect(page.getByTestId("retention-purgeable-children")).toContainText(oldName);
    await expect(page.getByTestId("retention-purgeable-children")).not.toContainText(keptName);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "보관기간 지난 개인정보 파기" }).click();
    await expect(page.getByText(/확정 고객 \d+명의 개인정보를 파기했습니다/)).toBeVisible();

    const purged = await prisma.child.findUniqueOrThrow({ where: { id: oldChild.id } });
    expect(purged).toMatchObject({
      name: "(파기됨)",
      birthDate: null,
      gender: "UNSPECIFIED",
      guardianName: null,
      guardianPhone: null,
      memo: null,
      isActive: false,
      personalDataPurgedById: adminUserId,
    });
    expect(await prisma.childConsent.count({ where: { childId: oldChild.id } })).toBe(0);
    expect(await prisma.childSafetyInfo.count({ where: { childId: oldChild.id } })).toBe(0);
    expect(await prisma.relationship.count({ where: { OR: [{ childAId: oldChild.id }, { childBId: oldChild.id }] } })).toBe(0);
    const keptReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: oldReservation.id },
      include: { paymentItem: { include: { payment: true } } },
    });
    expect(keptReservation).toMatchObject({ status: "COMPLETED", attendance: "PRESENT", memo: null, childId: oldChild.id });
    expect(keptReservation.paymentItem?.payment).toMatchObject({ payerName, totalAmount: 30_000 });
    expect(await prisma.child.findUniqueOrThrow({ where: { id: keptChild.id } })).toMatchObject({
      name: keptName,
      personalDataPurgedAt: null,
    });

    await page.goto(`/children/${oldChild.id}`);
    await expect(page.getByTestId("child-purged")).toBeVisible();
    await expect(page.getByRole("link", { name: "정보 수정" })).toHaveCount(0);
  });

  test("MANAGER와 TEACHER는 예약 신청 관리와 링크 카드에 접근할 수 없다", async ({ page }) => {
    const currentLink = await prisma.reservationApplicationLink.findUniqueOrThrow({ where: { classScheduleId: openClassId } });
    for (const email of [managerEmail, teacherEmail]) {
      await page.context().clearCookies();
      await login(page, email, staffPassword);
      await expect(page.getByRole("link", { name: /예약 신청/ })).toHaveCount(0);
      await expectDenied(page, "/reservation-applications");
      await expectDenied(page, "/reservation-applications/retention");
      await page.goto(`/classes/${openClassId}`);
      await expect(page.getByTestId("application-link-card")).toHaveCount(0);
      expect(await page.content()).not.toContain(currentLink.token);
    }
  });

  test("모바일에서 신청·완료 화면에 가로 스크롤이 없다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const reissued = await prisma.reservationApplicationLink.findUniqueOrThrow({ where: { classScheduleId: openClassId } });
    for (const path of [`/apply/${reissued.token}`, "/apply/complete"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
