import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { APPLICATION_CONSENT_CONTENT } from "../../../lib/reservation-applications/consent-content";
import { assertSafeE2eDatabaseUrls } from "./db-safety";

export const recoveryDate = "2026-01-01T09:30";
export const recoveryPayer = "합성 C11 실제 입금자";

/** Called inside each test, never by the suite seed. Creates only the initial
 * synthetic application: all financial/reservation writes must use the browser.
 * Append-only financial history is left for disposal of the CI PG service. */
export async function createRecoveryFamily(db: PrismaClient) {
  if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
  assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
  const actor = await db.user.findUniqueOrThrow({ where: { id: process.env.E2E_UX_ADMIN_ID ?? "" } });
  expect(actor).toMatchObject({ role: "ADMIN", isActive: true, mustChangePassword: false });
  const [version] = await db.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
  expect(Number(version.server_version_num)).toBeGreaterThanOrEqual(160000);
  expect(Number(version.server_version_num)).toBeLessThan(170000);
  const marker = `UX_C11_SYNTHETIC_${randomUUID()}`;
  return db.$transaction(async (tx) => {
    const program = await tx.program.create({ data: { name: marker } });
    const startsAt = new Date(Date.now() + 30 * 86400000);
    const classes = [];
    for (const amount of [40000, 60000]) classes.push(await tx.classSchedule.create({ data: {
      programId: program.id, applicationPrice: amount, capacity: 8, startsAt,
      endsAt: new Date(startsAt.getTime() + 3600000), location: "합성 C11 장소",
    } }));
    const group = await tx.reservationApplicationGroup.create({ data: {
      createdById: actor.id, syntheticRunId: marker,
      classes: { create: classes.map((row) => ({ classScheduleId: row.id })) },
    } });
    const submission = await tx.reservationApplicationSubmission.create({ data: {
      groupId: group.id, guardianName: marker, guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: "합성 신고 입금자",
      applications: { create: classes.map((row, index) => ({
        classScheduleId: row.id, quotedAmount: row.applicationPrice!, childName: `합성 C11 ${index + 1}`,
        childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", requestNote: "합성 C11 원본 요청",
        programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true,
        photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version,
      })) },
    }, include: { applications: { orderBy: { quotedAmount: "asc" } } } });
    return { submissionId: submission.id, firstApplicationId: submission.applications[0].id, secondApplicationId: submission.applications[1].id, marker };
  });
}
export type RecoveryFamily = Awaited<ReturnType<typeof createRecoveryFamily>>;
export const recoveryPath = (fixture: RecoveryFamily) => `/reservation-applications/submissions/${fixture.submissionId}`;

/** Reuses the harness's genuinely authenticated cookie, never the closed page's
 * storage/drafts. Keep the current matrix's device and viewport in fresh contexts. */
export async function freshRecoveryContext(browser: Browser, info: TestInfo) {
  const state = process.env.UX_ADMIN_STORAGE_STATE;
  expect(state, "Real ADMIN auth state from ux-cli auth is required").toBeTruthy();
  const use = info.project.use;
  return browser.newContext({ ...use.contextOptions, storageState: state!, baseURL: use.baseURL,
    viewport: use.viewport, userAgent: use.userAgent, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile, hasTouch: use.hasTouch, locale: use.locale, timezoneId: use.timezoneId,
  });
}

