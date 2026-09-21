import { PrismaClient } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import type { CurrentPrincipal } from "@/lib/auth/principal";
import { resetAccountPasswordCore, updateAccountCore } from "@/server/accounts/mutations";
import { changeOwnPasswordCore } from "@/server/auth/change-password";

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD 환경변수가 필요합니다.");
}

const suffix = `${Date.now()}`;
const password = `Phase16-${suffix}!`;
const resetPassword = `Phase16-reset-${suffix}!`;
const selfPassword = `Phase16-self-${suffix}!`;
const financeMarker = `PHASE16_FINANCE_${suffix}`;
const financeAmount = 87_654_321;

const ids = {
  users: [] as string[],
  teachers: [] as string[],
  programs: [] as string[],
  classes: [] as string[],
  reservations: [] as string[],
  children: [] as string[],
  payments: [] as string[],
};

let bootstrapAdminPrincipal: CurrentPrincipal;
let managerEmail: string;
let teacherEmail: string;
let teacherId: string;
let unrelatedTeacherId: string;
let assignedClassId: string;
let unrelatedClassId: string;
let assignedChildId: string;
let assignedReservationId: string;
let paymentItemId: string;
let programId: string;

async function login(page: Page, email: string, userPassword: string, expected = /\/dashboard/) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(userPassword);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(expected);
}

async function expectDenied(page: Page, path: string) {
  const response = await page.goto(path);
  if (response?.status() !== 404) {
    // App Router client transitions can render notFound() through the RSC
    // boundary while the document response itself remains 200 in dev mode.
    await expect(page.locator("body")).toContainText(/404|This page could not be found/i);
  }
}

