import { expect, type Page } from "@playwright/test";
import { recordPriceStates, observeActions, traceUx, waitForReactHandler } from "./integrated-ux-sync";
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

/** Capture all three independent price states at each exact guardian assertion. */
export async function recordGuardianPriceStates(page: Page, options: {
  amount: number; total: number; previous?: { amount: number; total: number };
  summaryAmount: number; summaryTotal: number; serverPath: string; readStored: () => Promise<number | null>;
}) {
  const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
  await recordPriceStates(page, { event: "guardian-review", amount: options.amount, readStored: options.readStored,
    serverPath: options.serverPath, serverPriceText: won(options.amount),
    facts: { summaryExpectedPrice: options.summaryAmount, summaryExpectedTotal: options.summaryTotal, expectedTotal: options.total, previousPrice: options.previous?.amount, previousTotal: options.previous?.total },
    liveFacts: async () => {
      const summary = page.getByRole("complementary", { name: "신청 요약", exact: true });
      const review = page.locator("#application-reviewedPriceProof");
      const reviewText = await review.count() ? await review.innerText() : "";
      const summaryText = await summary.count() ? await summary.innerText() : "";
      return { displayedPrice: (await page.locator("body").innerText()).includes(won(options.amount)),
        summaryPriceMatches: summaryText.includes(won(options.summaryAmount)),
        summaryTotalMatches: summaryText.includes(`예상 총 참가비 ${won(options.summaryTotal)}`),
        priceChangeVisible: options.previous ? reviewText.includes(`${won(options.previous.amount)} → ${won(options.amount)}`) : false,
        totalVisible: options.previous ? reviewText.includes(`${won(options.previous.total)} → ${won(options.total)}`) : summaryText.includes(`예상 총 참가비 ${won(options.total)}`) };
    } });
}
