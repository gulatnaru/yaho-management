import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "@playwright/test";
import { classifyPhase20ActionFailure, classifyRequestFailure, clickAndExpectPhase20Action, initialDepositProven, replayDepositProven, multipartNonceMatches } from "@/tests/e2e/support/phase20-action";

function fixture(input: { clickMs?: number; resultMs?: number; failed?: boolean; failureText?: string; httpError?: boolean; duplicate?: boolean } = {}) {
  let time = 0;
  const handlers = new Map<string, (value: unknown) => void>();
  const emit = (event: string, value: unknown) => handlers.get(event)?.(value);
  const action = { method: () => "POST", url: () => "https://example.test/reservation-applications/submissions/owned", headers: () => ({ "next-action": "fixed" }), failure: () => ({ errorText: input.failureText ?? "other private network details" }) };
  const page = { on: (event: string, listener: (value: unknown) => void) => handlers.set(event, listener), off: (event: string) => handlers.delete(event) } as unknown as Page;
  const button = { click: vi.fn(async () => {
    time += input.clickMs ?? 0;
    emit("request", action);
    emit("response", { request: () => ({}), status: () => 503 });
    emit("response", { request: () => action, status: () => input.httpError ? 503 : 200 });
    emit(input.failed ? "requestfailed" : "requestfinished", action);
  }) } as unknown as Locator;
  const waitFor = vi.fn(async (options: { timeout: number }) => {
    const delay = (input.resultMs ?? 20_000) - time;
    time += Math.max(0, delay);
    if (delay > options.timeout) throw new Error("private browser details");
  });
  const result = { waitFor, count: async () => input.duplicate ? 2 : 1 } as unknown as Locator;
  return { page, button, result, handlers, waitFor, now: () => time };
}

describe("bounded matched Phase20 action completion", () => {
  it("rejects retained receipts, missing replay results and changed original ledgers", () => {
    const proof = { initialBalanceAbsent: true, freshResult: true, beforeCount: 1, afterCount: 1, nonceMatched: true, pendingSeen: true, settled: true, originalRowUnchanged: true, noError: true };
    expect(replayDepositProven(proof)).toBe(true);
    for (const changed of [{ initialBalanceAbsent: false }, { freshResult: false }, { beforeCount: 0 }, { afterCount: 2 }, { nonceMatched: false }, { pendingSeen: false }, { settled: false }, { originalRowUnchanged: false }, { noError: false }]) expect(replayDepositProven({ ...proof, ...changed })).toBe(false);
  });
  it("permits only specifically verified aborted replay and rejects HTTP or other failures", async () => {
    for (const input of [{ failed: true, failureText: "net::ERR_ABORTED" }, { failed: true }, { httpError: true }]) {
      const value = fixture(input);
      const operation = clickAndExpectPhase20Action(value.page, value.button, value.result, value.now, "DEPOSIT_REPLAY", async () => true);
      if (input.failureText === "net::ERR_ABORTED") await expect(operation).resolves.toBeUndefined();
      else await expect(operation).rejects.toThrow();
    }
    const denied = fixture({ failed: true, failureText: "net::ERR_ABORTED" });
    await expect(clickAndExpectPhase20Action(denied.page, denied.button, denied.result, denied.now, "DEPOSIT_REPLAY", async () => false)).rejects.toThrow();
  });
  it("uses one budget including click and ignores unrelated errors", async () => {
    const value = fixture({ clickMs: 1_000, resultMs: 20_000 });
    await expect(clickAndExpectPhase20Action(value.page, value.button, value.result, value.now)).resolves.toBeUndefined();
    expect(value.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 29_000 });
    expect(value.handlers.size).toBe(0);
  });
  it.each([
    [{ failed: true }, "P20_ACTION_REQUEST_FAILED"],
    [{ httpError: true }, "P20_ACTION_HTTP_ERROR"],
    [{ resultMs: 30_001 }, "P20_ACTION_DEADLINE"],
    [{ duplicate: true }, "P20_ACTION_RESULT_UNREACHED"],
  ] as const)("sanitizes failure and releases observers", async (input, code) => {
    const value = fixture(input);
    await expect(clickAndExpectPhase20Action(value.page, value.button, value.result, value.now)).rejects.toThrow(code);
    expect(value.handlers.size).toBe(0);
  });
  it("distinguishes no request from a matched unfinished stream", () => {
    expect(classifyPhase20ActionFailure({ started: false, finished: false, failed: false, httpError: false })).toBe("P20_ACTION_REQUEST_NOT_STARTED");
    expect(classifyPhase20ActionFailure({ started: true, finished: false, failed: false, httpError: false })).toBe("P20_ACTION_REQUEST_UNFINISHED");
  });
  it("accepts an aborted confirmation only with fresh UI and verified owned postconditions", async () => {
    const value = fixture({ failed: true, failureText: "net::ERR_ABORTED" });
    await expect(clickAndExpectPhase20Action(value.page, value.button, value.result, value.now, "CONFIRM", async () => true)).resolves.toBeUndefined();
    const denied = fixture({ failed: true, failureText: "net::ERR_ABORTED" });
    await expect(clickAndExpectPhase20Action(denied.page, denied.button, denied.result, denied.now, "CONFIRM", async () => false)).rejects.toThrow("P20_ACTION_RESULT_UNREACHED");
  });
  it("preserves a later UI deadline rather than blaming an accepted aborted transport", async () => {
    const value = fixture({ failed: true, failureText: "net::ERR_ABORTED", resultMs: 30_001 });
    await expect(clickAndExpectPhase20Action(value.page, value.button, value.result, value.now, "CONFIRM", async () => true)).rejects.toThrow("P20_ACTION_DEADLINE");
  });
  it("never accepts other transport failures or HTTP errors with successful postconditions", async () => {
    for (const input of [{ failed: true }, { httpError: true }]) {
      const value = fixture(input);
      await expect(clickAndExpectPhase20Action(value.page, value.button, value.result, value.now, "CONFIRM", async () => true)).rejects.toThrow();
    }
    expect(classifyRequestFailure("net::ERR_ABORTED")).toBe("ABORTED");
    expect(classifyRequestFailure("private unexpected error")).toBe("OTHER");
  });
  it("requires a new first-deposit state and exact nonce/fields/pending conservation", () => {
    const proven = { initialBalanceAbsent: true, beforeCount: 0, afterCount: 1, nonceMatched: true, pendingSeen: true, settled: true, fieldsMatch: true };
    expect(initialDepositProven(proven)).toBe(true);
    for (const changed of [{ initialBalanceAbsent: false }, { beforeCount: 1 }, { afterCount: 2 }, { nonceMatched: false }, { pendingSeen: false }, { settled: false }, { fieldsMatch: false }]) expect(initialDepositProven({ ...proven, ...changed })).toBe(false);
    expect(multipartNonceMatches('--synthetic\r\nContent-Disposition: form-data; name="1_idempotencyKey"\r\n\r\noriginal\r\n--synthetic--', "original")).toBe(true);
    expect(multipartNonceMatches('--synthetic\r\nContent-Disposition: form-data; name="1_payerName"\r\n\r\noriginal\r\n--synthetic--', "original")).toBe(false);
  });
});