test.describe.serial("Phase 16 계정·권한 관리", () => {
  test.beforeAll(async () => {
    const [bootstrapAdmin, passwordHash] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { email: ADMIN_EMAIL },
        select: { id: true, name: true, email: true, authVersion: true, mustChangePassword: true },
      }),
      hash(password, 4),
    ]);
    bootstrapAdminPrincipal = {
      userId: bootstrapAdmin.id,
      name: bootstrapAdmin.name,
      email: bootstrapAdmin.email,
      role: "ADMIN",
      teacherId: null,
      authVersion: bootstrapAdmin.authVersion,
      mustChangePassword: bootstrapAdmin.mustChangePassword,
    };
    const [assignedTeacher, unrelatedTeacher, program, assignedChild, unrelatedChild] = await Promise.all([
      prisma.teacher.create({ data: { name: `Phase16 배정 선생님 ${suffix}`, phone: "010-1111-2222" } }),
      prisma.teacher.create({ data: { name: `Phase16 미배정 선생님 ${suffix}`, phone: "010-3333-4444" } }),
      prisma.program.create({ data: { name: `Phase16 프로그램 ${suffix}`, defaultPrice: financeAmount } }),
      prisma.child.create({
        data: {
          name: `Phase16 배정 아이 ${suffix}`,
          guardianName: `Phase16 보호자 ${suffix}`,
          guardianPhone: "010-5555-6666",
          safetyInfo: { create: { allergies: `Phase16 알레르기 ${suffix}`, emergencyNotes: `Phase16 응급 ${suffix}` } },
        },
      }),
      prisma.child.create({ data: { name: `Phase16 미배정 아이 ${suffix}` } }),
    ]);
    teacherId = assignedTeacher.id;
    unrelatedTeacherId = unrelatedTeacher.id;
    programId = program.id;
    assignedChildId = assignedChild.id;
    ids.teachers.push(assignedTeacher.id, unrelatedTeacher.id);
    ids.programs.push(program.id);
    ids.children.push(assignedChild.id, unrelatedChild.id);

    managerEmail = `manager-${suffix}@phase16.test`;
    teacherEmail = `teacher-${suffix}@phase16.test`;
    const [manager, teacherUser] = await Promise.all([
      prisma.user.create({
        data: { name: `Phase16 준관리자 ${suffix}`, email: managerEmail, password: passwordHash, role: "MANAGER" },
      }),
      prisma.user.create({
        data: { name: `Phase16 계정 선생님 ${suffix}`, email: teacherEmail, password: passwordHash, role: "TEACHER", teacherId },
      }),
    ]);
    ids.users.push(manager.id, teacherUser.id);

    const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 60 * 60 * 1000);
    const [assignedClass, unrelatedClass] = await Promise.all([
      prisma.classSchedule.create({
        data: {
          programId,
          startsAt,
          endsAt,
          location: `Phase16 배정 장소 ${suffix}`,
          teachers: { create: { teacherId } },
          reservations: { create: { childId: assignedChild.id } },
        },
        include: { reservations: true },
      }),
      prisma.classSchedule.create({
        data: {
          programId,
          startsAt,
          endsAt,
          location: `Phase16 미배정 장소 ${suffix}`,
          teachers: { create: { teacherId: unrelatedTeacher.id } },
          reservations: { create: { childId: unrelatedChild.id } },
        },
      }),
    ]);
    assignedClassId = assignedClass.id;
    unrelatedClassId = unrelatedClass.id;
    assignedReservationId = assignedClass.reservations[0]!.id;
    ids.classes.push(assignedClass.id, unrelatedClass.id);
    ids.reservations.push(assignedReservationId);

    const payment = await prisma.payment.create({
      data: {
        payerName: financeMarker,
        method: "CASH",
        status: "PARTIAL_REFUNDED",
        totalAmount: financeAmount,
        items: {
          create: {
            reservationId: assignedReservationId,
            amount: financeAmount,
            discountAmount: 123_456,
            paidAmount: financeAmount - 123_456,
            refundedAmount: 7_654_321,
          },
        },
      },
      include: { items: true },
    });
    paymentItemId = payment.items[0]!.id;
    ids.payments.push(payment.id);
  });

  test.afterAll(async () => {
    await prisma.refund.deleteMany({ where: { paymentItem: { reservationId: { in: ids.reservations } } } });
    await prisma.paymentItem.deleteMany({ where: { reservationId: { in: ids.reservations } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
    await prisma.reservation.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.classTeacher.deleteMany({ where: { classScheduleId: { in: ids.classes } } });
    await prisma.classSchedule.deleteMany({ where: { id: { in: ids.classes } } });
    await prisma.childSafetyInfo.deleteMany({ where: { childId: { in: ids.children } } });
    await prisma.child.deleteMany({ where: { id: { in: ids.children } } });
    await prisma.program.deleteMany({ where: { id: { in: ids.programs } } });
    await prisma.userAccountChange.deleteMany({
      where: { OR: [{ targetUserId: { in: ids.users } }, { actorAdminId: { in: ids.users } }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.teacher.deleteMany({ where: { id: { in: ids.teachers } } });
    await prisma.$disconnect();
  });

  test("MANAGER는 비재무 운영 화면을 사용하지만 재무·계정 URL과 payload는 받지 않는다", async ({ page }) => {
    await login(page, managerEmail, password);

    await page.goto("/dashboard");
    await expect(page.getByTestId("summary-operation-reservations")).toHaveAttribute(
      "href",
      "/reservations",
    );
    await expect(page.getByTestId("summary-cancellations")).toHaveAttribute(
      "href",
      "/reservations?status=CANCELLED",
    );

    for (const path of ["/dashboard", "/children", "/programs", "/teachers", "/classes", "/reservations"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
    }

    const managerChildName = `Phase16 MANAGER 등록 아이 ${suffix}`;
    await page.goto("/children/new");
    await page.getByLabel("이름 *", { exact: true }).fill(managerChildName);
    await page.getByRole("button", { name: "등록" }).click();
    await expect(page).toHaveURL(/\/children\/(?!new$)[^/?]+$/);
    const managerChild = await prisma.child.findFirstOrThrow({ where: { name: managerChildName }, select: { id: true } });
    ids.children.push(managerChild.id);

    for (const path of [
      `/children/${assignedChildId}`,
      `/classes/${assignedClassId}`,
      `/reservations/${assignedReservationId}`,
      `/programs/${programId}`,
    ]) {
      await page.goto(path);
      const html = await page.content();
      expect(html).not.toContain(financeMarker);
      expect(html).not.toContain(String(financeAmount));
      expect(html).not.toContain("부분환불");
      expect(html).not.toContain("결제완료");
    }

    await expectDenied(page, "/payments");
    await expectDenied(page, "/revenue");
    await expectDenied(page, "/accounts");
    await expectDenied(page, `/refunds/new?paymentItemId=${paymentItemId}`);
  });

  test("TEACHER는 배정 클래스 참가자 최소정보와 출결만 사용하고 IDOR는 차단된다", async ({ page }) => {
    await login(page, teacherEmail, password);
    await page.goto("/dashboard");
    await expect(page.getByTestId("summary-operation-reservations")).toContainText(/\d+명/);
    await expect(page.getByTestId("summary-operation-reservations")).not.toHaveAttribute("href");
    await expect(page.getByTestId("summary-cancellations")).toContainText(/\d+건/);
    await expect(page.getByTestId("summary-cancellations")).not.toHaveAttribute("href");
    await expect(page.getByTestId("summary-operation-reservations").getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("summary-cancellations").getByRole("link")).toHaveCount(0);
    await expectDenied(page, "/reservations");

    await page.goto(`/classes/${assignedClassId}`);
    await expect(page.getByText(`Phase16 배정 아이 ${suffix}`)).toBeVisible();
    await expect(page.getByText(/010-5555-6666/)).toBeVisible();
    await expect(page.getByText(`Phase16 알레르기 ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Phase16 응급 ${suffix}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "예약 추가" })).toHaveCount(0);
    expect(await page.content()).not.toContain(financeMarker);

    await page.getByRole("button", { name: "출결 기록" }).click();
    await expect.poll(
      async () => prisma.reservation.findUnique({
        where: { id: assignedReservationId },
        select: { attendance: true, status: true },
      }),
      { timeout: 30_000 },
    ).toEqual({ attendance: "PRESENT", status: "COMPLETED" });
    await expect(page.getByText("저장됨", { exact: true })).toBeVisible();

    await expectDenied(page, `/classes/${unrelatedClassId}`);
    await expectDenied(page, `/children/${assignedChildId}`);
    await expectDenied(page, `/teachers/${unrelatedTeacherId}`);
    expect((await page.goto(`/teachers/${teacherId}`))?.status()).toBe(200);
    await expectDenied(page, "/accounts");
    await expectDenied(page, "/payments");
    await expectDenied(page, "/revenue");

    await prisma.teacher.update({ where: { id: teacherId }, data: { isActive: false } });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await prisma.teacher.update({ where: { id: teacherId }, data: { isActive: true } });
  });

  test("ADMIN은 계정을 생성·재설정하고 비밀값 없이 append-only 이력을 남긴다", async ({ page }) => {
    const accountEmail = `account-ui-${suffix}@phase16.test`;
    await login(page, ADMIN_EMAIL as string, ADMIN_PASSWORD as string);
    await page.goto("/accounts/new");
    await page.getByLabel("이름 *", { exact: true }).fill(`Phase16 Account UI ${suffix}`);
    await page.getByLabel(/이메일/).fill(accountEmail);
    await page.getByLabel(/역할/).selectOption("MANAGER");
    await page.getByLabel(/임시 비밀번호/).fill(password);
    await page.getByRole("button", { name: "계정 생성" }).click();
    await expect(page).toHaveURL(/\/accounts\/(?!new$)[^/?]+$/);
    await expect(page.getByText("계정 생성", { exact: true })).toBeVisible();

    const created = await prisma.user.findUniqueOrThrow({
      where: { email: accountEmail },
      select: { id: true, password: true, mustChangePassword: true, authVersion: true },
    });
    ids.users.push(created.id);
    expect(created.password).not.toBe(password);
    expect(created.password && await compare(password, created.password)).toBe(true);
    expect(created.mustChangePassword).toBe(true);

    await page.getByLabel("새 임시 비밀번호").fill(resetPassword);
    await page.getByRole("button", { name: "비밀번호 재설정" }).click();
    await expect(page.getByText("임시 비밀번호를 재설정했습니다.")).toBeVisible();
    await expect.poll(async () => prisma.user.findUnique({
      where: { id: created.id },
      select: { authVersion: true },
    })).toEqual({ authVersion: created.authVersion + 1 });
    await page.reload();
    await expect(page.locator("ol").getByText("비밀번호 재설정", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(password);
    expect(await page.content()).not.toContain(resetPassword);
  });

  test("DB role·active·authVersion 변경은 기존 세션의 다음 요청부터 적용되고 로그인 loop가 없다", async ({ page }) => {
    const passwordHash = await hash(password, 4);
    const email = `freshness-${suffix}@phase16.test`;
    const user = await prisma.user.create({
      data: { name: "Phase16 Freshness", email, password: passwordHash, role: "ADMIN" },
    });
    ids.users.push(user.id);

    await login(page, email, password);
    expect((await page.goto("/payments"))?.status()).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { role: "MANAGER" } });
    await expectDenied(page, "/payments");
    expect((await page.goto("/dashboard"))?.status()).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    expect((await page.goto("/payments"))?.status()).toBe(200);

    const transitionTeacher = await prisma.teacher.create({ data: { name: `Phase16 전환 선생님 ${suffix}` } });
    ids.teachers.push(transitionTeacher.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "TEACHER", teacherId: transitionTeacher.id },
    });
    expect((await page.goto(`/teachers/${transitionTeacher.id}`))?.status()).toBe(200);
    await expectDenied(page, "/children");

    await prisma.user.update({ where: { id: user.id }, data: { role: "MANAGER", teacherId: null } });
    expect((await page.goto("/children"))?.status()).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    await resetAccountPasswordCore(
      bootstrapAdminPrincipal,
      user.id,
      await hash(resetPassword, 4),
    );
    await login(page, email, resetPassword, /\/account\/password/);
    await expect(page.getByText(/임시 비밀번호를 변경/)).toBeVisible();
    await page.getByLabel("현재 비밀번호").fill(resetPassword);
    await page.getByLabel("새 비밀번호", { exact: true }).fill(selfPassword);
    await page.getByLabel("새 비밀번호 확인").fill(selfPassword);
    await page.getByRole("button", { name: "비밀번호 변경" }).click();
    await expect(page).toHaveURL(/\/login/);
    await login(page, email, selfPassword);
  });

  test("계정 advisory lock은 마지막 ADMIN과 reset/change 경쟁을 실제 DB에서 보호한다", async () => {
    const passwordHash = await hash(password, 4);
    const existingAdmin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true, isActive: true } });
    const [adminA, adminB, resetTarget] = await Promise.all([
      prisma.user.create({ data: { name: "Phase16 Admin A", email: `admin-a-${suffix}@phase16.test`, password: passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: "Phase16 Admin B", email: `admin-b-${suffix}@phase16.test`, password: passwordHash, role: "ADMIN" } }),
      prisma.user.create({ data: { name: "Phase16 Reset", email: `reset-${suffix}@phase16.test`, password: passwordHash, role: "MANAGER" } }),
    ]);
    ids.users.push(adminA.id, adminB.id, resetTarget.id);
    await prisma.user.update({ where: { id: existingAdmin.id }, data: { isActive: false } });

    const principalA: CurrentPrincipal = { userId: adminA.id, name: adminA.name, email: adminA.email, role: "ADMIN", teacherId: null, authVersion: 1, mustChangePassword: false };
    const principalB: CurrentPrincipal = { userId: adminB.id, name: adminB.name, email: adminB.email, role: "ADMIN", teacherId: null, authVersion: 1, mustChangePassword: false };
    const downgrade = (actor: CurrentPrincipal, target: typeof adminA) => updateAccountCore(actor, target.id, {
      name: target.name,
      email: target.email,
      role: "MANAGER",
      teacherId: null,
      isActive: true,
    });
    const lastAdminResults = await Promise.allSettled([
      downgrade(principalA, adminB),
      downgrade(principalB, adminA),
    ]);
    expect(lastAdminResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);

    const resetHash = await hash(resetPassword, 4);
    const resetPrincipal: CurrentPrincipal = {
      userId: resetTarget.id,
      name: resetTarget.name,
      email: resetTarget.email,
      role: "MANAGER",
      teacherId: null,
      authVersion: 1,
      mustChangePassword: false,
    };
    await Promise.allSettled([
      resetAccountPasswordCore(lastAdminResults[0]?.status === "fulfilled" ? principalA : principalB, resetTarget.id, resetHash),
      changeOwnPasswordCore(resetPrincipal, { currentPassword: password, newPassword: selfPassword, confirmPassword: selfPassword }),
    ]);
    const afterRace = await prisma.user.findUniqueOrThrow({
      where: { id: resetTarget.id },
      select: { password: true, mustChangePassword: true, authVersion: true },
    });
    expect(afterRace.password && await compare(resetPassword, afterRace.password)).toBe(true);
    expect(afterRace.password && await compare(selfPassword, afterRace.password)).toBe(false);
    expect(afterRace.mustChangePassword).toBe(true);
    expect(afterRace.authVersion).toBeGreaterThanOrEqual(2);

    await prisma.user.update({ where: { id: existingAdmin.id }, data: { isActive: existingAdmin.isActive } });
  });
});
