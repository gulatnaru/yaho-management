import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { createHash } from "node:crypto";
import type { UxTrace } from "./ux-trace";

export function traceUx(event: UxTrace["event"], started: number, facts: UxTrace["facts"]) {
  test.info().annotations.push({ type: "ux-trace", description: JSON.stringify({ event, elapsedMs: Date.now() - started, facts } satisfies UxTrace) });
}

/** Correlate only run-owned record identities, never capability values or PII. */
export function recordTag(id: string | null | undefined) {
  return id ? Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 12), 16) : undefined;
}

export function hasReactHandler(element: Element, name: string): boolean {
  return Object.entries(element).some(([key, value]) => key.startsWith("__reactProps$") && value && typeof value[name] === "function");
}

/** SSR visibility/load is insufficient for controlled inputs or a Next Link.
 * React 19 attaches these host props during hydration. Test-only readiness check;
 * it neither calls a handler nor dispatches/replays an action. */
export async function waitForReactHandler(locator: Locator, handler: "onClick" | "onChange" | "onSubmit") {
  await expect.poll(() => locator.evaluate(hasReactHandler, handler),
  { message: `Hydrated ${handler} handler`, timeout: 10000 }).toBe(true);
}

/** Observe transport without confusing the end of an RSC stream with a receipt.
 * Callers must separately assert their authoritative UI (and DB, where relevant).
 * React can consume the action value and update that UI while the response stream
 * remains open: requestfinished is diagnostic, never the application-ready signal.
 * Likewise, requestfailed after this request's HTTP 200 is stream bookkeeping,
 * recorded as abortedAfterResponse; it cannot establish receipt/read-back success.
 * No action is invoked or retried by this observer. */
export function observeActions(page: Page, event: "deposit" | "confirmation" | "class-price" | "guardian-review" | "class-link-fixture") {
  const started = Date.now();
  const pathname = new URL(page.url()).pathname;
  const requests = new Set<Request>(); const responses = new Map<Request, number>(); const finished = new Set<Request>();
  const failed = new Set<Request>(); const abortedAfterResponse = new Set<Request>();
  const reads = new Set<Request>(); const readResponses = new Set<Request>(); const readFinished = new Set<Request>(); const readFailed = new Set<Request>();
  let httpOk = true;
  const lostResponses = () => [...requests].filter((item) => responses.get(item) !== 200 || (failed.has(item) && !abortedAfterResponse.has(item))).length;
  const mark = (facts: UxTrace["facts"] = {}) => traceUx(event, started, { requests: requests.size, responses: responses.size, finished: finished.size, failed: failed.size, abortedAfterResponse: abortedAfterResponse.size, lostResponses: lostResponses(), reads: reads.size, readResponses: readResponses.size, readFinished: readFinished.size, readFailed: readFailed.size, httpOk, ...facts });
  const request = (item: Request) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === pathname && item.headers()["next-action"]) {
      requests.add(item); mark({ requestOrdinal: requests.size });
    } else if (item.method() === "GET" && new URL(item.url()).pathname === pathname && item.headers().rsc === "1" && !item.headers()["next-router-prefetch"]) {
      reads.add(item); mark();
    }
  };
  const response = (item: import("@playwright/test").Response) => {
    if (reads.has(item.request())) { readResponses.add(item.request()); mark({ readHttpStatus: item.status() }); }
    if (!requests.has(item.request())) return;
    responses.set(item.request(), item.status()); httpOk &&= item.status() === 200;
    mark({ responseOrdinal: [...requests].indexOf(item.request()) + 1, httpStatus: item.status() });
  };
  const complete = (item: Request) => {
    if (reads.has(item)) { readFinished.add(item); mark(); }
    if (requests.has(item)) { finished.add(item); mark({ finishedOrdinal: [...requests].indexOf(item) + 1 }); }
  };
  const fail = (item: Request) => {
    if (reads.has(item)) { readFailed.add(item); mark(); }
    if (requests.has(item)) {
      // Capture event order as well as request identity: a later response must not
      // retroactively turn a pre-response failure into a post-response abort.
      if (!failed.has(item) && responses.get(item) === 200) abortedAfterResponse.add(item);
      failed.add(item); mark();
    }
  };
  page.on("request", request); page.on("response", response); page.on("requestfinished", complete); page.on("requestfailed", fail);
  return {
    count() { return requests.size; },
    mark,
    async settled(minimum = 1) {
      await expect.poll(() => requests.size >= minimum && responses.size === requests.size,
        { message: `${event}: every observed action received response headers (UI receipt asserted separately)`, timeout: 15000 }).toBe(true);
      expect(lostResponses(), `${event}: no observed action transport failure`).toBe(0);
      expect(httpOk, `${event}: action HTTP responses succeeded`).toBe(true);
    },
    stop() { page.off("request", request); page.off("response", response); page.off("requestfinished", complete); page.off("requestfailed", fail); },
  };
}

