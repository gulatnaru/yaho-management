import { expect, test } from "@playwright/test";

test.describe("Phase 6 관리자 접근 경계", () => {
  test("비인증 사용자는 아동 안전정보 화면에 접근할 수 없다", async ({ page }) => {
    await page.goto("/children/phase6-e2e-placeholder/safety");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "운영자 로그인" })).toBeVisible();
  });

  test("비인증 사용자는 클래스 참여자 화면에 접근할 수 없다", async ({ page }) => {
    await page.goto("/classes/phase6-e2e-placeholder");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "운영자 로그인" })).toBeVisible();
  });
});
