import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasReactHandler, observeActions, recordTag, recordPriceStates, saveClassApplicationPrice } from "../../e2e/support/integrated-ux-sync";
import { safeUxTraces } from "../../e2e/support/ux-trace";

// Use one immediate poll evaluation for negative event sequences: the test
// exercises observer correlation, not Playwright's wall-clock retry scheduler.
const { annotations } = vi.hoisted(() => ({ annotations: [] as { type: string; description: string }[] }));
vi.mock("@playwright/test", async () => {
  const { expect: assertion } = await import("vitest");
  const mockExpect = Object.assign((value: unknown, message?: string) => Object.assign(assertion(value, message), {
    toHaveText: async (expected: string) => assertion(await (value as { textContent(): Promise<string> }).textContent(), message).toBe(expected),
    toHaveValue: async (expected: string) => assertion(await (value as { inputValue(): Promise<string> }).inputValue(), message).toBe(expected),
    toBeVisible: async () => assertion(await (value as { isVisible(): Promise<boolean> }).isVisible(), message).toBe(true),
  }), {
    poll: (predicate: () => unknown, options: { message?: string }) => ({
      toBe: async (expected: unknown) => assertion(await predicate(), options.message).toBe(expected),
    }),
  });
  return { expect: mockExpect, test: { info: () => ({ annotations }) } };
});
beforeEach(() => { annotations.length = 0; });

describe("test-only React 19 hydration readiness", () => {
  it("requires the named hydrated host handler, not SSR attributes, native handlers or unrelated React internals", () => {
    const element = { onclick: () => {}, onChange: () => {}, "__reactFiber$abc": { onClick: () => {} }, "__reactProps$abc": { onChange: () => {} } } as unknown as Element;
    expect(hasReactHandler(element, "onClick")).toBe(false);
    expect(hasReactHandler(element, "onChange")).toBe(true);
    expect(hasReactHandler({ "__reactProps$abc": { onClick: "not-a-function" } } as unknown as Element, "onClick")).toBe(false);
    expect(hasReactHandler({ "__reactProps$abc": { onClick: () => {} } } as unknown as Element, "onClick")).toBe(true);
  });
  it("correlates run-owned record IDs using stable numeric tags without publishing the IDs", () => {
    expect(recordTag("run-application-1")).toBe(recordTag("run-application-1"));
    expect(recordTag("run-application-1")).not.toBe(recordTag("run-application-2"));
    expect(Number.isSafeInteger(recordTag("run-application-1"))).toBe(true);
    expect(recordTag(null)).toBeUndefined();
  });
});

describe("bounded safe UX trace projection", () => {
  it("retains ordered numeric/boolean facts only and drops arbitrary payloads, annotations and malformed traces", () => {
    const annotation = (value: unknown) => ({ type: "ux-trace", description: JSON.stringify(value) });
    const safe = { event: "confirmation", elapsedMs: 1, facts: { requests: 2, current: true, applicationTag: recordTag("run-application-1") } };
    expect(safeUxTraces([
      annotation(safe),
      annotation({ ...safe, facts: { guardianName: "PII_CANARY" } }),
      annotation({ ...safe, facts: { requests: "TOKEN_CANARY" } }),
      annotation({ ...safe, facts: { abortedAfterResponse: -1 } }),
      annotation({ ...safe, facts: { abortedAfterResponse: "TOKEN_CANARY" } }),
      annotation({ ...safe, facts: { lostResponses: 0.5 } }),
      annotation({ ...safe, capability: "SECRET_CANARY" }),
      annotation({ ...safe, event: "ARBITRARY_CANARY" }),
      { type: "ux-trace", description: "MALFORMED_CANARY" },
      { type: "other", description: JSON.stringify(safe) },
    ])).toEqual([safe]);
    expect(safeUxTraces(Array.from({ length: 100 }, () => annotation(safe)))).toHaveLength(50);
  });
});


