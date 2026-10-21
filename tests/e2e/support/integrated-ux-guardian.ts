import { expect, type Page } from "@playwright/test";
/** Navigate the real three input steps. This helper never submits or changes test admission. */
export async function enterGuardianInformation(page: Page, selectAllCandidates = true) {
  await expect(page.getByText("3단계 중 1단계", { exact: false })).toBeVisible();
  if (selectAllCandidates) for (const candidate of await page.getByRole("checkbox").all()) await candidate.check();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("3단계 중 2단계", { exact: false })).toBeVisible();
}
export async function enterConsentReview(page: Page) {
  if (!await page.getByText("3단계 중 3단계", { exact: false }).isVisible()) await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("3단계 중 3단계", { exact: false })).toBeVisible();
}
export async function acceptGuardianConsents(page: Page) {
  for (const checkbox of await page.getByTestId("application-consents").getByRole("checkbox").all()) await checkbox.check();
}
