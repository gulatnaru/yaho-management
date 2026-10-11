import type { Page } from "@playwright/test";

export async function observeDepositPending(page: Page, nonce: string): Promise<void> {
  await page.evaluate((key) => {
    const target = window as typeof window & { __p20DepositState?: { pendingSeen: boolean; settled: boolean }; __p20DepositObserver?: MutationObserver };
    const form = Array.from(document.querySelectorAll<HTMLFormElement>("form")).find((item) => item.querySelector<HTMLInputElement>('input[name="idempotencyKey"]')?.value === key);
    if (!form || target.__p20DepositObserver) throw new Error("P20_DEPOSIT_OBSERVER_SCOPE_DENIED");
    const state = { pendingSeen: false, settled: false };
    target.__p20DepositState = state;
    const observer = new MutationObserver(() => {
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button?.disabled && button.textContent?.trim() === "기록 중...") state.pendingSeen = true;
      if (state.pendingSeen && button && !button.disabled && button.textContent?.trim() === "실제 입금 기록") state.settled = true;
    });
    observer.observe(form, { subtree: true, childList: true, attributes: true, characterData: true });
    target.__p20DepositObserver = observer;
  }, nonce);
}
export async function readDepositPending(page: Page): Promise<{ pendingSeen: boolean; settled: boolean }> {
  return page.evaluate(() => { const state = (window as typeof window & { __p20DepositState?: { pendingSeen: boolean; settled: boolean } }).__p20DepositState; return { pendingSeen: state?.pendingSeen === true, settled: state?.settled === true }; });
}
export async function stopDepositPending(page: Page): Promise<void> {
  await page.evaluate(() => { const target = window as typeof window & { __p20DepositState?: unknown; __p20DepositObserver?: MutationObserver }; target.__p20DepositObserver?.disconnect(); delete target.__p20DepositObserver; delete target.__p20DepositState; });
}
