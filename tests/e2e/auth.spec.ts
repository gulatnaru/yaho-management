import { expect, test } from "@playwright/test";

test("redirects an unauthenticated visitor to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "운영자 로그인" })).toBeVisible();
});
