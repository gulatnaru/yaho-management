import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasReactHandler, observeActions, recordTag, recordPriceStates } from "../../e2e/support/integrated-ux-sync";
import { safeUxTraces } from "../../e2e/support/ux-trace";

// Use one immediate poll evaluation for negative event sequences: the test
// exercises observer correlation, not Playwright's wall-clock retry scheduler.
const { annotations } = vi.hoisted(() => ({ annotations: [] as { type: string; description: string }[] }));
vi.mock("@playwright/test", async () => {
  const { expect: assertion } = await import("vitest");
  const mockExpect = Object.assign((value: unknown, message?: string) => assertion(value, message), {
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
  it("rejects HTTP failures and failed transports even when response headers were seen", async () => {
    for (const status of [200, 500]) {
      const { page, observation, request, respond } = harness();
      const action = request(); page.emit("request", action); respond(action, status);
      if (status === 200) page.emit("requestfailed", action);
      await expect(observation.settled()).rejects.toThrow(status === 200 ? "transport failure" : "HTTP responses succeeded");
      observation.stop();
    }
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
