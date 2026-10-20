import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// AUTHORING ONLY — NOT EXECUTED in the Phase 5 build. Each writing test requires
// its own operator-provisioned, pristine local synthetic fixture. No automatic seed/reset.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const fixtureSchema = z.object({ submissionId: id, firstApplicationId: id, secondApplicationId: id, marker: z.string().startsWith("UX5_SYNTHETIC_") });
const fixtures = process.env.UX_LEDGER_FIXTURES ? z.record(fixtureSchema).parse(JSON.parse(process.env.UX_LEDGER_FIXTURES)) : {};
const adminState = process.env.UX_ADMIN_STORAGE_STATE;
type Fixture = z.infer<typeof fixtureSchema>;
const date = "2026-01-01T09:30";
async function pristine(db: PrismaClient, fixture: Fixture) {
  const submission = await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: fixture.submissionId }, include: { applications: { orderBy: { quotedAmount: "asc" }, include: { classSchedule: { include: { program: true } } } }, deposits: true, returnObligations: true } });
  expect(submission.guardianName).toBe(fixture.marker); expect(submission.deposits).toHaveLength(0); expect(submission.returnObligations).toHaveLength(0);
  expect(submission.applications.map((row) => [row.id, row.quotedAmount, row.status])).toEqual([[fixture.firstApplicationId, 40000, "SUBMITTED"], [fixture.secondApplicationId, 60000, "SUBMITTED"]]);
  expect(submission.applications.every((row) => row.classSchedule.program.name === fixture.marker)).toBe(true);
}
async function deposit(page: Page, amount: number) {
  const root = page.getByTestId("deposit-transaction-form");
  await root.getByRole("button", { name: "새 입금 거래 시작", exact: true }).click();
  await root.getByLabel("실제 입금액", { exact: true }).fill(String(amount));
  await root.getByLabel("실제 은행 입금자명", { exact: true }).fill("합성 실제 입금자 (신고명과 다름)");
  await root.getByLabel("실제 입금일시 (KST)", { exact: true }).fill(date);
  const key = await root.locator('input[name="idempotencyKey"]').inputValue();
  await root.getByRole("button", { name: "실제 입금 기록", exact: true }).click(); return key;
}
async function latest(page: Page) { await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다"); }
async function amounts(page: Page, expected: { D: number; A: number; R: number; T: number }) {
  const ledger = page.getByTestId("detail-ledger");
  for (const [term, amount] of Object.entries({ Q: 100000, P: 0, ...expected })) {
    await expect(ledger.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term} ·`) }) }).locator("dd")).toHaveText(amount.toLocaleString("ko-KR") + "원");
  }
  expect(expected.D).toBe(expected.A + expected.R + expected.T);
}
async function noConfirmedMoney(db: PrismaClient, fixture: Fixture) {
  const where = { classSchedule: { program: { name: fixture.marker } } };
  expect(await db.reservation.count({ where })).toBe(0);
  expect(await db.paymentItem.count({ where: { reservation: where } })).toBe(0);
  expect(await db.refund.count({ where: { paymentItem: { reservation: where } } })).toBe(0);
  // Revenue has no pre-confirmation PaymentItem source.
}

test.describe("Phase 5 same-page bank/return ledger", () => {
  test.use({ storageState: adminState });
  for (const width of [360, 390, 1280]) {
    test(`${width}px family 40000/60000 → 30000+70000 → reject → partial return, both entry points agree`, async ({ page }) => {
      const fixture = fixtures[String(width)]; test.skip(!fixture || !adminState, "Requires a dedicated pristine local synthetic fixture and ADMIN state.");
      const db = new PrismaClient();
      try {
        await pristine(db, fixture!); await page.setViewportSize({ width, height: 900 });
        await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
        const siblingReason = page.locator(`#${fixture!.firstApplicationId}-REJECTED-reason`);
        await siblingReason.fill("처리하지 않은 첫째 초안");
        const firstKey = await deposit(page, 30000); await latest(page); await amounts(page, { D: 30000, A: 30000, R: 0, T: 0 });
        expect(await page.getByTestId("deposit-transaction-form").locator('input[name="idempotencyKey"]').inputValue()).toBe(firstKey);
        const secondKey = await deposit(page, 70000); expect(secondKey).not.toBe(firstKey); await latest(page);
        await amounts(page, { D: 100000, A: 100000, R: 0, T: 0 }); await expect(siblingReason).toHaveValue("처리하지 않은 첫째 초안");
        const secondReason = page.locator(`#${fixture!.secondApplicationId}-REJECTED-reason`); await secondReason.fill("합성 둘째 운영 반려");
        page.once("dialog", (dialog) => dialog.accept()); await secondReason.locator("..").getByRole("button", { name: "신청 반려", exact: true }).click();
        await latest(page); await expect(page).toHaveURL(new RegExp(`/submissions/${fixture!.submissionId}$`));
        await amounts(page, { D: 100000, A: 40000, R: 60000, T: 0 }); await expect(siblingReason).toHaveValue("처리하지 않은 첫째 초안");
        const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: fixture!.secondApplicationId } });
        const card = page.getByTestId(`return-obligation-${obligation.id}`);
        await card.getByRole("button", { name: "새 반환 거래 시작", exact: true }).click();
        await card.getByLabel("실제 반환 금액", { exact: true }).fill("20000"); await card.getByLabel("실제 반환일시 (KST)").fill(date); await card.getByLabel("반환 사유", { exact: true }).fill("합성 부분 반환");
        await card.getByRole("button", { name: "반환 이체 기록", exact: true }).click(); await latest(page);
        await amounts(page, { D: 100000, A: 40000, R: 40000, T: 20000 }); await noConfirmedMoney(db, fixture!);
        await expect(siblingReason).toHaveValue("처리하지 않은 첫째 초안"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByRole("link", { name: "전체 반환 대상 보기", exact: true }).click();
        const workbench = page.getByTestId(`return-obligation-${obligation.id}`); await expect(workbench.getByTestId("return-obligation-remaining")).toHaveText("40,000원");
        await workbench.getByText(/반환 내역 펼치기/).click(); await expect(workbench).toContainText("합성 부분 반환");
        await workbench.getByRole("button", { name: "새 반환 거래 시작", exact: true }).click();
        await workbench.getByLabel("실제 반환 금액", { exact: true }).fill("10000"); await workbench.getByLabel("실제 반환일시 (KST)").fill(date); await workbench.getByLabel("반환 사유", { exact: true }).fill("합성 전체 화면 반환");
        await workbench.getByRole("button", { name: "반환 이체 기록", exact: true }).click(); await expect(workbench.getByTestId("return-obligation-remaining")).toHaveText("30,000원");
        await workbench.getByRole("link", { name: "가족 신청 상세", exact: true }).click(); await amounts(page, { D: 100000, A: 40000, R: 30000, T: 30000 });
        expect(await db.applicationReturn.count({ where: { returnObligationId: obligation.id } })).toBe(2); await noConfirmedMoney(db, fixture!);
      } finally { await db.$disconnect(); }
    });
  }
  test("lost save response freezes the original transaction; lookup recovers without duplicate execution", async ({ page }) => {
    const fixture = fixtures.loss; test.skip(!fixture || !adminState, "Requires its own pristine local response-loss fixture.");
    const db = new PrismaClient(); let posts = 0;
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      await page.route(`**/reservation-applications/submissions/${fixture!.submissionId}`, async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"] && ++posts === 2) { await route.fetch(); await route.abort("failed"); }
        else await route.continue();
      });
      const key = await deposit(page, 30000); await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확");
      const root = page.getByTestId("deposit-transaction-form"); await expect(root.getByLabel("실제 입금액", { exact: true })).toHaveAttribute("readonly", "");
      await expect(page.getByTestId("family-confirmation").getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
      expect(await root.locator('input[name="idempotencyKey"]').inputValue()).toBe(key);
      await root.getByRole("button", { name: "저장 결과 조회", exact: true }).click(); await latest(page);
      expect(await db.applicationDeposit.count({ where: { submissionId: fixture!.submissionId, idempotencyKey: key } })).toBe(1); await noConfirmedMoney(db, fixture!);
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });
  test("save followed by failed authoritative read hides balances and blocks stale confirmation until lookup succeeds", async ({ page }) => {
    const fixture = fixtures.refresh; test.skip(!fixture || !adminState, "Requires its own pristine local refresh-failure fixture.");
    const db = new PrismaClient(); let posts = 0; let failReads = true;
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      await page.route(`**/reservation-applications/submissions/${fixture!.submissionId}`, async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"] && ++posts >= 3 && failReads) await route.abort("failed");
        else await route.continue();
      });
      const key = await deposit(page, 30000); await expect(page.getByTestId("workflow-status")).toContainText("갱신 실패");
      await expect(page.getByTestId("detail-ledger")).toContainText("최신 원장 금액을 표시할 수 없습니다");
      await expect(page.getByTestId("family-confirmation").getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
      const root = page.getByTestId("deposit-transaction-form"); expect(await root.locator('input[name="idempotencyKey"]').inputValue()).toBe(key);
      failReads = false; await page.getByRole("button", { name: "최신 서버 상태 다시 조회", exact: true }).click();
      await amounts(page, { D: 30000, A: 30000, R: 0, T: 0 }); expect(await db.applicationDeposit.count({ where: { submissionId: fixture!.submissionId } })).toBe(1);
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });
});
for (const role of ["MANAGER", "TEACHER"] as const) {
  test.describe(`Phase 5 ${role} financial denial`, () => {
    const state = process.env[`UX_${role}_STORAGE_STATE`]; test.use({ storageState: state });
    test("family and whole-return HTML/RSC disclose no ledger or family marker", async ({ page }) => {
      const fixture = fixtures["1280"]; test.skip(!fixture || !state, "Requires synthetic fixture and role state.");
      for (const path of [`/reservation-applications/submissions/${fixture!.submissionId}`, "/reservation-applications/returns"]) {
        const response = await page.goto(path); expect(response?.status()).toBe(404); expect(await response!.text()).not.toContain(fixture!.marker);
        const rsc = await page.request.get(path, { headers: { RSC: "1" } }); expect(await rsc.text()).not.toContain(fixture!.marker);
        await expect(page.getByTestId("deposit-transaction-form")).toHaveCount(0); await expect(page.getByTestId("detail-ledger")).toHaveCount(0);
      }
    });
  });
}