export async function prepareRecoveryDeposit(page: Page, amount: number, depositedAt = recoveryDate) {
  const form = page.getByTestId("deposit-transaction-form");
  await form.getByRole("button", { name: "새 입금 거래 시작", exact: true }).click();
  await expect(form.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
  await form.getByLabel("실제 입금액", { exact: true }).fill(String(amount));
  await form.getByLabel("실제 은행 입금자명", { exact: true }).fill(recoveryPayer);
  await form.getByLabel("실제 입금일시 (KST)", { exact: true }).fill(depositedAt);
  return form.locator('input[name="idempotencyKey"]').inputValue();
}
export async function saveRecoveryDeposit(page: Page, amount: number, depositedAt = recoveryDate) {
  const key = await prepareRecoveryDeposit(page, amount, depositedAt);
  await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
  await expect(page.getByTestId("deposit-transaction-form").getByRole("status")).toContainText("저장 기록 확인됨");
  await expectRecoveryAmounts(page, { D: amount, A: amount, P: 0, R: 0, T: 0 });
  return key;
}
export async function expectRecoveryAmounts(page: Page, values: { D: number; A: number; P: number; R: number; T: number }) {
  for (const [term, amount] of Object.entries(values)) {
    await expect(page.getByTestId("detail-ledger").locator("dl > div")
      .filter({ has: page.locator("dt", { hasText: new RegExp(`^${term} ·`) }) }).locator("dd"))
      .toHaveText(`${amount.toLocaleString("ko-KR")}원`);
  }
}
export async function rejectRecoverySibling(page: Page, db: PrismaClient, fixture: RecoveryFamily) {
  const reason = page.locator(`#${fixture.secondApplicationId}-REJECTED-reason`);
  await reason.fill("합성 C11 둘째 반려");
  page.once("dialog", (dialog) => dialog.accept());
  await reason.locator("..").getByRole("button", { name: "신청 반려", exact: true }).click();
  await expect(reason).toHaveCount(0);
  await expect.poll(() => db.returnObligation.count({ where: { applicationId: fixture.secondApplicationId } })).toBe(1);
  const row = await db.returnObligation.findFirstOrThrow({ where: { applicationId: fixture.secondApplicationId } });
  await expect(page.getByTestId(`return-obligation-${row.id}`).getByTestId("return-obligation-remaining")).toHaveText(`${row.amount.toLocaleString("ko-KR")}원`);
  return row;
}
export async function prepareRecoveryReturn(page: Page, obligationId: string, amount: number, reason: string, returnedAt = recoveryDate) {
  const card = page.getByTestId(`return-obligation-${obligationId}`);
  await card.getByRole("button", { name: "새 반환 거래 시작", exact: true }).click();
  await expect(card.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
  await card.getByLabel("실제 반환 금액", { exact: true }).fill(String(amount));
  await card.getByLabel("실제 반환일시 (KST)", { exact: true }).fill(returnedAt);
  await card.getByLabel("반환 사유", { exact: true }).fill(reason);
  return card.locator('input[name="idempotencyKey"]').inputValue();
}
/** Fresh DB reads, not action return values or the application's ledger query. */
export async function recoverySnapshot(db: PrismaClient, fixture: RecoveryFamily) {
  return db.$transaction(async (tx) => ({
    applications: await tx.reservationApplication.findMany({ where: { submissionId: fixture.submissionId }, orderBy: { id: "asc" } }),
    deposits: await tx.applicationDeposit.findMany({ where: { submissionId: fixture.submissionId }, orderBy: { id: "asc" } }),
    allocations: await tx.fundAllocation.findMany({ where: { deposit: { submissionId: fixture.submissionId } }, orderBy: { id: "asc" } }),
    obligations: await tx.returnObligation.findMany({ where: { submissionId: fixture.submissionId }, orderBy: { id: "asc" } }),
    returns: await tx.applicationReturn.findMany({ where: { returnObligation: { submissionId: fixture.submissionId } }, orderBy: { id: "asc" } }),
    reservations: await tx.reservation.findMany({ where: { classSchedule: { program: { name: fixture.marker } } }, orderBy: { id: "asc" } }),
    items: await tx.paymentItem.findMany({ where: { reservation: { classSchedule: { program: { name: fixture.marker } } } }, orderBy: { id: "asc" } }),
    payments: await tx.payment.findMany({ where: { items: { some: { reservation: { classSchedule: { program: { name: fixture.marker } } } } } }, orderBy: { id: "asc" } }),
    mappings: await tx.reservationApplicationPaymentMapping.findMany({ where: { application: { submissionId: fixture.submissionId } }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}

export async function expectRecoveryDuplicate(page: Page, depositId: string) {
  const error = page.getByTestId("deposit-transaction-form").getByRole("alert");
  await expect(error).toContainText("동일한 신청·금액·입금자명·입금일시의 입금 기록이 있어 새 기록을 저장하지 않았습니다.");
  await expect(error).toContainText(`일치 후보 1건: ${depositId}`);
  await expect(error).toContainText("정상 별도 입금으로 확인되어도 별도 절차가 필요합니다.");
  await expect(page.getByTestId("deposit-transaction-form").getByRole("status")).toHaveCount(0);
}
