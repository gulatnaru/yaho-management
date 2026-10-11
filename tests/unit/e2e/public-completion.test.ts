import { describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { classifyPublicCompletionFailure, submitAndExpectPublicCompletion, type CompletionEvent } from "@/tests/e2e/support/public-completion";

function browserScenario(input: { renderAt?: number; headingCount?: number; alertCount?: number; clickMs?: number; submitFinished?: boolean; failed?: boolean; status?: number; completionFinished?: boolean; unrelated5xx?: boolean } = {}) {
  let time = 0; let headingCount = 0;
  const handlers = new Map<string, (value: unknown) => void>();
  const emit = (event: string, value: unknown) => handlers.get(event)?.(value);
  const submit = { method: () => "POST", url: () => "https://example.test/apply/group/opaque", headers: () => ({ "next-action": "fixed" }), isNavigationRequest: () => false };
  const completion = { method: () => "GET", url: () => "https://example.test/apply/complete", headers: () => ({ "x-yaho-phase20-preview-run": "fixed" }), isNavigationRequest: () => true };
  const button = { click: vi.fn(async () => { time += input.clickMs ?? 0; emit("request", submit); }) };
  const alert = { count: async () => input.alertCount ?? 0 };
  const form = { filter: () => form, getByRole: (role: string) => role === "alert" ? alert : button };
  const heading = {
    count: async () => headingCount,
    waitFor: vi.fn(async (options: { timeout: number }) => {
      const stop = time + options.timeout;
      emit("response", { request: () => submit, status: () => input.status ?? 200 });
      if (input.unrelated5xx) emit("response", { request: () => ({}), status: () => 503 });
      if (input.failed) emit("requestfailed", submit);
      if (input.submitFinished !== false && !input.failed) emit("requestfinished", submit);
      if (input.renderAt !== undefined) {
        emit("request", completion);
        emit("response", { request: () => completion, status: () => 200 });
        if (input.completionFinished !== false) emit("requestfinished", completion);
      }
      if (input.renderAt !== undefined && input.renderAt <= stop) { time = input.renderAt; headingCount = input.headingCount ?? 1; return; }
      time = stop; headingCount = input.headingCount ?? 0;
      throw new Error("private raw browser failure should not escape");
    }),
  };
  const page = {
    on: (event: string, handler: (value: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    locator: () => form,
    getByRole: () => heading,
  } as unknown as Page;
  return { page, now: () => time, handlers, heading };
}

describe("public completion total deadline and safe failure classification", () => {
  it("accepts the measured 20.5-second completed flow and removes observers", async () => {
    const fixture = browserScenario({ renderAt: 20_487, unrelated5xx: true });
    await expect(submitAndExpectPublicCompletion(fixture.page, fixture.now)).resolves.toBeUndefined();
    expect(fixture.heading.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 30_000 });
    expect(fixture.handlers.size).toBe(0);
  });
  it("budgets click time within the same deadline and rejects rendering after 30 seconds", async () => {
    const fixture = browserScenario({ clickMs: 1_000, renderAt: 30_001 });
    await expect(submitAndExpectPublicCompletion(fixture.page, fixture.now)).rejects.toThrow("P20_PUBLIC_COMPLETION_TIMEOUT");
    expect(fixture.heading.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 29_000 });
    expect(fixture.handlers.size).toBe(0);
  });
  it.each([
    [{ failed: true }, "P20_PUBLIC_SUBMIT_REQUEST_FAILED"],
    [{ status: 503 }, "P20_PUBLIC_COMPLETION_ROUTE_5XX"],
    [{ alertCount: 1 }, "P20_PUBLIC_COMPLETION_ACTION_ALERT"],
    [{ headingCount: 2 }, "P20_PUBLIC_COMPLETION_STRICT_LOCATOR"],
    [{ submitFinished: false }, "P20_PUBLIC_SUBMIT_REQUEST_UNFINISHED"],
    [{ renderAt: 30_001, completionFinished: false }, "P20_PUBLIC_COMPLETION_REQUEST_UNFINISHED"],
  ] as const)("returns only a fixed failure code and always detaches observers", async (input, code) => {
    const fixture = browserScenario(input);
    await expect(submitAndExpectPublicCompletion(fixture.page, fixture.now)).rejects.toThrow(code);
    expect(fixture.handlers.size).toBe(0);
  });
  it("rejects duplicate successful headings", async () => {
    const fixture = browserScenario({ renderAt: 20_487, headingCount: 2 });
    await expect(submitAndExpectPublicCompletion(fixture.page, fixture.now)).rejects.toThrow("P20_PUBLIC_COMPLETION_STRICT_LOCATOR");
  });
  it("distinguishes missing Preview navigation header, failed completion and no submit", () => {
    const classify = (events: CompletionEvent[]) => classifyPublicCompletionFailure({ events }, { headingCount: 0, formAlertCount: 0, preview: true });
    expect(classify(["SUBMIT_STARTED", "SUBMIT_FINISHED", "COMPLETE_STARTED", "COMPLETE_HEADER_ABSENT"])).toBe("P20_PUBLIC_COMPLETION_PREVIEW_HEADER_MISSING");
    expect(classify(["SUBMIT_STARTED", "SUBMIT_FINISHED", "COMPLETE_FAILED"])).toBe("P20_PUBLIC_COMPLETION_REQUEST_FAILED");
    expect(classify([])).toBe("P20_PUBLIC_SUBMIT_REQUEST_NOT_STARTED");
  });
});