describe("Server Action response observation is separate from application receipt readiness", () => {
  function harness() {
    const page = Object.assign(new EventEmitter(), { url: () => "http://127.0.0.1:3000/classes/run-owned" });
    const observation = observeActions(page as unknown as Page, "class-price");
    const request = (overrides: { method?: string; pathname?: string; headers?: Record<string, string> } = {}) => ({
      method: () => overrides.method ?? "POST",
      url: () => `http://127.0.0.1:3000${overrides.pathname ?? "/classes/run-owned"}`,
      headers: () => overrides.headers ?? { "next-action": "synthetic-action" },
    }) as unknown as Request;
    const respond = (item: Request, status = 200) => page.emit("response", {
      request: () => item, ok: () => status >= 200 && status < 300, status: () => status,
    } as unknown as Response);
    return { page, observation, request, respond };
  }
  it("accepts an observed response with the stream still open; does not manufacture requestfinished or UI receipt", async () => {
    const { page, observation, request, respond } = harness();
    const action = request(); page.emit("request", action); respond(action);
    await observation.settled();
    const facts = safeUxTraces(annotations).at(-1)!.facts;
    expect(facts).toMatchObject({ requests: 1, responses: 1, finished: 0, failed: 0 });
    expect(facts.current).toBeUndefined();
    expect(facts.receiptVisible).toBeUndefined();
    observation.stop();
    expect(page.eventNames()).toEqual([]);
  });
  it("rejects a missing/lost action response and never sends an action or auto-retries", async () => {
    const { page, observation, request } = harness();
    page.emit("request", request());
    await expect(observation.settled()).rejects.toThrow("every observed action received response headers");
    expect(observation.count()).toBe(1);
    expect(safeUxTraces(annotations).at(-1)!.facts.responses).toBe(0);
    observation.stop();
  });
  it("requires a response for every duplicate-prevention action, even if their headers arrive out of order", async () => {
    const { page, observation, request, respond } = harness();
    const first = request(); const second = request();
    page.emit("request", first); page.emit("request", second); respond(second);
    await expect(observation.settled(2)).rejects.toThrow();
    respond(first); await observation.settled(2);
    expect(observation.count()).toBe(2);
    observation.stop();
  });
  it("records a failure after this request's HTTP 200 without declaring its application outcome verified", async () => {
    const { page, observation, request, respond } = harness();
    const action = request(); page.emit("request", action); respond(action);
    await observation.settled();
    // A stream may fail after headers have already satisfied settled().
    page.emit("requestfailed", action);
    await observation.settled();
    const facts = safeUxTraces(annotations).at(-1)!.facts;
    expect(facts).toMatchObject({ requests: 1, responses: 1, finished: 0, failed: 1, abortedAfterResponse: 1, lostResponses: 0, httpOk: true });
    expect(facts.receiptVisible).toBeUndefined(); expect(facts.current).toBeUndefined();
    observation.stop();
    const recorded = annotations.length;
    page.emit("requestfailed", action); respond(action); page.emit("requestfinished", action);
    expect(annotations).toHaveLength(recorded); expect(page.eventNames()).toEqual([]);
  });
  it("rejects requestfailed without a response and records the loss", async () => {
    const { page, observation, request } = harness();
    const action = request(); page.emit("request", action); page.emit("requestfailed", action);
    await expect(observation.settled()).rejects.toThrow("every observed action received response headers");
    expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ requests: 1, responses: 0, failed: 1, abortedAfterResponse: 0, lostResponses: 1 });
    observation.stop();
  });
  it.each([201, 204, 302, 400, 500])("rejects HTTP %s even when headers were seen, with or without requestfailed", async (status) => {
    for (const withFailure of [false, true]) {
      const { page, observation, request, respond } = harness();
      const action = request(); page.emit("request", action); respond(action, status);
      if (withFailure) page.emit("requestfailed", action);
      await expect(observation.settled()).rejects.toThrow("no observed action transport failure");
      expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ responses: 1, failed: withFailure ? 1 : 0, abortedAfterResponse: 0, lostResponses: 1, httpOk: false });
      expect(safeUxTraces(annotations).some((trace) => trace.facts.httpStatus === status)).toBe(true);
      observation.stop();
    }
  });
  it("does not let one request's HTTP 200 mask another request's missing response", async () => {
    const { page, observation, request, respond } = harness();
    const delivered = request(); const lost = request();
    page.emit("request", delivered); page.emit("request", lost); respond(delivered);
    page.emit("requestfailed", delivered); page.emit("requestfailed", lost);
    await expect(observation.settled(2)).rejects.toThrow("every observed action received response headers");
    expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ requests: 2, responses: 1, failed: 2, abortedAfterResponse: 1, lostResponses: 1 });
    observation.stop();
  });
  it("never reclassifies a pre-response failure as a post-response abort when a late HTTP 200 arrives", async () => {
    const { page, observation, request, respond } = harness();
    const action = request(); page.emit("request", action); page.emit("requestfailed", action);
    respond(action); page.emit("requestfailed", action);
    await expect(observation.settled()).rejects.toThrow("no observed action transport failure");
    expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ responses: 1, failed: 1, abortedAfterResponse: 0, lostResponses: 1 });
    observation.stop();
  });
  it("keeps authoritative-read transport diagnostics separate and ignores prefetch/unrelated requests", async () => {
    const { page, observation, request, respond } = harness();
    for (const unrelated of [request({ pathname: "/other" }), request({ headers: {} }),
      request({ method: "GET", headers: { rsc: "1", "next-router-prefetch": "1" } })]) {
      page.emit("request", unrelated); respond(unrelated); page.emit("requestfinished", unrelated);
    }
    const refresh = request({ method: "GET", headers: { rsc: "1" } });
    page.emit("request", refresh); respond(refresh); page.emit("requestfinished", refresh);
    expect(observation.count()).toBe(0);
    await expect(observation.settled()).rejects.toThrow();
    const action = request(); page.emit("request", action); respond(action); await observation.settled();
    expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ requests: 1, responses: 1, finished: 0, reads: 1, readResponses: 1, readFinished: 1 });
    observation.stop();
  });
});