/** Fresh HTTP is separate from the live DOM; no bodies or capability paths escape.
 * Each read fails independently, so an unavailable state cannot look stale. */
export async function recordPriceStates(page: Page, options: {
  event: "class-price" | "guardian-review";
  amount: number | null;
  readStored?: () => Promise<number | null>;
  liveFacts: () => Promise<UxTrace["facts"]>;
  serverPath?: string;
  serverPriceText?: string;
  facts?: UxTrace["facts"];
}) {
  const started = Date.now();
  const facts: UxTrace["facts"] = { ...options.facts, priceSnapshot: true, ...(options.amount === null ? { priceUnsetExpected: true } : { requestedPrice: options.amount }) };
  try { Object.assign(facts, await options.liveFacts()); }
  catch { facts.livePriceReadFailed = true; }
  if (options.readStored) {
    try { facts.storedPrice = await options.readStored(); }
    catch { facts.storedPriceReadFailed = true; }
  }
  try {
    const response = await page.request.get(options.serverPath ?? new URL(page.url()).pathname, { timeout: 5000 });
    if (!response.ok()) facts.serverPriceReadFailed = true;
    else {
      const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
      facts.serverPriceMatches = html.includes(options.serverPriceText ?? (options.amount === null ? "참가비: 미설정" : `참가비: ${options.amount.toLocaleString("ko-KR")}원`));
    }
  } catch { facts.serverPriceReadFailed = true; }
  traceUx(options.event, started, facts);
}

export async function saveClassApplicationPrice(page: Page, amount: number, readStored?: () => Promise<number | null>) {
  const card = page.getByTestId("application-link-card");
  const input = card.getByRole("spinbutton", { name: "신청금액 설정 (원)", exact: true });
  await waitForReactHandler(input, "onChange");
  const form = input.locator("xpath=ancestor::form");
  await waitForReactHandler(form, "onSubmit");
  const action = observeActions(page, "class-price");
  try {
    action.mark({ hydrated: true, requestedPrice: amount });
    await input.fill(String(amount)); await expect(input).toHaveValue(String(amount));
    await card.getByRole("button", { name: "신청금액 저장", exact: true }).click();
    action.mark({ clicked: true, requestedPrice: amount });
    await expect(card.getByRole("status").filter({ hasText: /^신청금액을 저장했습니다\.$/ })).toHaveText("신청금액을 저장했습니다.");
    await action.settled();
    // The success notice precedes router.refresh(). Require the server projection,
    // without remount/reload that could conceal an actual stale display defect.
    await expect(card.getByText(`참가비: ${amount.toLocaleString("ko-KR")}원`, { exact: true })).toBeVisible();
    await expect(input).toHaveValue(String(amount));
    action.mark({ displayedPrice: true });
  } finally {
    action.stop();
    await recordPriceStates(page, { event: "class-price", amount, readStored, liveFacts: async () => ({
      savePending: await input.isDisabled(),
      displayedPrice: await card.getByText(`참가비: ${amount.toLocaleString("ko-KR")}원`, { exact: true }).isVisible(),
      alertCount: await card.getByRole("alert").count(),
    }) });
  }
}
