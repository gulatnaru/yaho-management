import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { generateApplicationCapabilityToken, generateApplicationLinkToken, hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { enterGuardianInformation, enterConsentReview } from "./support/integrated-ux-guardian";

// SPEC ONLY in Phase 8 BUILD: NOT EXECUTED. Admission remains local-only, with
// isolated synthetic fixtures and no screenshots, videos or traces (UX config).
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
const owner = `UX8_SYNTHETIC_${randomUUID()}`;
const bank = { bankName: "합성은행", accountNumber: "000000", accountHolder: "합성예금주", blogUrl: "https://example.test/blog", instagramUrl: "https://example.test/instagram", kakaoChannelUrl: "https://example.test/kakao" };
let settingsOwned = false;
let userOwned = false;
let fixture: { program: string; classes: string[]; group: string; token: string; path: string; legacy: boolean };
let ownChild: string | undefined;
async function setup(mode: "single" | "upgrade" | "group" | "companion" | "legacy" = "group") {
  const suffix = randomUUID(), program = `ux8-p-${suffix}`, classes = [0, 1].slice(0, mode === "single" || mode === "upgrade" || mode === "legacy" ? 1 : 2).map((i) => `ux8-c-${suffix}-${i}`);
  const token = mode === "legacy" || mode === "upgrade" ? generateApplicationLinkToken() : generateApplicationCapabilityToken();
  const group = `ux8-g-${suffix}`;
  fixture = { program, classes, group, token, path: `/apply/${mode === "group" || mode === "single" ? "group/" : mode === "companion" ? "companion/" : ""}${token}`, legacy: mode === "legacy" };
  await db.program.create({ data: { id: program, name: "합성 공개 프로그램", defaultPrice: 999999 } });
  await db.classSchedule.createMany({ data: classes.map((id, i) => ({ id, programId: program, startsAt: new Date(Date.now() + (14 + i) * 86400000), endsAt: new Date(Date.now() + (14 + i) * 86400000 + 3600000), location: "합성 공개 장소", applicationPrice: mode === "legacy" ? null : i ? 40000 : 60000, capacity: 8, memo: "비공개 운영 메모" })) });
  if (mode === "legacy") await db.reservationApplicationLink.create({ data: { token, classScheduleId: classes[0], issuedById: owner } });
  else {
    await db.reservationApplicationGroup.create({ data: { id: group, createdById: owner, syntheticRunId: owner, classes: { create: classes.map((classScheduleId) => ({ classScheduleId })) } } });
    if (mode === "companion") {
      const issuer = await db.reservationApplicationSubmission.create({ data: { groupId: group, guardianName: "초대자비공개가족", guardianPhone: "010-9999-9999" } });
      const companion = await db.companionGroup.create({ data: { groupId: group, issuerSubmissionId: issuer.id } });
      await db.companionInvite.create({ data: { groupId: group, issuerSubmissionId: issuer.id, companionGroupId: companion.id, tokenHash: hashApplicationCapabilityToken(token), expiresAt: new Date(Date.now() + 86400000) } });
    } else await db.reservationApplicationLink.create({ data: { groupId: group, tokenHash: hashApplicationCapabilityToken(token), issuedById: owner } });
  }
  return fixture;
}
async function fill(page: Page, index = 0, name = `합성자녀${index + 1}`) {
  await page.locator(`#application-child-${index + 1}-childName`).fill(name);
  await page.locator(`#application-child-${index + 1}-childBirthDate`).fill("2020-01-01");
  if (!fixture.legacy) await page.getByLabel(`아이 ${index + 1} 클래스`, { exact: true }).selectOption(fixture.classes[index % fixture.classes.length]!);
}
async function details(page: Page) {
  await enterGuardianInformation(page);
  await page.getByLabel("보호자 이름").fill("합성보호자"); await page.getByLabel("보호자 연락처").fill("010-0000-0000");
  if (!fixture.legacy) await page.getByLabel("입금할 때 사용할 이름").fill("합성입금자");
  await fill(page);
}
async function required(page: Page) {
  const fields = page.getByRole("group", { name: "필수 확인·동의", exact: true });
  await expect(fields.getByRole("checkbox")).toHaveCount(4);
  for (const box of await fields.getByRole("checkbox").all()) { await expect(box).not.toBeChecked(); await box.check(); }
}
async function applications() { return db.reservationApplication.findMany({ where: { classScheduleId: { in: fixture.classes } }, orderBy: { childName: "asc" } }); }
async function noFinance() {
  expect(await db.reservation.count({ where: { classScheduleId: { in: fixture.classes } } })).toBe(0);
  expect(await db.payment.count({ where: { items: { some: { reservation: { classScheduleId: { in: fixture.classes } } } } } })).toBe(0);
  expect(await db.applicationDeposit.count({ where: { submission: { groupId: fixture.group } } })).toBe(0);
}
async function noBrowserPii(page: Page) {
  expect(page.url()).not.toContain("합성");
  expect(await page.evaluate(() => [localStorage, sessionStorage].every((storage) => Object.keys(storage).every((key) => !storage.getItem(key)?.includes("합성"))))).toBe(true);
}

test.describe("Phase 8 guardian three-step input", () => {
  test.beforeAll(async () => {
    if (await db.reservationApplicationSettings.findUnique({ where: { id: 1 } })) throw new Error("UX8_SETTINGS_REQUIRE_EMPTY_LOCAL_SINGLETON");
    await db.user.create({ data: { id: owner, email: `${owner}@example.test`, name: owner, role: "ADMIN" } }); userOwned = true;
    await db.reservationApplicationSettings.create({ data: { id: 1, ...bank, updatedById: owner } }); settingsOwned = true;
  });
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "wait" });
    if (!fixture) return;
    const devices = await db.deviceSubmission.findMany({ where: { submission: { groupId: fixture.group } }, select: { deviceId: true } });
    await db.companionGroupMember.deleteMany({ where: { companionGroup: { groupId: fixture.group } } });
    await db.companionInvite.deleteMany({ where: { groupId: fixture.group } }); await db.companionGroup.deleteMany({ where: { groupId: fixture.group } });
    await db.deviceSubmission.deleteMany({ where: { submission: { groupId: fixture.group } } });
    await db.reservationApplication.deleteMany({ where: { classScheduleId: { in: fixture.classes } } });
    await db.reservationApplicationSubmission.deleteMany({ where: { groupId: fixture.group } });
    if (ownChild) await db.deviceChild.deleteMany({ where: { childId: ownChild } });
    await db.applicationDevice.deleteMany({ where: { id: { in: devices.map((row) => row.deviceId) } } });
    if (ownChild) await db.child.delete({ where: { id: ownChild } }); ownChild = undefined;
    await db.reservationApplicationLink.deleteMany({ where: { OR: [{ groupId: fixture.group }, { token: fixture.token }] } });
    await db.reservationApplicationGroupClass.deleteMany({ where: { groupId: fixture.group } });
    await db.reservationApplicationGroup.deleteMany({ where: { id: fixture.group } });
    await db.classSchedule.deleteMany({ where: { id: { in: fixture.classes } } }); await db.program.delete({ where: { id: fixture.program } });
  });
  test.afterAll(async () => {
    try { if (settingsOwned) await db.reservationApplicationSettings.deleteMany({ where: { id: 1, updatedById: owner } }); if (userOwned) await db.user.delete({ where: { id: owner } }); } finally { await db.$disconnect(); }
  });

  for (const mode of ["legacy", "single", "upgrade", "group", "companion"] as const) test(`${mode}: exactly three input steps, Enter never saves, optional consent is independent, result is separate`, async ({ page }) => {
    await setup(mode); await page.goto(fixture.path);
    await expect(page.getByText("3단계 중 1단계", { exact: false })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/999,999원|비공개 운영 메모|초대자비공개가족|잔여석|정원 8/);
    if (fixture.legacy) await expect(page.locator("body")).not.toContainText(/참가비|0원/);
    else await expect(page.locator("body")).toContainText("60,000원");
    await details(page); await page.getByLabel("보호자 이름").press("Enter"); expect(await applications()).toHaveLength(0);
    await enterConsentReview(page); await required(page);
    await expect(page.getByRole("group", { name: "선택 동의", exact: true }).getByRole("checkbox")).toHaveCount(2);
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    const submit = page.getByRole("button", { name: "신청서 제출", exact: true }); await submit.focus(); await page.keyboard.press("Enter"); expect(await applications()).toHaveLength(0);
    await noBrowserPii(page); await submit.click(); await expect(page).toHaveURL(/\/apply\/complete$/);
    await expect(page.getByRole("heading", { name: "신청이 접수되었습니다", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "신청서 제출", exact: true })).toHaveCount(0);
    const saved = await applications(); expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ quotedAmount: fixture.legacy ? null : 60000, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false });
    await page.reload(); await noBrowserPii(page); await noFinance(); await page.goBack();
    await expect(page.getByRole("button", { name: "신청서 제출", exact: true })).toHaveCount(0);
  });

  test("middle removal preserves stable fields and optional choices; common consent is reviewed again", async ({ page }) => {
    await setup(); await page.goto(fixture.path); await details(page);
    await page.getByRole("button", { name: "내 자녀 추가" }).click(); await fill(page, 1);
    await page.getByRole("button", { name: "내 자녀 추가" }).click(); await fill(page, 2, "합성셋째"); await enterConsentReview(page); await required(page);
    await page.locator("#application-child-3-photoShareConsent").check(); await page.getByRole("button", { name: "이전", exact: true }).click();
    const middle = page.getByRole("group", { name: "자녀 2 · 합성자녀2", exact: true }); await middle.getByText("이 아이를 신청에서 제외", { exact: true }).click(); await middle.getByRole("button", { name: "이 아이를 현재 초안에서 제외" }).click();
    await expect(page.locator("#application-child-3-childName")).toHaveValue("합성셋째"); await expect(page.locator("#application-child-3-childName")).toBeFocused();
    await enterConsentReview(page); await required(page); await expect(page.locator("#application-child-3-photoShareConsent")).toBeChecked();
    await expect(page.locator("#application-child-1-photoShareConsent")).not.toBeChecked(); expect(await applications()).toHaveLength(0);
  });

  test("100000 to 105000 review, second submit-time change, input/consent preservation and explicit resubmission", async ({ page }) => {
    await setup(); await page.goto(fixture.path); await details(page); await page.getByRole("button", { name: "내 자녀 추가" }).click(); await fill(page, 1);
    await db.classSchedule.update({ where: { id: fixture.classes[0]! }, data: { applicationPrice: 65000 } });
    await enterConsentReview(page); await expect(page.locator("#application-reviewedPriceProof")).toContainText("60,000원 → 65,000원");
    await expect(page.locator("#application-reviewedPriceProof")).toContainText("100,000원 → 105,000원"); await required(page); await page.locator("#application-child-1-photoShareConsent").check();
    const submit = page.getByRole("button", { name: "신청서 제출", exact: true }); await expect(submit).toBeDisabled();
    await page.getByRole("button", { name: "변경 금액 확인", exact: true }).click(); expect(await applications()).toHaveLength(0);
    await db.classSchedule.update({ where: { id: fixture.classes[0]! }, data: { applicationPrice: 70000 } }); await submit.click();
    await expect(page.locator("#application-reviewedPriceProof")).toContainText("65,000원 → 70,000원"); await expect(page.locator("#application-reviewedPriceProof")).toContainText("105,000원 → 110,000원");
    expect(await applications()).toHaveLength(0); await expect(page.locator("#application-programTerms")).toBeChecked(); await expect(page.locator("#application-child-1-photoShareConsent")).toBeChecked();
    await page.getByRole("button", { name: "변경 금액 확인", exact: true }).click(); expect(await applications()).toHaveLength(0); await submit.click(); await expect(page).toHaveURL(/\/apply\/complete$/);
    expect((await applications()).map((row) => row.quotedAmount)).toEqual([70000, 40000]); await noFinance();
  });

  test("field summary opens/focuses the correct child and leaves other input intact", async ({ page }) => {
    await setup(); await page.goto(fixture.path); await details(page); await page.getByRole("button", { name: "내 자녀 추가" }).click(); await fill(page, 1);
    await page.locator("#application-child-2-childBirthDate").fill(""); await page.getByRole("group", { name: "자녀 2 · 합성자녀2", exact: true }).getByRole("button", { name: "자녀 정보 접기" }).click();
    await page.getByRole("button", { name: "다음", exact: true }).click(); await expect(page.locator("#application-child-2-childBirthDate")).toBeFocused();
    await expect(page.getByRole("alert")).toContainText("2단계 자녀 2 (합성자녀2)"); await expect(page.locator("#application-child-1-childName")).toHaveValue("합성자녀1"); await noBrowserPii(page);
  });

  test("transport loss blocks duplicate clicks and never automatically retries the action", async ({ page }) => {
    await setup("single"); await page.goto(fixture.path); await details(page); await enterConsentReview(page); await required(page);
    let writes = 0; await page.route("**/apply/group/**", async (route) => { if (route.request().method() === "POST") { writes++; await route.abort("failed"); } else await route.continue(); });
    await page.getByRole("button", { name: "신청서 제출", exact: true }).dblclick();
    await expect(page.getByText("처리 결과를 확인하지 못했습니다. 신청서를 자동으로 다시 보내지 않습니다.", { exact: true })).toBeVisible();
    expect(writes).toBe(1); await expect(page.getByRole("button", { name: "신청서 제출", exact: true })).toBeDisabled(); expect(await applications()).toHaveLength(0);
  });

  test("revocation hides all prices and clears the active form; BFCache does not revive PII", async ({ page }) => {
    await setup("single"); await page.goto(fixture.path); await details(page);
    await db.reservationApplicationLink.updateMany({ where: { groupId: fixture.group }, data: { isActive: false } }); await page.getByRole("button", { name: "다음", exact: true }).click();
    await expect(page.locator("body")).toContainText("현재 신청을 받지 않는 링크입니다."); await expect(page.locator("body")).not.toContainText("60,000원"); await expect(page.getByLabel("보호자 이름")).toHaveCount(0);
    await page.goto("/apply/complete"); await page.goBack(); await expect(page.getByLabel("보호자 이름")).toHaveCount(0); await noBrowserPii(page); expect(await applications()).toHaveLength(0);
  });

  test("device-owned existing Child stays read-only and friend invitation never grants issuer family data", async ({ page, context, baseURL }) => {
    await setup("companion");
    const child = await db.child.create({ data: { name: "합성기존자녀", birthDate: new Date("2020-01-01"), gender: "FEMALE", guardianName: "합성보호자", guardianPhone: "010-0000-0000" } }); ownChild = child.id;
    const submission = await db.reservationApplicationSubmission.create({ data: { groupId: fixture.group, guardianName: "합성보호자", guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER" } });
    const deviceToken = generateApplicationCapabilityToken(); await db.applicationDevice.create({ data: { tokenHash: hashApplicationCapabilityToken(deviceToken), expiresAt: new Date(Date.now() + 86400000), children: { create: { childId: child.id } }, submissions: { create: { submissionId: submission.id } } } });
    await context.addCookies([{ name: "yaho_application_device", value: deviceToken, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(fixture.path); await enterGuardianInformation(page); await page.getByLabel("아이 1 기존 아이").selectOption(child.id);
    await expect(page.locator("#application-child-1-childName")).toHaveValue(child.name); await expect(page.locator("#application-child-1-childName")).toHaveAttribute("readonly", "");
    await expect(page.locator("#application-child-1-childGender")).toBeDisabled(); await expect(page.locator("body")).not.toContainText("초대자비공개가족");
    await context.clearCookies(); await page.reload(); await enterGuardianInformation(page); await expect(page.getByLabel("아이 1 기존 아이")).toHaveCount(0); await expect(page.locator("#application-child-1-childName")).toHaveValue("");
  });
});
