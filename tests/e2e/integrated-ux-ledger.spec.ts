import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { assertFamilyLedger } from "./support/integrated-ux-invariants";
import { applicationPrivateValues, assertApplicationNotFound } from "./support/application-denial";
import { createRecoveryFamily, expectRecoveryAmounts, expectRecoveryDuplicate, freshRecoveryContext, prepareRecoveryDeposit, prepareRecoveryReturn, recoveryPath, recoverySnapshot, rejectRecoverySibling, saveRecoveryDeposit } from "./support/c11-recovery";

// Each writing test requires its own pristine synthetic fixture, supplied by the
// CI fixture runner. Admission never accepts a Preview or Production database.
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
async function deposit(page: Page, amount: number, prepareDraft?: () => Promise<void>) {
  const root = page.getByTestId("deposit-transaction-form");
  await root.getByRole("button", { name: "새 입금 거래 시작", exact: true }).click();
  // The generated key proves the client coordinator has hydrated before editing drafts.
  await expect(root.locator('input[name="idempotencyKey"]')).not.toHaveValue("");
  await prepareDraft?.();
  await root.getByLabel("실제 입금액", { exact: true }).fill(String(amount));
  await root.getByLabel("실제 은행 입금자명", { exact: true }).fill("합성 실제 입금자 (신고명과 다름)");
  await root.getByLabel("실제 입금일시 (KST)", { exact: true }).fill(date);
  const key = await root.locator('input[name="idempotencyKey"]').inputValue();
  await root.getByRole("button", { name: "실제 입금 기록", exact: true }).click(); return key;
}
async function latest(page: Page) { await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다"); }
async function amounts(page: Page, expected: { D: number; A: number; P?: number; R: number; T: number }) {
  const ledger = page.getByTestId("detail-ledger");
  for (const [term, amount] of Object.entries({ Q: 100000, P: 0, ...expected })) {
    await expect(ledger.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term} ·`) }) }).locator("dd")).toHaveText(amount.toLocaleString("ko-KR") + "원");
  }
  expect(expected.D).toBe(expected.A + (expected.P ?? 0) + expected.R + expected.T);
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
        const firstKey = await deposit(page, 30000, async () => {
          await siblingReason.fill("처리하지 않은 첫째 초안");
          await expect(siblingReason).toHaveValue("처리하지 않은 첫째 초안");
        }); await latest(page); await amounts(page, { D: 30000, A: 30000, R: 0, T: 0 });
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
    const db = new PrismaClient(); let posts = 0; let failedReads = 0; let failReads = true;
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      await page.route(`**/reservation-applications/submissions/${fixture!.submissionId}`, async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"] && ++posts >= 3 && failReads) { failedReads++; await route.abort("failed"); }
        else await route.continue();
      });
      const key = await deposit(page, 30000); await expect(page.getByTestId("workflow-status")).toContainText("갱신 실패");
      await expect(page.getByTestId("detail-ledger")).toContainText("최신 원장 금액을 표시할 수 없습니다");
      await expect(page.getByTestId("family-confirmation").getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
      const root = page.getByTestId("deposit-transaction-form"); expect(await root.locator('input[name="idempotencyKey"]').inputValue()).toBe(key);
      // The first failed read shows its alert before run()'s finally can issue
      // another read for changed RSC props. Keep that read failing too; otherwise
      // it can recover automatically and remove the still-disabled retry button.
      await expect(root.getByRole("status")).toContainText("저장 기록 확인됨");
      await expect(root.getByLabel("실제 입금액", { exact: true })).toHaveAttribute("readonly", "");
      const retry = page.getByRole("button", { name: "최신 서버 상태 다시 조회", exact: true });
      await expect(retry).toBeEnabled();
      expect(await root.locator('input[name="idempotencyKey"]').inputValue()).toBe(key);
      expect(posts).toBeGreaterThanOrEqual(3); expect(failedReads).toBeGreaterThan(0);
      failReads = false; await retry.click({ timeout: 15000 });
      await amounts(page, { D: 30000, A: 30000, R: 0, T: 0 }); expect(await db.applicationDeposit.count({ where: { submissionId: fixture!.submissionId } })).toBe(1);
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });

  test("guardian cancellation reserves return money; confirmation cannot spend it and a partial return never increases available amount", async ({ page }) => {
    const fixture = fixtures.cancel; test.skip(!fixture || !adminState, "BLOCKED: dedicated cancellation family and ADMIN state required."); const db = new PrismaClient();
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      const depositForm = page.getByTestId("deposit-transaction-form");
      await test.step("record and verify the initial 60000 bank receipt", async () => {
        await deposit(page, 60000); await latest(page);
        // latest() alone can match the previous operation's retained message.
        // This receipt and exact visible projection belong to this deposit.
        await expect(depositForm.getByRole("status")).toContainText("저장 기록 확인됨");
        await amounts(page, { D: 60000, A: 60000, P: 0, R: 0, T: 0 });
        await expect(depositForm.getByRole("button", { name: "새 입금 거래 시작", exact: true })).toBeEnabled();
      });
      const cancelled = page.locator(`#${fixture!.secondApplicationId}-CANCELLED-reason`);
      await cancelled.fill("합성 보호자가 둘째 신청 취소 요청"); page.once("dialog", (dialog) => dialog.accept());
      await cancelled.locator("..").getByRole("button", { name: "보호자 요청으로 취소", exact: true }).click(); await latest(page);
      // The previous deposit has the same success message. Wait for this cancellation's
      // terminal review and receipt before reading the exact financial invariant.
      const cancelledReview = page.locator(`#application-${fixture!.secondApplicationId}`);
      await expect(cancelledReview.getByText("처리 사유: 합성 보호자가 둘째 신청 취소 요청", { exact: true })).toBeVisible();
      await expect(cancelled).toHaveCount(0);
      const sibling = await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.secondApplicationId } });
      expect(sibling).toMatchObject({ status: "CANCELLED", quotedAmount: 60000, resolutionNote: "합성 보호자가 둘째 신청 취소 요청" });
      const obligation = await db.returnObligation.findFirstOrThrow({ where: { applicationId: sibling.id, kind: "CANCELLED" } });
      expect(obligation).toMatchObject({ submissionId: fixture!.submissionId, amount: 60000, returnedAmount: 0 });
      await amounts(page, { D: 60000, A: 0, P: 0, R: 60000, T: 0 });
      await assertFamilyLedger(db, fixture!.submissionId, { D: 60000, A: 0, P: 0, R: 60000, T: 0 });
      expect(sibling.status).toBe("CANCELLED"); expect(sibling.quotedAmount).toBe(60000);
      const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`);
      await first.getByRole("checkbox").check(); await first.getByRole("combobox").selectOption("NEW");
      await expect(page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled();
      await expect(page.getByText("예약 확정에 40,000원이 부족합니다.", { exact: true })).toBeVisible();
      await test.step("verify the additional 40000 receipt before reviewing selection", async () => {
        await deposit(page, 40000); await latest(page);
        await expect(depositForm.getByRole("status")).toContainText("저장 기록 확인됨");
        await amounts(page, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
        await expect(depositForm.getByRole("button", { name: "새 입금 거래 시작", exact: true })).toBeEnabled();
        const review = page.getByRole("button", { name: "최신 선택 내용 다시 검토함", exact: true });
        await expect(review).toBeEnabled();
        await review.click({ timeout: 15000 });
      });
      await test.step("confirm only the first child after the refreshed ledger review", async () => {
        const confirm = page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true });
        await expect(confirm).toBeEnabled();
        await confirm.click({ timeout: 15000 }); await latest(page);
      });
      await expect(first).toHaveCount(0);
      await amounts(page, { D: 100000, A: 0, P: 40000, R: 60000, T: 0 });
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 0, P: 40000, R: 60000, T: 0 });
      const card = page.getByTestId(`return-obligation-${obligation.id}`);
      await card.getByRole("button", { name: "새 반환 거래 시작", exact: true }).click();
      await card.getByLabel("실제 반환 금액", { exact: true }).fill("20000"); await card.getByLabel("실제 반환일시 (KST)").fill(date); await card.getByLabel("반환 사유", { exact: true }).fill("합성 취소 일부 반환");
      await card.getByRole("button", { name: "반환 이체 기록", exact: true }).click(); await latest(page);
      await expect(card.getByTestId("return-obligation-remaining")).toHaveText("40,000원");
      await amounts(page, { D: 100000, A: 0, P: 40000, R: 40000, T: 20000 });
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 0, P: 40000, R: 40000, T: 20000 });
      expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(sibling);
      expect(await db.refund.count({ where: { paymentItem: { reservation: { classSchedule: { program: { name: fixture!.marker } } } } } })).toBe(0);
    } finally { await db.$disconnect(); }
  });
});
for (const role of ["MANAGER", "TEACHER"] as const) {
  test.describe(`Phase 5 ${role} financial denial`, () => {
    const state = process.env[`UX_${role}_STORAGE_STATE`]; test.use({ storageState: state });
    test("family and whole-return HTML/RSC disclose no ledger or family marker", async ({ page }) => {
      const fixture = fixtures["1280"]; test.skip(!fixture || !state, "Requires synthetic fixture and role state.");
      const db = new PrismaClient();
      try {
        const privateValues = await applicationPrivateValues(db, fixture!.submissionId);
        for (const path of [`/reservation-applications/submissions/${fixture!.submissionId}`, "/reservation-applications/returns"]) {
          await assertApplicationNotFound(page, path, [...privateValues, fixture!.marker, fixture!.firstApplicationId, fixture!.secondApplicationId]);
          await expect(page.getByTestId("deposit-transaction-form")).toHaveCount(0); await expect(page.getByTestId("detail-ledger")).toHaveCount(0);
        }
      } finally { await db.$disconnect(); }
    });
  });
}

test.describe("C11 real-browser recovery (server integration evidence is separate)", () => {
  test.use({ storageState: adminState });

  test("S1 committed deposit response loss → reload loses key → new-key D4 rejection preserves allocation", async ({ page }) => {
    const db = new PrismaClient(); let posts = 0; let lost = false;
    try {
      const fixture = await createRecoveryFamily(db);
      await page.goto(recoveryPath(fixture));
      const key = await prepareRecoveryDeposit(page, 100000);
      await page.route(`**${recoveryPath(fixture)}`, async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
        if (++posts !== 2) return route.continue(); // Read-only lookup, then the save.
        await route.fetch();
        expect(await db.applicationDeposit.count({ where: { submissionId: fixture.submissionId, idempotencyKey: key } })).toBe(1);
        lost = true; await route.abort("failed"); // Commit completed; browser never receives its response.
      });
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확"); expect(lost).toBe(true);
      await page.unrouteAll({ behavior: "wait" }); await page.reload();
      await expect(page.getByTestId("deposit-transaction-form").locator('input[name="idempotencyKey"]')).toHaveValue("");
      await page.getByText("실제 입금 및 배정 거래 내역 (1건)", { exact: true }).click();
      const deposit = await db.applicationDeposit.findFirstOrThrow({ where: { submissionId: fixture.submissionId } });
      await expect(page.getByTestId("detail-ledger")).toContainText(`입금 기록 ${deposit.id}`);
      await rejectRecoverySibling(page, db, fixture);
      const before = await recoverySnapshot(db, fixture);
      expect(before.deposits).toHaveLength(1); expect(before.allocations).toHaveLength(1);
      expect(before.allocations[0]).toMatchObject({ amount: 60000, paymentMappingId: null });
      const newKey = await prepareRecoveryDeposit(page, 100000); expect(newKey).not.toBe(key);
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
      await expectRecoveryDuplicate(page, deposit.id);
      expect(await recoverySnapshot(db, fixture)).toEqual(before);
      await expectRecoveryAmounts(page, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
      await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });

  test("S2 return commits while response is pending → actual context close → new ADMIN context reads history before a distinct partial return", async ({ browser }, info) => {
    const db = new PrismaClient();
    const original = await freshRecoveryContext(browser, info);
    let release = () => {}; let committed = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const saved = new Promise<void>((resolve) => { committed = resolve; });
    let routeFailure: unknown; let posts = 0;
    try {
      const fixture = await createRecoveryFamily(db); const page = await original.newPage(); await page.goto(recoveryPath(fixture));
      await saveRecoveryDeposit(page, 100000); const obligation = await rejectRecoverySibling(page, db, fixture);
      const key = await prepareRecoveryReturn(page, obligation.id, 20000, "합성 C11 최초 부분 반환");
      await page.route(`**${recoveryPath(fixture)}`, async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
        if (++posts !== 2) return route.continue();
        try {
          await route.fetch();
          expect(await db.applicationReturn.count({ where: { returnObligationId: obligation.id, idempotencyKey: key } })).toBe(1);
        } catch (error) { routeFailure = error; }
        committed(); await held; // No abort: closing the real context ends the pending browser request.
      });
      await page.getByTestId(`return-obligation-${obligation.id}`).getByRole("button", { name: "반환 이체 기록", exact: true }).click();
      await saved; expect(routeFailure).toBeUndefined();
      await original.close(); release();
      const reopened = await freshRecoveryContext(browser, info);
      try {
        const recovered = await reopened.newPage(); await recovered.goto(recoveryPath(fixture));
        const before = await recoverySnapshot(db, fixture);
        expect(before.returns).toHaveLength(1); expect(before.obligations[0]).toMatchObject({ amount: 60000, returnedAmount: 20000, resolvedAt: null });
        await expectRecoveryAmounts(recovered, { D: 100000, A: 40000, P: 0, R: 40000, T: 20000 });
        await recovered.getByRole("link", { name: "전체 반환 대상 보기", exact: true }).click();
        const card = recovered.getByTestId(`return-obligation-${obligation.id}`);
        await expect(card.locator('input[name="idempotencyKey"]')).toHaveValue("");
        await card.getByText("반환 내역 펼치기 (1건)", { exact: true }).click();
        await expect(card).toContainText(`반환 기록 ${before.returns[0].id}`); await expect(card).toContainText("합성 C11 최초 부분 반환");
        await expect(card.getByTestId("return-obligation-remaining")).toHaveText("40,000원");
        expect(await recoverySnapshot(db, fixture)).toEqual(before); // Navigation did not replay the old return.
        // Separate bank event, different amount/date/reason. This is not a duplicate-retry test.
        const nextKey = await prepareRecoveryReturn(recovered, obligation.id, 10000, "합성 C11 별도 두번째 부분 반환", "2026-01-02T09:30"); expect(nextKey).not.toBe(key);
        await card.getByRole("button", { name: "반환 이체 기록", exact: true }).click();
        await expect(card.getByTestId("return-obligation-remaining")).toHaveText("30,000원");
        await card.getByRole("link", { name: "가족 신청 상세", exact: true }).click();
        await expectRecoveryAmounts(recovered, { D: 100000, A: 40000, P: 0, R: 30000, T: 30000 });
        const after = await recoverySnapshot(db, fixture); expect(after.returns).toHaveLength(2);
        expect(after.returns.find((row) => row.id === before.returns[0].id)).toEqual(before.returns[0]);
        expect(after.allocations).toEqual(before.allocations);
        await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 40000, P: 0, R: 30000, T: 30000 });
      } finally { await reopened.close(); }
    } finally { release(); await original.close(); await db.$disconnect(); }
  });

  test("S4 committed save with failed authoritative reads hides stale balance and success, disables selected confirmation until read recovery", async ({ page }) => {
    const db = new PrismaClient(); let posts = 0; let blockedReads = 0; let failReads = true;
    try {
      const fixture = await createRecoveryFamily(db); await page.goto(recoveryPath(fixture));
      const selected = page.getByTestId(`confirmation-${fixture.firstApplicationId}`);
      await selected.getByRole("checkbox").check(); await selected.getByRole("combobox").selectOption("NEW");
      const key = await prepareRecoveryDeposit(page, 100000);
      await page.route(`**${recoveryPath(fixture)}`, async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
        if (++posts < 3 || !failReads) return route.continue();
        // lookup and save were sent normally. Fault injection applies only after a committed receipt exists.
        expect(await db.applicationDeposit.count({ where: { submissionId: fixture.submissionId, idempotencyKey: key } })).toBe(1);
        blockedReads++; await route.abort("failed");
      });
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("갱신 실패");
      await expect(page.getByTestId("workflow-status")).not.toContainText("저장 결과와 최신 서버 원장을 확인했습니다");
      await expect(page.getByTestId("detail-ledger")).toContainText("최신 원장 금액을 표시할 수 없습니다");
      await expect(page.getByTestId("detail-ledger").locator("dd")).toHaveCount(0);
      await expect(page.getByTestId("deposit-transaction-form").getByRole("button", { name: "새 입금 거래 시작", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled();
      await expect(page.getByTestId("confirmation-amounts")).toContainText("검증 필요");
      // This acknowledges the committed receipt only; it must not claim a verified latest ledger.
      await expect(page.getByTestId("deposit-transaction-form").getByRole("status")).toContainText("저장 기록 확인됨");
      const before = await recoverySnapshot(db, fixture); expect(before.deposits).toHaveLength(1); expect(before.reservations).toHaveLength(0); expect(blockedReads).toBeGreaterThan(0);
      const retry = page.getByRole("button", { name: "최신 서버 상태 다시 조회", exact: true }); await expect(retry).toBeEnabled();
      const blockedReadsBeforeRetry = blockedReads;
      await retry.click();
      await expect.poll(() => blockedReads).toBeGreaterThan(blockedReadsBeforeRetry);
      await expect(retry).toBeEnabled();
      await expect(page.getByTestId("workflow-status")).toContainText("갱신 실패");
      await expect(page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled();
      failReads = false; await expect(retry).toBeEnabled(); await retry.click();
      await expectRecoveryAmounts(page, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
      await expect(page.getByTestId("workflow-status")).toContainText("최신 서버 상태를 다시 확인했습니다");
      expect(await recoverySnapshot(db, fixture)).toEqual(before);
      await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });

  test("S5 keyless context follows detail/return links through similar receipts; unsent request not-found is never rollback proof", async ({ page, browser }, info) => {
    const db = new PrismaClient(); let posts = 0; let unsent = false;
    try {
      const fixture = await createRecoveryFamily(db); await page.goto(recoveryPath(fixture));
      await saveRecoveryDeposit(page, 50000);
      await prepareRecoveryDeposit(page, 50000, "2026-01-02T09:30");
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
      await expectRecoveryAmounts(page, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
      const obligation = await rejectRecoverySibling(page, db, fixture);
      const key = await prepareRecoveryDeposit(page, 10000, "2026-01-03T09:30");
      await page.route(`**${recoveryPath(fixture)}`, async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
        if (++posts !== 2) return route.continue();
        unsent = true; await route.abort("failed"); // No fetch: this save never reaches the server.
      });
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확"); expect(unsent).toBe(true);
      await page.unrouteAll({ behavior: "wait" });
      await page.getByTestId("deposit-transaction-form").getByRole("button", { name: "저장 결과 조회", exact: true }).click();
      await expect(page.getByTestId("deposit-transaction-form").getByRole("alert")).toContainText("저장 기록이 없습니다.");
      await expect(page.getByTestId("workflow-status")).toContainText("저장 기록을 아직 찾지 못했습니다");
      await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확");
      await expect(page.getByTestId("workflow-status")).not.toContainText(/롤백|저장 성공|최신 서버 원장을 확인했습니다/);
      await expect(page.getByTestId("detail-ledger")).toContainText("최신 원장 금액을 표시할 수 없습니다");
      await expect(page.getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
      expect(await db.applicationDeposit.count({ where: { idempotencyKey: key } })).toBe(0);
      const before = await recoverySnapshot(db, fixture); const context = await freshRecoveryContext(browser, info);
      try {
        const recovered = await context.newPage(); await recovered.goto(recoveryPath(fixture));
        await expect(recovered.getByTestId("deposit-transaction-form").locator('input[name="idempotencyKey"]')).toHaveValue("");
        await expect(recovered.getByTestId(`confirmation-${fixture.firstApplicationId}`).getByRole("checkbox")).not.toBeChecked();
        await recovered.getByText("실제 입금 및 배정 거래 내역 (2건)", { exact: true }).click();
        for (const receipt of before.deposits) await expect(recovered.getByTestId("detail-ledger")).toContainText(`입금 기록 ${receipt.id}`);
        await expect(recovered.getByTestId("deposit-transaction-form").getByRole("status")).toHaveCount(0);
        await expect(recovered.getByTestId("workflow-status")).not.toContainText(/저장 결과와|원래 요청.*성공|롤백/);
        await recovered.getByRole("link", { name: "전체 반환 대상 보기", exact: true }).click();
        const card = recovered.getByTestId(`return-obligation-${obligation.id}`);
        await card.getByText("반환 내역 펼치기 (0건)", { exact: true }).click(); await expect(card).toContainText("완료 반환 기록 없음");
        await card.getByRole("link", { name: "가족 신청 상세", exact: true }).click();
        await expectRecoveryAmounts(recovered, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
        expect(await recoverySnapshot(db, fixture)).toEqual(before);
        await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
      } finally { await context.close(); }
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });

  test("S6 real UI double click then reconnect/manual identical deposit is rejected without a second financial row", async ({ page, browser }, info) => {
    const db = new PrismaClient();
    try {
      const fixture = await createRecoveryFamily(db); await page.goto(recoveryPath(fixture));
      const key = await prepareRecoveryDeposit(page, 100000);
      // Real browser input, not two API requests or two evaluate() submissions.
      await page.getByRole("button", { name: "실제 입금 기록", exact: true }).dblclick();
      await expectRecoveryAmounts(page, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
      expect(await db.applicationDeposit.count({ where: { submissionId: fixture.submissionId } })).toBe(1);
      await rejectRecoverySibling(page, db, fixture);
      const before = await recoverySnapshot(db, fixture);
      expect(before.deposits).toHaveLength(1); expect(before.allocations).toHaveLength(1); expect(before.allocations[0].amount).toBe(60000);
      const context = await freshRecoveryContext(browser, info);
      try {
        const recovered = await context.newPage(); await recovered.goto(recoveryPath(fixture));
        await expect(recovered.getByTestId("deposit-transaction-form").locator('input[name="idempotencyKey"]')).toHaveValue("");
        const nextKey = await prepareRecoveryDeposit(recovered, 100000); expect(nextKey).not.toBe(key);
        await recovered.getByRole("button", { name: "실제 입금 기록", exact: true }).click();
        await expectRecoveryDuplicate(recovered, before.deposits[0].id);
        expect(await recoverySnapshot(db, fixture)).toEqual(before);
        await expectRecoveryAmounts(recovered, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
        await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 40000, P: 0, R: 60000, T: 0 });
      } finally { await context.close(); }
    } finally { await db.$disconnect(); }
  });
});
