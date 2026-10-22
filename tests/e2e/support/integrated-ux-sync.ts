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

/** Observe the action and its subsequent authoritative read without reading bodies.
 * The receipt-specific UI is the authoritative completion signal; HTTP 200 alone
 * cannot distinguish a successful Server Action from a returned domain error. */
export function observeActions(page: Page, event: "deposit" | "confirmation" | "class-price" | "guardian-review" | "class-link-fixture") {
  const started = Date.now();
  const pathname = new URL(page.url()).pathname;
  const requests = new Set<Request>(); const responses = new Set<Request>(); const finished = new Set<Request>();
  let httpOk = true;
  const mark = (facts: UxTrace["facts"] = {}) => traceUx(event, started, { requests: requests.size, responses: responses.size, finished: finished.size, httpOk, ...facts });
  const request = (item: Request) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === pathname && item.headers()["next-action"]) {
      requests.add(item); mark({ requestOrdinal: requests.size });
    }
  };
  const response = (item: import("@playwright/test").Response) => {
    if (!requests.has(item.request())) return;
    responses.add(item.request()); httpOk &&= item.ok();
    mark({ responseOrdinal: [...requests].indexOf(item.request()) + 1, httpStatus: item.status() });
  };
  const complete = (item: Request) => { if (requests.has(item)) { finished.add(item); mark({ finishedOrdinal: [...requests].indexOf(item) + 1 }); } };
  page.on("request", request); page.on("response", response); page.on("requestfinished", complete);
  return {
    count() { return requests.size; },
    mark,
    async settled(minimum = 1) {
      await expect.poll(() => requests.size >= minimum && finished.size === requests.size && responses.size === requests.size,
        { message: `${event}: action response and authoritative read completed`, timeout: 15000 }).toBe(true);
      expect(httpOk).toBe(true);
    },
    stop() { page.off("request", request); page.off("response", response); page.off("requestfinished", complete); },
  };
}

export async function saveClassApplicationPrice(page: Page, amount: number) {
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
    action.mark({ clicked: true });
    await expect(card.getByRole("status")).toHaveText("신청금액을 저장했습니다.");
    await action.settled();
    // The success notice precedes router.refresh(). Require the server projection,
    // without remount/reload that could conceal an actual stale display defect.
    await expect(card.getByText(`참가비: ${amount.toLocaleString("ko-KR")}원`, { exact: true })).toBeVisible();
    await expect(input).toHaveValue(String(amount));
    action.mark({ displayedPrice: true });
  } finally { action.mark(); action.stop(); }
}
