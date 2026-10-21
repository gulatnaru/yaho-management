import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { COMPLETION_COOKIE_NAME } from "@/lib/reservation-applications/completion";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { enterGuardianInformation, enterConsentReview } from "./support/integrated-ux-guardian";

// Self-owned synthetic fixtures only. Run with playwright.ux.config.ts against its
// dedicated loopback DB, migrated beforehand, and an EMPTY settings singleton.
// Refuse an existing singleton rather than changing another run's configuration.
// Config disables screenshots/traces/video; clipboard probes stay in page memory.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const owner = `UX7_SYNTHETIC_${randomUUID()}`;
const bank = { bankName: "합성 테스트 은행", accountNumber: "000000000000000000000000000000000000000000000000000000000000", accountHolder: "합성테스트예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" };
const payer = "합성입금자이름이길어도모바일에서줄바꿈되는지확인합니다";
const childNames = ["합성첫째", "합성둘째"];
let ids: { program: string; schedule: string; group: string; submission: string };
let capability: string;
let settingsOwned = false;
let userOwned = false;

async function setCapability(context: BrowserContext, baseURL: string, value = capability) {
  await context.addCookies([{ name: COMPLETION_COOKIE_NAME, value, url: `${baseURL}/apply`, httpOnly: true, sameSite: "Lax" }]);
}
async function open(page: Page) {
  const response = await page.goto("/apply/complete");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "신청이 접수되었습니다", exact: true })).toBeVisible();
}
async function noFinance() {
  const [applications, deposits, reservations, mappings, payments, refunds] = await Promise.all([
    db.reservationApplication.findMany({ where: { submissionId: ids.submission }, select: { quotedAmount: true, status: true, depositConfirmedAt: true } }),
    db.applicationDeposit.count({ where: { submissionId: ids.submission } }),
    db.reservation.count({ where: { classScheduleId: ids.schedule } }),
    db.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: ids.submission } } }),
    db.payment.count({ where: { items: { some: { reservation: { classScheduleId: ids.schedule } } } } }),
    db.refund.count({ where: { paymentItem: { reservation: { classScheduleId: ids.schedule } } } }),
  ]);
  expect(applications.map((item) => item.quotedAmount).sort()).toEqual([22000, 33000]);
  expect(applications.every((item) => item.status === "SUBMITTED" && item.depositConfirmedAt === null)).toBe(true);
  expect([deposits, reservations, mappings, payments, refunds]).toEqual([0, 0, 0, 0, 0]);
}
async function createInvitation(page: Page) {
  await page.getByRole("button", { name: "초대 링크 만들기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "초대 링크 복사 값", exact: true })).toBeVisible();
}

test.describe("Phase 7 public completion presentation", () => {
  test.beforeAll(async () => {
    if (await db.reservationApplicationSettings.findUnique({ where: { id: 1 }, select: { id: true } })) throw new Error("UX7_SETTINGS_ALREADY_EXIST_REQUIRES_EMPTY_LOCAL_SINGLETON");
    await db.user.create({ data: { id: owner, email: `${owner}@example.test`, name: owner, role: "ADMIN" } }); userOwned = true;
    await db.reservationApplicationSettings.create({ data: { id: 1, ...bank, updatedById: owner } }); settingsOwned = true;
  });
  test.beforeEach(async ({ context, baseURL }) => {
    const suffix = randomUUID(); capability = randomUUID();
    ids = { program: `ux7-program-${suffix}`, schedule: `ux7-class-${suffix}`, group: `ux7-group-${suffix}`, submission: `ux7-submission-${suffix}` };
    await db.program.create({ data: { id: ids.program, name: owner, defaultPrice: 999999 } });
    await db.classSchedule.create({ data: { id: ids.schedule, programId: ids.program, startsAt: new Date(Date.now() + 14 * 86400000), endsAt: new Date(Date.now() + 14 * 86400000 + 3600000), location: "합성 테스트 장소", applicationPrice: 777777 } });
    await db.reservationApplicationGroup.create({ data: { id: ids.group, createdById: owner, syntheticRunId: owner, classes: { create: { classScheduleId: ids.schedule } } } });
    await db.reservationApplicationSubmission.create({ data: {
      id: ids.submission, groupId: ids.group, guardianName: owner, guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: payer,
      completionTokenHash: hashApplicationCapabilityToken(capability), completionExpiresAt: new Date(Date.now() + 1800000),
      applications: { create: childNames.map((childName, index) => ({ classScheduleId: ids.schedule, quotedAmount: index ? 33000 : 22000, childName, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: "UX7-synthetic" })) },
    } });
    await setCapability(context, baseURL!);
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "wait" });
    if (!ids) return;
    const devices = await db.deviceSubmission.findMany({ where: { submission: { groupId: ids.group } }, select: { deviceId: true } });
    await db.companionInvite.deleteMany({ where: { groupId: ids.group } });
    await db.companionGroup.deleteMany({ where: { groupId: ids.group } });
    await db.reservationApplication.deleteMany({ where: { submission: { groupId: ids.group } } });
    await db.reservationApplicationSubmission.deleteMany({ where: { groupId: ids.group } });
    await db.applicationDevice.deleteMany({ where: { id: { in: devices.map((item) => item.deviceId) } } });
    await db.reservationApplicationLink.deleteMany({ where: { groupId: ids.group, issuedById: owner } });
    await db.reservationApplicationGroupClass.deleteMany({ where: { groupId: ids.group } });
    await db.reservationApplicationGroup.deleteMany({ where: { id: ids.group, createdById: owner } });
    await db.classSchedule.deleteMany({ where: { id: ids.schedule, programId: ids.program } });
    await db.program.deleteMany({ where: { id: ids.program, name: owner } });
  });
  test.afterAll(async () => {
    try {
      if (settingsOwned) await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: owner } });
      if (userOwned) await db.user.deleteMany({ where: { id: owner, name: owner } });
    } finally { await db.$disconnect(); }
  });

  test("saved quotes, transfer guidance and secondary invitation wrap at every configured viewport", async ({ page, context }) => {
    const before = (await context.cookies()).find((cookie) => cookie.name === COMPLETION_COOKIE_NAME);
    await open(page);
    await expect(page.getByText("아직 예약이 확정된 것은 아닙니다. 입금과 운영자 확인 후 예약이 확정됩니다.", { exact: true })).toBeVisible();
    const amounts = page.getByRole("region", { name: "신청 금액", exact: true });
    for (const value of [...childNames, "22,000원", "33,000원", "55,000원"]) await expect(amounts).toContainText(value);
    await expect(page.getByText("777,777원", { exact: true })).toHaveCount(0); await expect(page.getByText("999,999원", { exact: true })).toHaveCount(0);
    const deposit = page.getByRole("region", { name: "무통장 입금 안내", exact: true });
    await expect(deposit.getByRole("textbox", { name: "계좌번호 복사 값", exact: true })).toHaveValue(bank.accountNumber);
    await expect(deposit.getByRole("textbox", { name: "입금자명 복사 값", exact: true })).toHaveValue(payer);
    await expect(deposit).toContainText("안내된 금액 송금 → 입금했어요 → 운영자 실제 입금 확인 → 예약 확정");
    const invitation = page.getByRole("region", { name: "친구 보호자 초대", exact: true });
    expect((await invitation.boundingBox())!.y).toBeGreaterThan((await deposit.boundingBox())!.y);
    await expect(invitation).toContainText("초대받은 보호자는 본인의 정보를 직접 입력하고 필요한 동의를 진행합니다.");
    for (const button of await page.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload(); await expect(amounts).toContainText("55,000원");
    const after = (await context.cookies()).find((cookie) => cookie.name === COMPLETION_COOKIE_NAME);
    expect(after?.value === before?.value).toBe(true); expect(after?.httpOnly).toBe(true);
    await noFinance();
  });

  test("copy uses exact values and target-specific announcements without additional writes", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as typeof window & { copied?: string }).copied = value; } } }));
    await open(page); await createInvitation(page);
    for (const [button, message, value] of [["계좌번호 복사", "계좌번호를 복사했습니다.", bank.accountNumber], ["입금액 복사", "입금액을 복사했습니다.", "55000"], ["입금자명 복사", "입금자명을 복사했습니다.", payer]] as const) {
      await page.getByRole("button", { name: button, exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
      expect(await page.evaluate((expected) => (window as typeof window & { copied?: string }).copied === expected, value)).toBe(true);
    }
    const invitation = page.getByRole("textbox", { name: "초대 링크 복사 값", exact: true });
    await page.getByRole("button", { name: "초대 링크 복사", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "초대 링크를 복사했습니다." })).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { copied?: string }).copied === (document.querySelector('textarea[aria-label="초대 링크 복사 값"]') as HTMLTextAreaElement).value)).toBe(true);
    await expect(invitation).toHaveValue(/\/apply\/companion\//);
    expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission } })).toBe(1);
    await noFinance();
  });

  for (const clipboard of ["denied", "unsupported"] as const) test(`${clipboard} clipboard offers keyboard/mobile manual selection and never reports success`, async ({ page }) => {
    await page.addInitScript((mode) => Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "unsupported" ? undefined : { writeText: async () => { throw new DOMException("Synthetic denial", "NotAllowedError"); } } }), clipboard);
    await open(page); await page.getByRole("button", { name: "계좌번호 복사", exact: true }).click();
    await expect(page.getByRole("region", { name: "무통장 입금 안내", exact: true }).getByRole("alert")).toHaveText("복사하지 못했습니다. 직접 선택해서 복사해 주세요.");
    await expect(page.getByRole("status")).toHaveCount(0);
    const value = page.getByRole("textbox", { name: "계좌번호 복사 값", exact: true });
    await value.focus(); await expect(value).toHaveAttribute("readonly", "");
    expect(await value.evaluate((element: HTMLTextAreaElement) => element.selectionStart === 0 && element.selectionEnd === element.value.length)).toBe(true);
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Shift+ArrowRight");
    expect(await value.evaluate((element: HTMLTextAreaElement) => element.selectionEnd > element.selectionStart)).toBe(true);
    if (test.info().project.use.hasTouch) { await value.tap(); await expect(value).toBeFocused(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await noFinance();
  });

  test("notification records only its first timestamp and survives refresh without financial changes", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "입금했어요", exact: true }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    await expect(page.getByRole("status")).toHaveText("입금 알림을 보냈습니다. 운영자 확인을 기다려주세요.");
    const first = await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: ids.submission }, select: { depositNotifiedAt: true } });
    expect(first.depositNotifiedAt).not.toBeNull();
    await page.reload(); await expect(page.getByRole("status")).toHaveText("입금 알림을 보냈습니다. 운영자 확인을 기다려주세요.");
    await expect(page.getByRole("button", { name: "입금했어요", exact: true })).toHaveCount(0);
    expect((await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: ids.submission } })).depositNotifiedAt).toEqual(first.depositNotifiedAt);
    await noFinance();
  });

  test("lost notification response remains uncertain and refresh reconciles the recorded timestamp", async ({ page }) => {
    await open(page); let intercepted = false;
    await page.route("**/apply/complete", async (route) => {
      if (!intercepted && route.request().method() === "POST" && route.request().headers()["next-action"]) { intercepted = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await page.getByRole("button", { name: "입금했어요", exact: true }).click();
    await expect(page.getByRole("region", { name: "무통장 입금 안내", exact: true }).getByRole("alert")).toContainText("처리 결과를 확인하지 못했습니다");
    await expect(page.getByText("입금 알림을 보냈습니다. 운영자 확인을 기다려주세요.", { exact: true })).toHaveCount(0);
    await page.unrouteAll({ behavior: "wait" }); await page.reload();
    await expect(page.getByRole("status")).toHaveText("입금 알림을 보냈습니다. 운영자 확인을 기다려주세요."); await noFinance();
  });

  test("invite creation and cancellation resist double clicks; cancel failure retains its address", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "초대 링크 만들기", exact: true }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    const value = page.getByRole("textbox", { name: "초대 링크 복사 값", exact: true }); await expect(value).toBeVisible();
    const cancelledAddress = await value.inputValue();
    expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission } })).toBe(1);
    await expect(page.getByRole("button", { name: "초대 링크 만들기", exact: true })).toHaveCount(0);
    const inviteRegion = page.getByRole("region", { name: "친구 보호자 초대", exact: true });
    const original = await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: ids.submission }, select: { completionExpiresAt: true } });
    // A known refusal and a lost response have different safety contracts. Expire
    // only this test's capability so the real UI action definitively refuses it.
    try {
      await db.reservationApplicationSubmission.update({ where: { id: ids.submission }, data: { completionExpiresAt: new Date(Date.now() - 1000) } });
      await page.getByRole("button", { name: "초대 취소", exact: true }).click();
      await expect(inviteRegion.getByRole("alert")).toHaveText("초대 링크 취소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      await expect(value).toBeVisible();
      expect((await value.inputValue()) === cancelledAddress).toBe(true);
      expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission, revokedAt: null } })).toBe(1);
    } finally {
      await db.reservationApplicationSubmission.update({ where: { id: ids.submission }, data: { completionExpiresAt: original.completionExpiresAt } });
    }
    await page.route("**/apply/complete", (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue());
    await page.getByRole("button", { name: "초대 취소", exact: true }).click();
    await expect(inviteRegion.getByRole("alert")).toHaveText("취소 결과를 확인하기 전에는 기존 초대 주소를 다시 공유하지 마세요. 이미 취소됐을 수 있습니다.");
    await expect(value).toHaveCount(0);
    await expect(inviteRegion.getByRole("button", { name: "초대 링크 복사", exact: true })).toHaveCount(0);
    await expect(inviteRegion.getByRole("button", { name: "초대 링크 만들기", exact: true })).toHaveCount(0);
    expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission, revokedAt: null } })).toBe(1);
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: "초대 취소", exact: true }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
    await expect(page.getByRole("status")).toHaveText("친구 보호자 초대 링크를 취소했습니다."); await expect(value).toHaveCount(0);
    expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission, revokedAt: { not: null } } })).toBe(1);
    await page.goto(cancelledAddress); await expect(page.locator("body")).toContainText("현재 신청을 받지 않는 링크입니다.");
    await expect(page.getByLabel("보호자 이름", { exact: true })).toHaveCount(0); await noFinance();
  });

  for (const kind of ["legacy", "invalid", "expired"] as const) test(`${kind} completion retains generic account/channels and never exposes family details`, async ({ page, context, baseURL }) => {
    if (kind === "legacy") await context.clearCookies();
    if (kind === "invalid") await setCapability(context, baseURL!, randomUUID());
    if (kind === "expired") await db.reservationApplicationSubmission.update({ where: { id: ids.submission }, data: { completionExpiresAt: new Date(Date.now() - 1000) } });
    await open(page);
    for (const value of [bank.bankName, bank.accountNumber, bank.accountHolder]) await expect(page.getByText(value, { exact: true })).toBeVisible();
    for (const value of [...childNames, payer, "55,000원"]) await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    for (const [label, href] of [["YAHO 블로그", bank.blogUrl], ["YAHO Instagram", bank.instagramUrl], ["YAHO 카카오톡 채널", bank.kakaoChannelUrl]]) {
      const link = page.getByRole("link", { name: label, exact: true }); await expect(link).toHaveAttribute("href", href); await expect(link).toHaveAttribute("target", "_blank"); await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("all completion mutations and copy buttons are disabled without hydration", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await setCapability(context, baseURL!); const page = await context.newPage(); await open(page);
      for (const button of await page.getByRole("button").all()) await expect(button).toBeDisabled();
      await expect(page.getByRole("textbox", { name: "계좌번호 복사 값", exact: true })).toHaveValue(bank.accountNumber);
      expect(await db.companionInvite.count({ where: { issuerSubmissionId: ids.submission } })).toBe(0); await noFinance();
    } finally { await context.close(); }
  });

  test("successful submission replaces the document; reload and back do not restore inputs or resubmit", async ({ page, context }) => {
    test.skip(process.env.UX_SECURE_LOOPBACK_COOKIE_SUPPORTED === "false", "BLOCKED: this browser rejects the app's Secure completion cookie on the required HTTP loopback origin.");
    const linkToken = randomUUID();
    await db.reservationApplicationLink.create({ data: { groupId: ids.group, tokenHash: hashApplicationCapabilityToken(linkToken), issuedById: owner } });
    // The earlier safe completion entry lets Back exercise actual history after replacement.
    await open(page); await page.goto(`/apply/group/${linkToken}`);
    await enterGuardianInformation(page);
    await page.locator("#application-guardianName").fill("합성새신청보호자");
    await page.locator("#application-guardianPhone").fill("010-0000-0000");
    await page.locator("#application-declaredPayerName").fill("합성새입금자");
    await page.locator("#application-child-1-childName").fill("합성새신청아이");
    await page.locator("#application-child-1-childBirthDate").fill("2020-01-01");
    await page.getByLabel("아이 1 클래스", { exact: true }).selectOption(ids.schedule);
    await enterConsentReview(page);
    for (const checkbox of await page.getByRole("group", { name: "필수 확인·동의", exact: true }).getByRole("checkbox").all()) await checkbox.check();
    let fullDocumentCompletion = false;
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/apply/complete" && request.isNavigationRequest()) fullDocumentCompletion = true;
    });
    await page.getByRole("button", { name: "신청서 제출", exact: true }).click();
    await expect(page.getByRole("heading", { name: "신청이 접수되었습니다", exact: true })).toBeVisible();
    expect(fullDocumentCompletion).toBe(true);
    const completionCookie = (await context.cookies()).find((cookie) => cookie.name === COMPLETION_COOKIE_NAME);
    expect(completionCookie?.httpOnly).toBe(true); expect(completionCookie?.secure).toBe(true); expect(completionCookie?.path).toBe("/apply");
    await page.reload(); await page.goBack();
    await expect(page.getByRole("heading", { name: "신청이 접수되었습니다", exact: true })).toBeVisible();
    await expect(page.getByLabel("보호자 이름", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "신청서 제출", exact: true })).toHaveCount(0);
    expect(await db.reservationApplicationSubmission.count({ where: { groupId: ids.group } })).toBe(2);
    await noFinance();
  });

  test("expired companion capability exposes no issuer family or input form", async ({ page }) => {
    // Expiry is a fixture condition, not a replacement for a guardian action.
    const token = randomUUID();
    const companion = await db.companionGroup.create({ data: { groupId: ids.group, issuerSubmissionId: ids.submission } });
    await db.companionInvite.create({ data: { groupId: ids.group, issuerSubmissionId: ids.submission, companionGroupId: companion.id, tokenHash: hashApplicationCapabilityToken(token), expiresAt: new Date(Date.now() - 1000) } });
    await page.goto(`/apply/companion/${token}`);
    await expect(page.locator("body")).toContainText("현재 신청을 받지 않는 링크입니다.");
    for (const value of [...childNames, payer]) await expect(page.locator("body")).not.toContainText(value);
    await expect(page.getByLabel("보호자 이름", { exact: true })).toHaveCount(0); await noFinance();
  });
});
