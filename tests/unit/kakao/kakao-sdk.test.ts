import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePage, makeSdk, syntheticJsKey } from "./sdk-fixture";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Kakao SDK loader and initialization", () => {
  it("injects the pinned official script with SRI and initializes after onload", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    const pending = ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    expect(page.doc.createElement).toHaveBeenCalledTimes(1);
    expect(page.doc.createElement).toHaveBeenCalledWith("script");
    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]).toMatchObject({
      src: "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js",
      integrity: "sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w",
      crossOrigin: "anonymous", async: true,
    });
    expect(sdk.init).not.toHaveBeenCalled();
    page.loaded(sdk);
    await expect(pending).resolves.toEqual({ status: "ready", sdk });
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(syntheticJsKey);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares the identical promise and one script for concurrent and later loads", async () => {
    const { loadKakaoSdk } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    const first = loadKakaoSdk(page.doc, page.win);
    const second = loadKakaoSdk(page.doc, page.win);
    expect(second).toBe(first);
    expect(page.scripts).toHaveLength(1);
    page.loaded(sdk);
    await expect(first).resolves.toBe(sdk);
    expect(loadKakaoSdk(page.doc, page.win)).toBe(first);
    await expect(second).resolves.toBe(sdk);
    expect(page.doc.head.appendChild).toHaveBeenCalledTimes(1);
  });

  it("does not reinitialize or inject a script for an already initialized SDK", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    await expect(ensureKakaoInitialized(syntheticJsKey, page.doc, page.win)).resolves.toEqual({ status: "ready", sdk });
    expect(sdk.init).not.toHaveBeenCalled();
    expect(page.doc.createElement).not.toHaveBeenCalled();
  });

  it("initializes only once when initialization callers arrive concurrently", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    const first = ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    const second = ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    page.loaded(sdk);
    expect(await Promise.all([first, second])).toEqual([{ status: "ready", sdk }, { status: "ready", sdk }]);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(page.scripts).toHaveLength(1);
  });

  it("rejects script onerror with a fixed error and retains the one load promise", async () => {
    const { loadKakaoSdk } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const pending = loadKakaoSdk(page.doc, page.win);
    const rejected = expect(pending).rejects.toThrow("Kakao SDK load failed.");
    page.errored();
    await rejected;
    expect(loadKakaoSdk(page.doc, page.win)).toBe(pending);
    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0].remove).toHaveBeenCalledTimes(1);
    expect(page.scripts[0].onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects after our ten-second timeout and cleans up the load handlers", async () => {
    const { loadKakaoSdk, KAKAO_SDK_TIMEOUT_MS } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const pending = loadKakaoSdk(page.doc, page.win).catch((error: Error) => error);
    expect(KAKAO_SDK_TIMEOUT_MS).toBe(10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(page.scripts[0].remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(new Error("Kakao SDK load failed."));
    expect(page.scripts[0].onload).toBeNull();
    expect(page.scripts[0].onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed if onload fires without a usable Kakao global", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const pending = ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    page.scripts[0].onload?.(new Event("load"));
    await expect(pending).resolves.toEqual({ status: "failed" });
  });

  it("returns unavailable without browser globals and does not touch an injected document", async () => {
    const { ensureKakaoInitialized, loadKakaoSdk } = await import("@/lib/kakao/sdk");
    const page = makePage();
    await expect(ensureKakaoInitialized(syntheticJsKey)).resolves.toEqual({ status: "unavailable" });
    await expect(ensureKakaoInitialized(syntheticJsKey, page.doc)).resolves.toEqual({ status: "unavailable" });
    await expect(loadKakaoSdk()).rejects.toThrow("Kakao SDK unavailable.");
    expect(page.doc.createElement).not.toHaveBeenCalled();
    expect(page.doc.head.appendChild).not.toHaveBeenCalled();
  });

  it("uses browser globals by default but does not load anything at import time", async () => {
    const page = makePage();
    const sdk = makeSdk();
    vi.stubGlobal("document", page.doc);
    vi.stubGlobal("window", page.win);
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    expect(page.doc.createElement).not.toHaveBeenCalled();
    const pending = ensureKakaoInitialized(syntheticJsKey);
    page.loaded(sdk);
    await expect(pending).resolves.toEqual({ status: "ready", sdk });
  });

  it("sanitizes an init exception and never repeats that failed init", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    sdk.init.mockImplementation(() => { throw new Error(`private ${syntheticJsKey}`); });
    page.win.Kakao = sdk;
    const first = await ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    const second = await ensureKakaoInitialized(syntheticJsKey, page.doc, page.win);
    expect(first).toEqual({ status: "failed" });
    expect(second).toEqual(first);
    expect(JSON.stringify([first, second])).not.toContain(syntheticJsKey);
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it("returns failure when init returns but isInitialized stays false", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    sdk.init.mockImplementation(() => undefined);
    page.win.Kakao = sdk;
    await expect(ensureKakaoInitialized(syntheticJsKey, page.doc, page.win)).resolves.toEqual({ status: "failed" });
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it("returns failure if checking initialization throws", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    sdk.isInitialized.mockImplementation(() => { throw new Error(syntheticJsKey); });
    page.win.Kakao = sdk;
    await expect(ensureKakaoInitialized(syntheticJsKey, page.doc, page.win)).resolves.toEqual({ status: "failed" });
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("sanitizes DOM insertion errors and safely rejects even if cleanup throws", async () => {
    const { loadKakaoSdk } = await import("@/lib/kakao/sdk");
    const page = makePage();
    page.doc.head.appendChild.mockImplementation((script) => {
      vi.mocked(script.remove).mockImplementation(() => { throw new Error(syntheticJsKey); });
      throw new Error(syntheticJsKey);
    });
    await expect(loadKakaoSdk(page.doc, page.win)).rejects.toThrow("Kakao SDK load failed.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an empty initialization key before script injection", async () => {
    const { ensureKakaoInitialized } = await import("@/lib/kakao/sdk");
    const page = makePage();
    await expect(ensureKakaoInitialized(" ", page.doc, page.win)).resolves.toEqual({ status: "failed" });
    expect(page.doc.createElement).not.toHaveBeenCalled();
  });
});