describe("post-response aborts preserve the existing price receipt and read-back path", () => {
  function priceFlow(options: { receipt?: boolean; displayed?: boolean; stored?: number } = {}) {
    let value = "";
    const action = { method: () => "POST", url: () => "http://127.0.0.1:3000/classes/run-owned", headers: () => ({ "next-action": "PRIVATE_ACTION_CANARY" }) } as unknown as Request;
    const status = { filter: () => status, textContent: async () => options.receipt === false ? "저장 중" : "신청금액을 저장했습니다." };
    const displayed = { isVisible: async () => options.displayed !== false };
    const input = {
      evaluate: async () => true, locator: () => ({ evaluate: async () => true }),
      fill: async (next: string) => { value = next; }, inputValue: async () => value, isDisabled: async () => false,
    };
    const button = { click: async () => {
      page.emit("request", action);
      page.emit("response", { request: () => action, status: () => 200 } as unknown as Response);
      page.emit("requestfailed", action);
    } };
    const card = {
      getByRole: (role: string) => role === "spinbutton" ? input : role === "button" ? button : role === "status" ? status : { count: async () => 0 },
      getByText: () => displayed,
    };
    const page = Object.assign(new EventEmitter(), {
      url: () => "http://127.0.0.1:3000/classes/run-owned",
      getByTestId: () => card,
      request: { get: async () => ({ ok: () => true, text: async () => "<p>참가비: 25,000원</p>" }) },
    });
    const readStored = vi.fn(async () => options.stored ?? 25000);
    // Keep the real helper's receipt/live-card assertions, followed by the
    // caller-owned authoritative read-back assertion. The observer owns neither.
    const verify = async () => {
      await saveClassApplicationPrice(page as unknown as Page, 25000, readStored);
      expect(await readStored(), "authoritative stored price").toBe(25000);
    };
    return { page, verify, readStored };
  }
  it("passes the verified UI/read-back flow while retaining failed and abortedAfterResponse facts", async () => {
    const { page, verify, readStored } = priceFlow();
    await verify();
    expect(readStored).toHaveBeenCalledTimes(2);
    expect(safeUxTraces(annotations).some(({ facts }) => facts.failed === 1 && facts.abortedAfterResponse === 1 && facts.lostResponses === 0)).toBe(true);
    expect(safeUxTraces(annotations).at(-1)!.facts).toMatchObject({ storedPrice: 25000, serverPriceMatches: true, displayedPrice: true, savePending: false });
    expect(JSON.stringify(annotations)).not.toContain("PRIVATE_ACTION_CANARY");
    expect(page.eventNames()).toEqual([]);
  });
  it.each([
    { receipt: false },
    { displayed: false },
    { stored: 24000 },
  ])("does not rescue incomplete receipt, live display or authoritative read-back: %j", async (options) => {
    const { page, verify } = priceFlow(options);
    await expect(verify()).rejects.toThrow();
    // Only the delivered transport is classified; no product-success fact is
    // invented, and the existing helper/caller assertion still rejects the flow.
    expect(safeUxTraces(annotations).some(({ facts }) => facts.failed === 1 && facts.abortedAfterResponse === 1 && facts.lostResponses === 0)).toBe(true);
    expect(page.eventNames()).toEqual([]);
  });
});

