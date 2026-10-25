import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
import { assertFamilyLedger } from "./support/integrated-ux-invariants";
import { createRecoveryFamily, expectRecoveryAmounts, freshRecoveryContext, recoveryPath, recoverySnapshot, saveRecoveryDeposit } from "./support/c11-recovery";

// Requires run-owned local synthetic fixtures. Never admits Preview or a remote database.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const schema = z.object({ submissionId: id, firstApplicationId: id, secondApplicationId: id, marker: z.string().startsWith("UX6_SYNTHETIC_"), existingChildId: id.optional(), foreignChildId: id.optional() });
const fixtures = process.env.UX_CONFIRMATION_FIXTURES ? z.record(schema).parse(JSON.parse(process.env.UX_CONFIRMATION_FIXTURES)) : {};
const state = process.env.UX_ADMIN_STORAGE_STATE;
async function pristine(db: PrismaClient, fixture: z.infer<typeof schema>) {
  const row = await db.reservationApplicationSubmission.findUniqueOrThrow({ where: { id: fixture.submissionId }, include: { applications: { orderBy: { quotedAmount: "asc" }, include: { classSchedule: { include: { program: true } } } }, deposits: true } });
  expect(row.guardianName).toBe(fixture.marker); expect(row.applications.map((item) => [item.id, item.quotedAmount, item.status])).toEqual([[fixture.firstApplicationId, 40000, "SUBMITTED"], [fixture.secondApplicationId, 60000, "SUBMITTED"]]);
  expect(row.applications.every((item) => item.classSchedule.program.name === fixture.marker)).toBe(true); expect(row.deposits.reduce((sum, item) => sum + item.amount, 0)).toBe(100000);
  return row;
}
test.describe("Phase 6 explicit selected atomic confirmation", () => {
  test.use({ storageState: state });
  for (const width of [360, 390, 1280]) test(`${width}px explicit NEW choice confirms first only; sibling memo draft and original request survive`, async ({ page }) => {
    const fixture = fixtures[String(width)]; test.skip(!fixture || !state, "Requires a dedicated pristine local synthetic family with 100000 deposited and ADMIN state."); const db = new PrismaClient();
    try {
      const before = await pristine(db, fixture!); await page.setViewportSize({ width, height: 900 }); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      const form = page.getByTestId("confirmation-selection-form"); await expect(form.getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled(); await expect(form.getByText("확정할 아이를 선택해 주세요.", { exact: true })).toBeVisible();
      const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`), second = page.getByTestId(`confirmation-${fixture!.secondApplicationId}`);
      await first.getByRole("checkbox").check();
      // React-controlled selection proves hydration before entering either memo draft.
      await expect(form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled(); await first.getByRole("combobox").selectOption("NEW");
      await expect(form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeEnabled();
      await expect(second.getByRole("checkbox")).not.toBeChecked();
      await second.getByRole("textbox").fill("둘째 미선택 보존 초안"); await first.getByRole("textbox").fill("첫째 검토 완료 메모");
      await expect(second.getByRole("textbox")).toHaveValue("둘째 미선택 보존 초안");
      await expect(page.getByTestId("confirmation-amounts")).toContainText("40,000원"); await form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다"); await expect(first).toHaveCount(0); await expect(second.getByRole("textbox")).toHaveValue("둘째 미선택 보존 초안");
      const ledger = page.getByTestId("detail-ledger");
      await expect(ledger.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^P ·/ }) }).locator("dd")).toHaveText("40,000원");
      await expect(ledger.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^A ·/ }) }).locator("dd")).toHaveText("60,000원");
      await expect(page.getByRole("link", { name: "연결된 예약 상세", exact: true })).toBeVisible();
      const after = await db.reservationApplication.findMany({ where: { submissionId: fixture!.submissionId }, orderBy: { quotedAmount: "asc" }, include: { reservation: { include: { paymentItem: true } }, paymentMapping: true } });
      expect(after[0]).toMatchObject({ status: "CONFIRMED", quotedAmount: 40000, requestNote: before.applications[0]!.requestNote, reservation: { memo: "첫째 검토 완료 메모", paymentItem: { paidAmount: 40000 } } }); expect(after[1]).toMatchObject({ status: "SUBMITTED", reservationId: null, paymentMapping: null });
      await expect(page.getByTestId("family-related-records")).toContainText("예약 운영 메모: 첫째 검토 완료 메모"); await expect(page.getByRole("link", { name: "연결된 결제 상세", exact: true })).toHaveAttribute("href", `/payments/${after[0]!.reservation!.paymentItem!.paymentId}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await db.$disconnect(); }
  });
  test("lost response reconciles actual Reservation/Payment without replay", async ({ page }) => {
    const fixture = fixtures.loss; test.skip(!fixture || !state, "Requires a dedicated local response-loss fixture."); const db = new PrismaClient(); let intercepted = false;
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`); await first.getByRole("checkbox").check(); await first.getByRole("combobox").selectOption("NEW");
      await page.route(`**/reservation-applications/submissions/${fixture!.submissionId}`, async (route) => {
        if (!intercepted && route.request().method() === "POST" && route.request().headers()["next-action"]) { intercepted = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
      });
      await page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click(); await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확");
      await page.getByRole("button", { name: "최신 서버 상태 다시 조회", exact: true }).click(); await expect(first).toHaveCount(0); await expect(page.getByRole("link", { name: "연결된 결제 상세", exact: true })).toBeVisible();
      expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: fixture!.firstApplicationId } })).toBe(1); expect(await db.paymentItem.count({ where: { reservationApplicationMapping: { applicationId: fixture!.firstApplicationId } } })).toBe(1);
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });
  test("overbooking has one primary action and selection changes discard its approval", async ({ page }) => {
    const fixture = fixtures.overbooking; test.skip(!fixture || !state, "Requires its own local fixture with first class already full."); const db = new PrismaClient();
    try {
      await pristine(db, fixture!); await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`); const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`), form = page.getByTestId("confirmation-selection-form");
      await first.getByRole("checkbox").check(); await first.getByRole("combobox").selectOption("NEW"); await form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(form.getByRole("button", { name: "초과 예약을 확인하고 선택한 아이 1명 예약 확정", exact: true })).toBeVisible(); await expect(form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toHaveCount(0); await expect(form).toContainText("현재 예약");
      await first.getByRole("checkbox").uncheck(); await expect(form.getByRole("button", { name: /초과 예약을 확인하고/ })).toHaveCount(0); await expect(form.getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
      expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: fixture!.firstApplicationId } })).toBe(0);
      // Discarded approval must be requested again, and only the second explicit action may commit.
      await first.getByRole("checkbox").check();
      await form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(form.getByRole("button", { name: "초과 예약을 확인하고 선택한 아이 1명 예약 확정", exact: true })).toBeVisible();
      expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: fixture!.firstApplicationId } })).toBe(0);
      await form.getByRole("button", { name: "초과 예약을 확인하고 선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다");
      const confirmed = await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.firstApplicationId }, include: { classSchedule: { include: { reservations: { where: { status: "RESERVED" } } } } } });
      expect(confirmed.status).toBe("CONFIRMED"); expect(confirmed.classSchedule.reservations.length).toBe(confirmed.classSchedule.capacity + 1);
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
    } finally { await db.$disconnect(); }
  });

  test("explicit existing Child choice creates one reservation without creating or rewriting a Child", async ({ page }) => {
    const fixture = fixtures.existing; test.skip(!fixture?.existingChildId || !state, "BLOCKED: dedicated matching existing-Child fixture and ADMIN state required."); const db = new PrismaClient();
    try {
      await pristine(db, fixture!);
      const siblingBefore = await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.secondApplicationId } });
      const child = await db.child.findUniqueOrThrow({ where: { id: fixture!.existingChildId } });
      const childrenBefore = await db.child.count({ where: { guardianName: fixture!.marker } });
      await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`);
      await first.getByRole("checkbox").check();
      await expect(page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled();
      await first.getByRole("combobox").selectOption(fixture!.existingChildId!);
      await page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("저장 결과와 최신 서버 원장을 확인했습니다");
      const after = await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.firstApplicationId }, include: { reservation: true, paymentMapping: true } });
      expect(after).toMatchObject({ status: "CONFIRMED", childId: child.id, quotedAmount: 40000, reservation: { childId: child.id } }); expect(after.paymentMapping).not.toBeNull();
      expect(await db.child.count({ where: { guardianName: fixture!.marker } })).toBe(childrenBefore);
      expect(await db.child.findUniqueOrThrow({ where: { id: child.id } })).toEqual(child);
      expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.secondApplicationId } })).toEqual(siblingBefore);
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
      // Existing refunds remain PaymentItem operations; they never release application allocations.
      const item = await db.paymentItem.findUniqueOrThrow({ where: { reservationId: after.reservationId! }, include: { payment: true, reservation: { include: { classSchedule: true } } } });
      await page.goto(`/payments/${item.paymentId}`);
      await page.getByRole("link", { name: "환불 등록", exact: true }).click();
      await page.locator("#amount").fill("10000"); await page.locator("#reason").selectOption("PERSONAL");
      await page.locator("#reasonDetail").fill("합성 연결 결제의 일부 환불");
      await page.getByRole("button", { name: "환불 처리", exact: true }).click();
      await expect(page).toHaveURL(`/payments/${item.paymentId}`);
      const refunded = await db.paymentItem.findUniqueOrThrow({ where: { id: item.id }, include: { payment: true, refunds: true } });
      expect(refunded).toMatchObject({ paidAmount: 40000, refundedAmount: 10000, payment: { totalAmount: 40000, status: "PARTIAL_REFUNDED" } });
      expect(refunded.refunds).toHaveLength(1); expect(refunded.refunds[0]!.amount).toBe(10000);
      expect(refunded.payment.paidAt).toEqual(item.payment.paidAt);
      expect((await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.firstApplicationId } })).quotedAmount).toBe(40000);
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
      const kstDate = (date: Date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
      const refundDate = kstDate(refunded.refunds[0]!.refundedAt), paymentDate = kstDate(item.payment.paidAt), classDate = kstDate(item.reservation.classSchedule.startsAt);
      await page.goto(`/revenue?dateFrom=${refundDate}&dateTo=${refundDate}&classScheduleId=${item.reservation.classScheduleId}`);
      await expect(page.getByTestId("summary-환불")).toContainText("10,000원");
      await expect(page.getByTestId("summary-결제")).toContainText(paymentDate === refundDate ? "40,000원" : "0원");
      await expect(page.getByTestId("summary-예약")).toContainText(classDate === refundDate ? "1건" : "0건");
      await page.goto(`/revenue?dateFrom=${classDate}&dateTo=${classDate}&classScheduleId=${item.reservation.classScheduleId}`);
      await expect(page.getByTestId("summary-예약")).toContainText("1건");
      await expect(page.getByTestId("summary-환불")).toContainText(classDate === refundDate ? "10,000원" : "0원");
    } finally { await db.$disconnect(); }
  });

  test("another family's Child is absent from choices and a forged UI submission is rejected atomically", async ({ page }) => {
    const fixture = fixtures.foreign; test.skip(!fixture?.foreignChildId || !state, "BLOCKED: dedicated foreign-family Child fixture and ADMIN state required."); const db = new PrismaClient();
    try {
      await pristine(db, fixture!); const foreign = await db.child.findUniqueOrThrow({ where: { id: fixture!.foreignChildId } });
      const sibling = await db.reservationApplication.findUniqueOrThrow({ where: { id: fixture!.secondApplicationId } });
      await page.goto(`/reservation-applications/submissions/${fixture!.submissionId}`);
      const first = page.getByTestId(`confirmation-${fixture!.firstApplicationId}`);
      await first.getByRole("checkbox").check(); await first.getByRole("combobox").selectOption("NEW");
      expect(await first.getByRole("combobox").locator("option").evaluateAll((options, deniedId) => options.some((option) => (option as HTMLOptionElement).value === deniedId), fixture!.foreignChildId!)).toBe(false);
      let submitted = false;
      await page.route(`**/reservation-applications/submissions/${fixture!.submissionId}`, async (route) => {
        const body = route.request().postData();
        if (!submitted && route.request().method() === "POST" && body?.includes('"newChild":true')) {
          submitted = true;
          // Adversarial input still travels through the real browser-triggered Server Action and its authorization.
          await route.continue({ postData: body.replace('"newChild":true', `"childId":"${fixture!.foreignChildId}"`) });
        } else await route.continue();
      });
      await page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      const rejection = page.getByTestId("confirmation-selection-form").getByRole("alert").filter({ hasText: "아이 연결, 중복 예약, 신청·클래스 상태를 다시 확인해주세요." });
      await expect(rejection).toHaveText("아이 연결, 중복 예약, 신청·클래스 상태를 다시 확인해주세요."); await expect(rejection).toBeVisible(); expect(submitted).toBe(true);
      expect(await db.reservationApplicationPaymentMapping.count({ where: { application: { submissionId: fixture!.submissionId } } })).toBe(0);
      expect(await db.child.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
      expect(await db.reservationApplication.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(sibling);
      await assertFamilyLedger(db, fixture!.submissionId, { D: 100000, A: 100000, P: 0, R: 0, T: 0 });
    } finally { await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });
});

test.describe("C11 real-browser selected confirmation recovery", () => {
  test.use({ storageState: state });
  test("S3 selected confirmation commits before response loss → fresh context loses selection and verifies actual links without replay", async ({ page, browser }, info) => {
    const db = new PrismaClient(); let intercepted = false; let confirmationWrites = 0; let confirmationAction = "";
    try {
      const fixture = await createRecoveryFamily(db); await page.goto(recoveryPath(fixture));
      await saveRecoveryDeposit(page, 100000);
      const first = page.getByTestId(`confirmation-${fixture.firstApplicationId}`);
      await first.getByRole("checkbox").check(); await first.getByRole("combobox").selectOption("NEW");
      await first.getByRole("textbox").fill("합성 C11 확정 메모");
      const sibling = page.getByTestId(`confirmation-${fixture.secondApplicationId}`);
      await sibling.getByRole("textbox").fill("합성 C11 사라질 미선택 초안");
      const before = await recoverySnapshot(db, fixture);
      await page.route(`**${recoveryPath(fixture)}`, async (route) => {
        if (route.request().method() !== "POST" || !route.request().headers()["next-action"] || intercepted) return route.continue();
        intercepted = true; confirmationWrites++; confirmationAction = route.request().headers()["next-action"];
        await route.fetch();
        // Independently prove this is a committed confirmation, not a failed request before save.
        expect(await db.reservationApplicationPaymentMapping.count({ where: { applicationId: fixture.firstApplicationId } })).toBe(1);
        await route.abort("failed");
      });
      await page.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true }).click();
      await expect(page.getByTestId("workflow-status")).toContainText("결과 불명확"); expect(intercepted).toBe(true);
      const committed = await recoverySnapshot(db, fixture);
      expect(committed.reservations).toHaveLength(1); expect(committed.payments).toHaveLength(1); expect(committed.items).toHaveLength(1); expect(committed.mappings).toHaveLength(1);
      const application = committed.applications.find((row) => row.id === fixture.firstApplicationId)!;
      expect(application).toMatchObject({ status: "CONFIRMED", reservationId: committed.reservations[0].id, childId: committed.reservations[0].childId, quotedAmount: 40000, requestNote: "합성 C11 원본 요청" });
      expect(committed.reservations[0]).toMatchObject({ memo: "합성 C11 확정 메모", status: "RESERVED" });
      expect(committed.items[0]).toMatchObject({ reservationId: application.reservationId, paymentId: committed.payments[0].id, amount: 40000, paidAmount: 40000, refundedAmount: 0 });
      expect(committed.payments[0]).toMatchObject({ totalAmount: 40000, method: "TRANSFER", status: "PAID" });
      expect(committed.mappings[0]).toMatchObject({ applicationId: application.id, paymentItemId: committed.items[0].id });
      expect(committed.applications.find((row) => row.id === fixture.secondApplicationId)).toEqual(before.applications.find((row) => row.id === fixture.secondApplicationId));
      expect(committed.deposits).toEqual(before.deposits);
      await page.unrouteAll({ behavior: "wait" }); await page.close(); // Discard all original selection/memo state.
      const context = await freshRecoveryContext(browser, info);
      try {
        const recovered = await context.newPage();
        await recovered.route(`**${recoveryPath(fixture)}`, (route) => {
          if (route.request().method() === "POST" && route.request().headers()["next-action"] === confirmationAction) confirmationWrites++;
          return route.continue();
        });
        await recovered.goto(recoveryPath(fixture));
        await expect(recovered.getByTestId(`confirmation-${fixture.firstApplicationId}`)).toHaveCount(0);
        const remaining = recovered.getByTestId(`confirmation-${fixture.secondApplicationId}`);
        await expect(remaining.getByRole("checkbox")).not.toBeChecked(); await expect(remaining.getByRole("textbox")).toHaveValue("");
        await expect(recovered.getByTestId("deposit-transaction-form").locator('input[name="idempotencyKey"]')).toHaveValue("");
        await expect(recovered.getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeDisabled();
        await expectRecoveryAmounts(recovered, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
        await expect(recovered.getByRole("link", { name: "연결된 예약 상세", exact: true })).toHaveAttribute("href", `/reservations/${application.reservationId}`);
        await expect(recovered.getByRole("link", { name: "연결된 결제 상세", exact: true })).toHaveAttribute("href", `/payments/${committed.payments[0].id}`);
        await recovered.getByRole("link", { name: "연결된 예약 상세", exact: true }).click(); await expect(recovered).toHaveURL(`/reservations/${application.reservationId}`);
        await recovered.goBack(); await recovered.getByRole("link", { name: "연결된 결제 상세", exact: true }).click(); await expect(recovered).toHaveURL(`/payments/${committed.payments[0].id}`);
        expect(confirmationWrites).toBe(1); expect(await recoverySnapshot(db, fixture)).toEqual(committed);
        await assertFamilyLedger(db, fixture.submissionId, { D: 100000, A: 60000, P: 40000, R: 0, T: 0 });
      } finally { await context.close(); }
    } finally { if (!page.isClosed()) await page.unrouteAll({ behavior: "wait" }); await db.$disconnect(); }
  });
});
