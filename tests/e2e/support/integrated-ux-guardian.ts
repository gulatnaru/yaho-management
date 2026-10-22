import { expect, type Page } from "@playwright/test";
import { observeActions, traceUx, waitForReactHandler } from "./integrated-ux-sync";
/** Navigate the real three input steps. This helper never submits or changes test admission. */
export async function enterGuardianInformation(page: Page, selectAllCandidates = true) {
  await expect(page.getByText("3단계 중 1단계", { exact: false })).toBeVisible();
  const next = page.getByRole("button", { name: "다음", exact: true });
  await waitForReactHandler(next, "onClick");
  const candidates = page.locator("#application-classes").getByRole("checkbox");
  await expect(page.locator("#application-classes article").first()).toBeVisible();
  const count = await candidates.count();
  if (selectAllCandidates) for (let index = 0; index < count; index++) {
    await candidates.nth(index).check(); await expect(candidates.nth(index)).toBeChecked();
  }
  traceUx("guardian-review", Date.now(), { hydrated: true, candidates: count, selectedCandidates: await page.locator("#application-classes input:checked").count() });
  await next.click();
  await expect(page.getByText("3단계 중 2단계", { exact: false })).toBeVisible();
}
export async function enterConsentReview(page: Page) {
  const action = observeActions(page, "guardian-review");
  try {
    if (!await page.getByText("3단계 중 3단계", { exact: false }).isVisible()) await page.getByRole("button", { name: "다음", exact: true }).click();
    await expect(page.getByText("3단계 중 3단계", { exact: false })).toBeVisible();
    // Changed-review keeps Submit disabled by design. The enclosing fieldset
    // becomes enabled only after next()'s async checkPrices/finally completes.
    await expect(page.locator("form > fieldset")).toBeEnabled();
    if (action.count()) await action.settled();
    action.mark({ current: true });
  } finally { action.mark(); action.stop(); }
}
export async function acceptGuardianConsents(page: Page) {
  for (const checkbox of await page.getByTestId("application-consents").getByRole("checkbox").all()) await checkbox.check();
}
