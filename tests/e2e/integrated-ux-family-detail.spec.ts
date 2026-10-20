import { expect, test } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";
// Operator-provisioned synthetic records, read-only browser interactions. Never submits a form.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const fixture = process.env.UX_FAMILY_DETAIL_FIXTURES ? z.object({
  submissionId: id, applicationId: id, foreignApplicationId: id, classScheduleId: id, page: z.number().int().positive(),
  // Sentinels identify synthetic-only text; no real personal data belongs in runner configuration.
  originalRequestSentinel: z.string().min(8), reservationMemoSentinel: z.string().min(8).optional(),
  actualReservationId: id.optional(), actualPaymentId: id.optional(),
  purgedSubmissionId: id.optional(), invalidLedgerSubmissionId: id.optional(), unknownConsentSubmissionId: id.optional(),
}).parse(JSON.parse(process.env.UX_FAMILY_DETAIL_FIXTURES)) : null;
const states = { ADMIN: process.env.UX_ADMIN_STORAGE_STATE, MANAGER: process.env.UX_MANAGER_STORAGE_STATE, TEACHER: process.env.UX_TEACHER_STORAGE_STATE };
const familyUrl = () => `/reservation-applications/submissions/${fixture!.submissionId}?status=all&classScheduleId=${fixture!.classScheduleId}&page=${fixture!.page}`;
test.describe("Phase 4 read-only family detail", () => {
  test.skip(!fixture || !states.ADMIN, "Requires dedicated local synthetic detail fixtures and ADMIN storage state.");
  test.use({ storageState: states.ADMIN });
  for (const width of [360, 390, 768, 1280]) {
    test(`${width}px preserves review/ledger/existing-confirmation order and child/list context`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${familyUrl()}&applicationId=${fixture!.applicationId}#application-${fixture!.applicationId}`);
      await expect(page.getByRole("heading", { name: "가족 신청 상세", exact: true })).toBeVisible();
      const review = page.locator(`#application-${fixture!.applicationId}`);
      await expect(review).toBeFocused();
      const sections = await page.locator('[data-testid="family-review"], [data-testid="family-ledger"], [data-testid="family-confirmation"], [data-testid="family-related-records"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
      expect(sections).toEqual(["family-review", "family-ledger", "family-confirmation", "family-related-records"]);
      await expect(review).toContainText(fixture!.originalRequestSentinel);
      const related = page.getByTestId("family-related-records");
      await expect(related).not.toContainText(fixture!.originalRequestSentinel);
      await expect(related.getByRole("link", { name: "결제 등록", exact: true })).toHaveCount(0);
      await expect(review.getByRole("link", { name: "연결된 예약 상세", exact: true })).toHaveCount(0);
      if (fixture!.reservationMemoSentinel) {
        await expect(related).toContainText(`예약 운영 메모: ${fixture!.reservationMemoSentinel}`);
        await expect(review).not.toContainText(fixture!.reservationMemoSentinel);
      }
      if (fixture!.actualReservationId) await expect(related.locator(`a[href="/reservations/${fixture!.actualReservationId}"]`)).toBeVisible();
      if (fixture!.actualPaymentId) await expect(related.locator(`a[href="/payments/${fixture!.actualPaymentId}"]`).first()).toBeVisible();
      await expect(review.getByTestId("review-consents")).toContainText("미동의 (정상 신청)");
      await review.getByText("동의 문구 원문 보기", { exact: true }).click();
      await expect(review.getByText("동의 문구 원문 보기", { exact: true }).locator("..")).toHaveAttribute("open", "");
      await review.getByText("연결된 아이의 동의 이력 보기", { exact: true }).click();
      await expect(review.getByTestId("review-retention")).toContainText("보관 만료일");
      await expect(page.getByTestId("detail-ledger")).toContainText("D = A + P + R + T");
      await page.getByText(/실제 입금 및 배정 거래 내역/).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const confirmation = page.getByTestId("family-confirmation");
      await expect(confirmation.getByRole("button", { name: "선택한 아이 0명 예약 확정", exact: true })).toBeVisible();
      for (const memo of await confirmation.locator("textarea").all()) expect(await memo.inputValue()).not.toContain(fixture!.originalRequestSentinel);
      await review.getByRole("link", { name: "아이별 신청 상세 및 기존 처리 화면", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/reservation-applications/${fixture!.applicationId}\\?`));
      await page.getByRole("link", { name: "가족 신청의 입금·확정 내역 보기", exact: true }).click();
      await expect(page.locator(`#application-${fixture!.applicationId}`)).toBeFocused();
      await page.getByRole("link", { name: "신청 목록으로", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`classScheduleId=${fixture!.classScheduleId}.*#family-submission-${fixture!.submissionId}$`));
      expect(new URL(page.url()).searchParams.get("page") ?? "1").toBe(String(fixture!.page));
    });
  }
  test("foreign, missing and malformed child hints remain within the current family", async ({ page }) => {
    for (const child of [fixture!.foreignApplicationId, "missing", "../invalid"]) {
      await page.goto(`${familyUrl()}&applicationId=${encodeURIComponent(child)}`);
      await expect(page.getByText("요청한 아이 위치를 확인할 수 없어 이 가족의 전체 신청을 표시합니다.", { exact: true })).toBeVisible();
      await expect(page.locator(`#application-${fixture!.foreignApplicationId}`)).toHaveCount(0);
      await expect(page.getByTestId("family-detail-summary")).toContainText(fixture!.submissionId);
    }
    await page.goto(familyUrl()); await expect(page.getByText("요청한 아이 위치를 확인할 수 없어", { exact: false })).toHaveCount(0);
  });
  test("purge and unknown original states are explicit", async ({ page }) => {
    test.skip(!fixture!.purgedSubmissionId || !fixture!.unknownConsentSubmissionId, "Requires purged and unknown-consent local synthetic cases.");
    await page.goto(`/reservation-applications/submissions/${fixture!.purgedSubmissionId}`);
    await expect(page.getByTestId("review-purged").first()).toBeVisible();
    await page.goto(`/reservation-applications/submissions/${fixture!.unknownConsentSubmissionId}`);
    await expect(page.getByText(/이 버전의 동의 원문을 확인할 수 없습니다/).first()).toBeVisible();
  });
  test("invalid ledger never displays a normal available value", async ({ page }) => {
    test.skip(!fixture!.invalidLedgerSubmissionId, "Requires invalid-ledger local synthetic case.");
    await page.goto(`/reservation-applications/submissions/${fixture!.invalidLedgerSubmissionId}`);
    const ledger = page.getByTestId("detail-ledger"); await expect(ledger.getByRole("alert")).toContainText("가용액을 표시할 수 없습니다");
    await expect(ledger.getByText("A · 예약·후속 처리 가용액", { exact: true })).toHaveCount(0);
  });
  test("missing family is a safe not-found response", async ({ page }) => {
    const response = await page.goto("/reservation-applications/submissions/ux4-synthetic-missing");
    expect(response?.status()).toBe(404); await expect(page.getByTestId("family-review")).toHaveCount(0);
  });
});
for (const role of ["MANAGER", "TEACHER"] as const) {
  test.describe(`Phase 4 ${role} denial`, () => {
    test.skip(!fixture || !states[role], `Requires synthetic fixture and ${role} storage state.`); test.use({ storageState: states[role] });
    test("direct family/child URLs reveal no review, consent or ledger", async ({ page }) => {
      for (const path of [`/reservation-applications/submissions/${fixture!.submissionId}?applicationId=${fixture!.applicationId}`, `/reservation-applications/${fixture!.applicationId}`]) {
        const response = await page.goto(path); expect(response?.status()).toBe(404);
        expect(await response!.text()).not.toContain(fixture!.originalRequestSentinel);
        const rsc = await page.request.get(path, { headers: { RSC: "1" } });
        expect(await rsc.text()).not.toContain(fixture!.originalRequestSentinel);
        await expect(page.getByTestId("application-review-card")).toHaveCount(0); await expect(page.getByTestId("detail-ledger")).toHaveCount(0); await expect(page.getByTestId("application-consents")).toHaveCount(0);
      }
    });
  });
}

// Failure-state checking uses a separately provisioned local server, never a DB mutation.
test.describe("Phase 4 controlled read failure", () => {
  test.use({ storageState: states.ADMIN });
  test("shows retry without a success/zero-balance fallback", async ({ page }) => {
    test.skip(process.env.UX_FAMILY_SERVER_STATE !== "read-failure" || !states.ADMIN || !fixture, "Requires controlled local read failure after authentication.");
    await page.goto(familyUrl());
    await expect(page.getByRole("alert")).toContainText("가족 신청·동의·원장을 불러오지 못했습니다");
    await expect(page.getByRole("button", { name: "재시도", exact: true })).toBeVisible();
    await expect(page.getByTestId("detail-ledger")).toHaveCount(0);
    await expect(page.getByText("0원", { exact: true })).toHaveCount(0);
  });
});