describe("three-state assertion-time price diagnostics", () => {
  it("separates persisted, fresh HTML and stale live state without reloading or exposing response data", async () => {
    const get = vi.fn(async () => ({ ok: () => true, text: async () => '<p>참가비: <!-- -->25,000<!-- -->원</p><script>PRIVATE_CANARY</script>' }));
    const page = { url: () => "http://127.0.0.1:3000/classes/run-owned", request: { get } } as unknown as Page;
    await recordPriceStates(page, { event: "class-price", amount: 25000, readStored: async () => 25000, liveFacts: async () => ({ displayedPrice: false }) });
    expect(get).toHaveBeenCalledWith("/classes/run-owned", { timeout: 5000 });
    expect(safeUxTraces(annotations)[0].facts).toEqual({ priceSnapshot: true, requestedPrice: 25000, storedPrice: 25000, displayedPrice: false, serverPriceMatches: true });
    expect(JSON.stringify(annotations)).not.toContain("PRIVATE_CANARY");
  });
  it("identifies the expected initial null price independently of the later requested amount", async () => {
    const page = { request: { get: async () => ({ ok: () => true, text: async () => "<p>참가비: 미설정</p>" }) } } as unknown as Page;
    await recordPriceStates(page, { event: "class-price", amount: null, serverPath: "/classes/run-owned", readStored: async () => null, liveFacts: async () => ({ displayedPrice: true }) });
    expect(safeUxTraces(annotations)[0].facts).toEqual({ priceSnapshot: true, priceUnsetExpected: true, storedPrice: null, serverPriceMatches: true, displayedPrice: true });
    expect(safeUxTraces(annotations)[0].facts.requestedPrice).toBeUndefined();
  });
  it("does not mistake RSC script content or HTTP errors for a fresh rendered price", async () => {
    for (const ok of [true, false]) {
      const page = { request: { get: async () => ({ ok: () => ok, text: async () => '<script>참가비: 25,000원</script><p>참가비: 미설정</p>' }) } } as unknown as Page;
      await recordPriceStates(page, { event: "class-price", amount: 25000, serverPath: "/classes/run-owned", readStored: async () => null, liveFacts: async () => ({ displayedPrice: false }) });
      const facts = safeUxTraces(annotations).at(-1)!.facts;
      expect(facts.storedPrice).toBeNull();
      if (ok) expect(facts.serverPriceMatches).toBe(false);
      else { expect(facts.serverPriceReadFailed).toBe(true); expect(facts.serverPriceMatches).toBeUndefined(); }
    }
  });
  it("keeps failed states unknown independently and still preserves available states", async () => {
    const page = { request: { get: async () => { throw new Error("PRIVATE_CANARY"); } } } as unknown as Page;
    await recordPriceStates(page, { event: "guardian-review", amount: 70000, serverPath: "/apply/group/PRIVATE_CANARY", readStored: async () => { throw new Error("DB_CANARY"); }, liveFacts: async () => ({ displayedPrice: true }) });
    expect(safeUxTraces(annotations)[0].facts).toEqual({ priceSnapshot: true, requestedPrice: 70000, storedPriceReadFailed: true, serverPriceReadFailed: true, displayedPrice: true });
    expect(JSON.stringify(annotations)).not.toMatch(/PRIVATE_CANARY|DB_CANARY/);
  });
  it("retains final price snapshots after noisy transport exceeds the annotation budget", () => {
    const transport = { type: "ux-trace", description: JSON.stringify({ event: "class-price", elapsedMs: 0, facts: { requests: 1 } }) };
    const snapshot = { event: "guardian-review", elapsedMs: 1, facts: { priceSnapshot: true, requestedPrice: 70000, storedPrice: 70000, serverPriceMatches: true, displayedPrice: false } };
    const projected = safeUxTraces([...Array.from({ length: 70 }, () => transport), { type: "ux-trace", description: JSON.stringify(snapshot) }]);
    expect(projected).toHaveLength(50); expect(projected.at(-1)).toEqual(snapshot);
  });
});
