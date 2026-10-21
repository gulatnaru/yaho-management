import { expect, test } from "@playwright/test";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "./support/db-safety";

// Authenticated, operator-provisioned synthetic fixtures only. This suite performs no writes.
// Run separately in the existing local desktop/WebKit matrix; actual Safari remains manual.
if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("UX_E2E_LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
const fixtures = process.env.UX_FAMILY_LIST_FIXTURES ? z.object({
  classScheduleId: z.string().regex(/^[A-Za-z0-9_-]+$/), familyId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(["submission", "legacy"]), page: z.number().int().positive(),
  globalPendingFamilies: z.number().int().nonnegative(),
  // Only synthetic sentinel values; never supply real personal data.
  privateSentinels: z.array(z.string().min(8)), emptyClassId: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).parse(JSON.parse(process.env.UX_FAMILY_LIST_FIXTURES)) : null;
const states = { ADMIN: process.env.UX_ADMIN_STORAGE_STATE, MANAGER: process.env.UX_MANAGER_STORAGE_STATE, TEACHER: process.env.UX_TEACHER_STORAGE_STATE };

test.describe("Phase 3 read-only family list", () => {
  test.skip(!fixtures || !states.ADMIN, "Pending dedicated local synthetic family fixtures and ADMIN storage state.");
  test.use({ storageState: states.ADMIN });
  for (const width of [360, 390, 768, 1280]) {
    test(`${width}px expansion is separate from detail navigation and return restores context/card`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const context = new URLSearchParams({ classScheduleId: fixtures!.classScheduleId, status: "all", page: String(fixtures!.page) });
      const response = await page.goto(`/reservation-applications?${context}`);
      const initial = await response!.text();
      for (const privateValue of fixtures!.privateSentinels) expect(initial.includes(privateValue)).toBe(false);
      const card = page.locator(`#family-${fixtures!.kind}-${fixtures!.familyId}`);
      await expect(card).toBeVisible(); await expect(card.getByRole("link", { name: "신청 처리하기" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator("table")).toHaveCount(0); await expect(page.locator("a a")).toHaveCount(0);
      const before = page.url(); await card.locator("summary").click();
      await expect(card.locator("details")).toHaveAttribute("open", ""); expect(page.url()).toBe(before);
      await card.getByRole("link", { name: "신청 처리하기" }).click();
      await page.getByRole("link", { name: "신청 목록으로", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`classScheduleId=${fixtures!.classScheduleId}.*#family-${fixtures!.kind}-${fixtures!.familyId}$`));
      await expect(card).toBeVisible();
      expect(new URL(page.url()).searchParams.get("page") ?? "1").toBe(String(fixtures!.page));
      const rsc = await page.request.get(`/reservation-applications?${context}`, { headers: { RSC: "1" } });
      const payload = await rsc.text(); for (const privateValue of fixtures!.privateSentinels) expect(payload.includes(privateValue)).toBe(false);
    });
  }
  test("global badge uses families and filter application/removal reset the page", async ({ page }) => {
    await page.goto(`/reservation-applications?classScheduleId=${fixtures!.classScheduleId}&page=999`);
    await expect(page.getByText(`전역 대기 ${fixtures!.globalPendingFamilies}가족`, { exact: false })).toBeVisible();
    const openMenu = page.getByRole("button", { name: "메뉴 열기", exact: true });
    const mobileMenu = await openMenu.isVisible();
    if (mobileMenu) await openMenu.click();
    await expect(page.getByRole("link", { name: fixtures!.globalPendingFamilies > 0 ? `예약 신청 (대기 ${fixtures!.globalPendingFamilies}가족)` : "예약 신청", exact: true }).first()).toBeVisible();
    if (mobileMenu) await page.keyboard.press("Escape");
    await page.getByLabel("상태", { exact: true }).selectOption("all"); await page.getByRole("button", { name: "조회", exact: true }).click();
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await page.getByRole("link", { name: "클래스 필터 해제", exact: true }).click();
    expect(new URL(page.url()).searchParams.has("classScheduleId")).toBe(false);
    expect(new URL(page.url()).searchParams.get("status")).toBe("all");
  });
  test("no matches offers reset and preserves existing class entry context", async ({ page }) => {
    await page.goto(`/reservation-applications?classScheduleId=${fixtures!.emptyClassId}`);
    await expect(page.getByText("조건에 맞는 신청이 없습니다", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "필터 초기화", exact: true }).last()).toBeVisible();
    await page.goto(`/classes/${fixtures!.classScheduleId}`);
    await page.getByRole("link", { name: "이 클래스 신청 보기", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("classScheduleId")).toBe(fixtures!.classScheduleId);
  });
});
for (const role of ["MANAGER", "TEACHER"] as const) {
  test.describe(`${role} application denial`, () => {
    test.skip(!states[role], `Pending ${role} storage state.`); test.use({ storageState: states[role] });
    test("direct list and context query reveal no application cards/counts", async ({ page }) => {
      const response = await page.goto("/reservation-applications?status=all&notification=received&bankRecord=recorded");
      await expect(page.getByTestId("family-application-card")).toHaveCount(0);
      await expect(page.getByText(/전역 대기 \d+가족/)).toHaveCount(0);
      expect(response?.status()).toBe(404);
    });
  });
}
// These two cases need separately provisioned local server states; never mutate a running DB here.
test.describe("Phase 3 controlled empty/outage server states", () => {
  test.use({ storageState: states.ADMIN });
  test("first-ever zero has a different message", async ({ page }) => {
    test.skip(process.env.UX_FAMILY_SERVER_STATE !== "empty" || !states.ADMIN, "Pending empty local synthetic server.");
    await page.goto("/reservation-applications"); await expect(page.getByText("접수된 신청이 없습니다", { exact: true })).toBeVisible();
  });
  test("failed read displays retry rather than zero or success", async ({ page }) => {
    test.skip(process.env.UX_FAMILY_SERVER_STATE !== "read-failure" || !states.ADMIN, "Pending controlled local read failure after authentication.");
    await page.goto("/reservation-applications"); await expect(page.getByRole("alert")).toContainText("신청을 불러오지 못했습니다");
    await expect(page.getByRole("button", { name: "재시도", exact: true })).toBeVisible();
    await expect(page.getByText("접수된 신청이 없습니다", { exact: true })).toHaveCount(0);
  });
});
