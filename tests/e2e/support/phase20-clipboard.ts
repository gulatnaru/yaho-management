import { appendFileSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { PHASE20_PREVIEW_RUN_ID_PATTERN } from "@/lib/e2e/phase20-lease";
import { assertPreviewE2eRunnerProof } from "@/lib/e2e/preview-runner";
import { clipboardVerificationRecords, assertClipboardVerification } from "@/lib/e2e/clipboard-verification";

function assertClipboardScope(): string {
  const runId = process.env.YAHO_E2E_RUN_ID ?? "";
  if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1" || !PHASE20_PREVIEW_RUN_ID_PATTERN.test(runId) || path.resolve(test.info().file) !== path.resolve("tests/e2e/phase20-application-finance-returns.spec.ts")) throw new Error("P20_CLIPBOARD_SCOPE_DENIED");
  assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
  return runId;
}

/** Observe native completion before navigation without changing clipboard behavior. */
export async function installClipboardVerification(page: Page): Promise<void> {
  assertClipboardScope();
  await page.addInitScript(() => {
    if (location.pathname !== "/apply/complete" || !navigator.clipboard) return;
    type Attempt = { ordinal: number; readyStateAtClick: DocumentReadyState; focusAtClick: boolean; clickSeen: boolean; called: number; resolved: number; rejected: number; callMs: number | null; settleMs: number | null; focusAtCall: boolean; focusAtSettle: boolean; statusBefore: boolean; successSeen: boolean; errorSeen: boolean; statusMs: number | null; started: number };
    const attempts: Attempt[] = [];
    let current: Attempt | undefined;
    const elapsed = (item: Attempt) => Math.min(15_000, Math.round(performance.now() - item.started));
    const clipboard = navigator.clipboard;
    const descriptor = Object.getOwnPropertyDescriptor(clipboard, "writeText");
    const original = clipboard.writeText;
    clipboard.writeText = function (this: Clipboard, ...args: Parameters<Clipboard["writeText"]>) {
      const item = current;
      if (item) { item.called += 1; item.callMs = elapsed(item); item.focusAtCall = document.hasFocus(); }
      let promise: Promise<void>;
      try { promise = original.apply(this, args); } catch (error) { if (item) { item.rejected += 1; item.settleMs = elapsed(item); } throw error; }
      void promise.then(() => { if (item) { item.resolved += 1; item.settleMs = elapsed(item); item.focusAtSettle = document.hasFocus(); } }, () => { if (item) { item.rejected += 1; item.settleMs = elapsed(item); item.focusAtSettle = document.hasFocus(); } });
      return promise;
    };
    const click = (event: Event) => {
      const text = (event.target as Element | null)?.closest("button")?.textContent?.trim();
      const ordinal = ["계좌번호 복사", "금액 복사", "입금자명 복사"].indexOf(text ?? "") + 1;
      if (!ordinal || attempts.length >= 4) return;
      current = { ordinal, readyStateAtClick: document.readyState, focusAtClick: document.hasFocus(), clickSeen: true, called: 0, resolved: 0, rejected: 0, callMs: null, settleMs: null, focusAtCall: false, focusAtSettle: false, statusBefore: document.querySelector('[role="status"]') !== null, successSeen: false, errorSeen: false, statusMs: null, started: performance.now() };
      attempts.push(current);
    };
    const observer = new MutationObserver(() => {
      if (!current) return;
      const text = document.querySelector('[role="status"]')?.textContent?.trim();
      if (text === "복사했습니다.") { current.successSeen = true; current.statusMs = elapsed(current); }
      if (text === "복사하지 못했습니다. 길게 눌러 복사해주세요.") { current.errorSeen = true; current.statusMs = elapsed(current); }
    });
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", click, true);
    (window as typeof window & { __p20ClipboardProbe?: { read: () => object[]; stop: () => void } }).__p20ClipboardProbe = {
      read: () => attempts.map((item) => ({ ordinal: item.ordinal, readyStateAtClick: item.readyStateAtClick, focusAtClick: item.focusAtClick, clickSeen: item.clickSeen, called: item.called, resolved: item.resolved, rejected: item.rejected, callMs: item.callMs, settleMs: item.settleMs, focusAtCall: item.focusAtCall, focusAtSettle: item.focusAtSettle, statusBefore: item.statusBefore, successSeen: item.successSeen, errorSeen: item.errorSeen, statusMs: item.statusMs, pending: item.called > item.resolved + item.rejected, readyStateAtRead: document.readyState, focusAtRead: document.hasFocus() })),
      stop: () => { observer.disconnect(); document.removeEventListener("click", click, true); if (descriptor) Object.defineProperty(clipboard, "writeText", descriptor); else delete (clipboard as Partial<Clipboard>).writeText; delete (window as typeof window & { __p20ClipboardProbe?: unknown }).__p20ClipboardProbe; },
    };
  });
}

export async function finishClipboardVerification(page: Page): Promise<void> {
  const runId = assertClipboardScope();
  const attempts = await page.evaluate(() => {
    const probe = (window as typeof window & { __p20ClipboardProbe?: { read: () => object[]; stop: () => void } }).__p20ClipboardProbe;
    if (!probe) return [];
    try { return probe.read(); } finally { probe.stop(); }
  });
  const records = clipboardVerificationRecords(attempts);
  appendFileSync(path.resolve("test-results", `preview-e2e-${runId}.safe-clipboard.jsonl`), records.map((item) => JSON.stringify(item)).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  assertClipboardVerification(records);
}

