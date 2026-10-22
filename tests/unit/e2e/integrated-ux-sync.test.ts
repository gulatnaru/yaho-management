import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasReactHandler, observeActions, recordTag } from "../../e2e/support/integrated-ux-sync";
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
