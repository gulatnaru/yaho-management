import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { enterGuardianInformation, enterConsentReview } from "./support/integrated-ux-guardian";
import { assertFamilyLedger } from "./support/integrated-ux-invariants";

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

test("real ADMIN login → class creation/prices → issued link → two children → bank record → selected reservation only", async ({ browser, context, baseURL }) => {
  test.setTimeout(180000);
  test.skip(!process.env.UX_ADMIN_EMAIL || !process.env.UX_ADMIN_PASSWORD, "BLOCKED: runtime synthetic ADMIN credentials from the real account setup are required.");
  test.skip(process.env.UX_SECURE_LOOPBACK_COOKIE_SUPPORTED === "false", "BLOCKED: this browser rejects the app's Secure completion cookie on the required HTTP loopback origin.");
  const db = new PrismaClient();
  const marker = `UXJ_SYNTHETIC_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const adminContext = context;
  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = test.info().project.use;
  const guardianContext = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  let ownsSettings = false;
  let settingsOwner: string | undefined;
  try {
    // Only reference data is inserted. Every class, link, application and bank action below uses the UI.
    const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.UX_ADMIN_EMAIL } });
    settingsOwner = admin.id;
    const program = await db.program.create({ data: { name: marker, defaultPrice: 999999 } });
    const teachers = await Promise.all([0, 1].map((i) => db.teacher.create({ data: { name: `${marker}_${i}` } })));
    expect(await db.reservationApplicationSettings.count()).toBe(0);
    await db.reservationApplicationSettings.create({ data: { id: 1, bankName: "합성은행", accountNumber: "000000", accountHolder: "합성예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao", updatedById: admin.id } });
    ownsSettings = true;
    const page = await adminContext.newPage();
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill(process.env.UX_ADMIN_EMAIL!);
    await page.getByLabel("비밀번호", { exact: true }).fill(process.env.UX_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    const classIds: string[] = [];
    for (const [i, amount] of [40000, 60000].entries()) {
      await page.goto("/classes/new");
      await page.locator("#programId").selectOption(program.id);
      await page.locator("#date").fill(new Date(Date.now() + (20 + i) * 86400000).toISOString().slice(0, 10));
      await page.locator("#startTime").fill("10:00"); await page.locator("#endTime").fill("11:00");
      await page.locator("#location").fill(`합성장소${i}`);
      await page.locator("#applicationPrice").fill(String(amount));
      for (const teacher of teachers) await page.locator(`input[name="teacherIds"][value="${teacher.id}"]`).check();
      await page.getByRole("button", { name: "등록", exact: true }).click();
      // The create page itself is /classes/new: wait for the action's detail redirect.
      await expect(page).toHaveURL((url) => /^\/classes\/[^/]+$/.test(url.pathname) && url.pathname !== "/classes/new");
      classIds.push(new URL(page.url()).pathname.split("/").at(-1)!);
      expect(await db.classSchedule.findUniqueOrThrow({ where: { id: classIds[i] } })).toMatchObject({ programId: program.id, location: `합성장소${i}`, applicationPrice: amount });
    }
    await page.goto("/reservation-applications/groups");
    const composer = page.locator("form").filter({ has: page.getByRole("heading", { name: "여러 클래스 통합 신청", exact: true }) });
    for (const checkbox of await composer.getByRole("checkbox", { name: new RegExp(marker) }).all()) await checkbox.check();
    await expect(composer.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await composer.getByRole("button", { name: "선택한 클래스로 새 링크 발급", exact: true }).click();
    const address = page.getByRole("textbox", { name: "신청 링크 주소", exact: true });
    await expect(address).not.toHaveValue("");
    const link = await address.inputValue();
    expect(new URL(link).origin).toBe(baseURL);
    const guardian = await guardianContext.newPage(); await guardian.goto(link);
    await enterGuardianInformation(guardian);
    await guardian.locator("#application-guardianName").fill(marker);
    await guardian.locator("#application-guardianPhone").fill("010-0000-0000");
    await guardian.locator("#application-declaredPayerName").fill("합성입금자");
    async function child(index: number) {
      await guardian.locator(`#application-child-${index + 1}-childName`).fill(`합성여정자녀${index + 1}`);
      await guardian.locator(`#application-child-${index + 1}-childBirthDate`).fill("2020-01-01");
      await guardian.getByLabel(`아이 ${index + 1} 클래스`, { exact: true }).selectOption(classIds[index]!);
    }
    await child(0); await guardian.getByRole("button", { name: "내 자녀 추가", exact: true }).click(); await child(1);
    await enterConsentReview(guardian);
    for (const checkbox of await guardian.getByRole("group", { name: "필수 확인·동의", exact: true }).getByRole("checkbox").all()) await checkbox.check();
    await guardian.locator("#application-child-1-photoShareConsent").check();
    await expect(guardian.locator("#application-child-2-photoShareConsent")).not.toBeChecked();
    // This spec runs alone with one worker. Global counts also detect orphan financial rows.
    const financeCounts = () => Promise.all([db.payment.count(), db.paymentItem.count(), db.reservation.count()]);
    const financeBeforeSubmit = await financeCounts();
    await guardian.getByRole("button", { name: "신청서 제출", exact: true }).click();
    await expect(guardian).toHaveURL(/\/apply\/complete$/);
    const quote = guardian.getByRole("region", { name: "신청 금액", exact: true });
    for (const amount of ["40,000원", "60,000원", "100,000원"]) await expect(quote).toContainText(amount);
    const family = await db.reservationApplicationSubmission.findFirstOrThrow({ where: { guardianName: marker }, include: { applications: { orderBy: { quotedAmount: "asc" } } } });
    const [first, sibling] = family.applications;
    expect(family.applications).toHaveLength(2);
    expect(first!.photoShareConsentAgreed).toBe(true); expect(sibling!.photoShareConsentAgreed).toBe(false);
    expect(await db.reservation.count({ where: { classScheduleId: { in: classIds } } })).toBe(0);
    expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: classIds } } } } } })).toBe(0);
    expect(await financeCounts()).toEqual(financeBeforeSubmit);
    await assertFamilyLedger(db, family.id, { D: 0, A: 0, P: 0, R: 0, T: 0 });
    async function changePublishedPrice(amount: number) {
      await page.goto(`/classes/${classIds[0]}`);
      const linkCard = page.getByTestId("application-link-card");
      await linkCard.getByRole("spinbutton", { name: "신청금액 설정 (원)", exact: true }).fill(String(amount));
      await linkCard.getByRole("button", { name: "신청금액 저장", exact: true }).click();
      await expect(linkCard.getByRole("status")).toContainText("신청금액을 저장했습니다");
      expect((await db.classSchedule.findUniqueOrThrow({ where: { id: classIds[0] } })).applicationPrice).toBe(amount);
    }
    await changePublishedPrice(45000); await guardian.reload();
    await expect(quote).toContainText("40,000원"); await expect(quote).toContainText("100,000원");
    expect((await db.reservationApplication.findUniqueOrThrow({ where: { id: first!.id } })).quotedAmount).toBe(40000);
    await guardian.getByRole("button", { name: "입금했어요", exact: true }).click();
    await expect(guardian.getByRole("status")).toContainText("입금 알림을 보냈습니다");
    expect((await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: family.id } })).depositNotifiedAt).not.toBeNull();
    expect(await financeCounts()).toEqual(financeBeforeSubmit);
    await assertFamilyLedger(db, family.id, { D: 0, A: 0, P: 0, R: 0, T: 0 });
    // The current family list searches using class/notification/bank/status filters, without a name textbox.
    await page.goto(`/reservation-applications?classScheduleId=${classIds[0]}`);
    await page.getByLabel("보호자 입금 알림", { exact: true }).selectOption("received");
    await page.getByRole("button", { name: "조회", exact: true }).click();
    const card = page.getByTestId("family-application-card").filter({ hasText: marker });
    await expect(card).toHaveCount(1); await card.getByRole("link", { name: "신청 처리하기", exact: true }).click();
    const deposit = page.getByTestId("deposit-transaction-form");
    await deposit.getByRole("button", { name: "새 입금 거래 시작", exact: true }).click();
    await deposit.getByLabel("실제 입금액", { exact: true }).fill("100000");
    await deposit.getByLabel("실제 은행 입금자명", { exact: true }).fill("합성실제입금자");
    await deposit.getByLabel("실제 입금일시 (KST)", { exact: true }).fill("2026-01-01T09:30");
    await deposit.getByRole("button", { name: "실제 입금 기록", exact: true }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    await latest(page);
    const bankLedger = await assertFamilyLedger(db, family.id, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
    expect(bankLedger.deposits).toHaveLength(1); expect(bankLedger.deposits[0]!.confirmedById).toBe(admin.id);
    const selection = page.getByTestId(`confirmation-${first!.id}`);
    await selection.getByRole("checkbox").check(); await selection.getByRole("combobox").selectOption("NEW");
    await expect(page.getByTestId("confirmation-amounts")).toContainText("100,000원");
    await page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click(); await latest(page);
    const after = await db.reservationApplication.findUniqueOrThrow({ where: { id: first!.id }, include: { reservation: { include: { paymentItem: { include: { payment: true } } } }, paymentMapping: true } });
    expect(after).toMatchObject({ status: "CONFIRMED", quotedAmount: 40000, reservation: { classScheduleId: classIds[0], paymentItem: { amount: 40000, paidAmount: 40000, refundedAmount: 0, payment: { totalAmount: 40000, status: "PAID" } } } });
    expect(after.paymentMapping!.paymentItemId).toBe(after.reservation!.paymentItem!.id);
    expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: sibling!.id } })).toEqual(sibling);
    expect(await db.reservation.count({ where: { classScheduleId: { in: classIds } } })).toBe(1);
    await assertFamilyLedger(db, family.id, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
    await page.reload();
    await expect(page.getByTestId(`confirmation-${first!.id}`)).toHaveCount(0);
    expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: first!.id } })).toBe(1);
    await changePublishedPrice(46000);
    expect((await db.reservationApplication.findUniqueOrThrow({ where: { id: first!.id } })).quotedAmount).toBe(40000);
    expect((await db.paymentItem.findUniqueOrThrow({ where: { id: after.reservation!.paymentItem!.id } })).paidAmount).toBe(40000);
    // Preserve the resulting finance records for read-only CI diagnosis; the service database is disposable.
  } finally {
    if (ownsSettings && settingsOwner) await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: settingsOwner, accountNumber: "000000", bankName: "합성은행", accountHolder: "합성예금주" } });
    await guardianContext.close(); await adminContext.close(); await db.$disconnect();
  }
});

async function latest(page: Page) { await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다"); }
