import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// Requires run-owned local synthetic fixtures. Never admits Preview or a remote database.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const schema = z.object({ submissionId: id, firstApplicationId: id, secondApplicationId: id, marker: z.string().startsWith("UX6_SYNTHETIC_") });
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
      await second.getByRole("textbox").fill("둘째 미선택 보존 초안"); await first.getByRole("checkbox").check();
      await expect(form.getByRole("button", { name: "선택한 아이 1명 예약 확정", exact: true })).toBeDisabled(); await first.getByRole("combobox").selectOption("NEW"); await first.getByRole("textbox").fill("첫째 검토 완료 메모");
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
    } finally { await db.$disconnect(); }
  });
});
