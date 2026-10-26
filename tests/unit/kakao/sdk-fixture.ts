import { vi } from "vitest";
import type { KakaoDocument, KakaoGlobal, KakaoScriptElement, KakaoWindow } from "@/lib/kakao/sdk";

/** Synthetic only: no browser, SDK code, network, credential or actual recipient. */
export const syntheticJsKey = "synthetic-test-js-key";

export function makeSdk(initialized = false) {
  let active = initialized;
  const sdk = {
    init: vi.fn<KakaoGlobal["init"]>(() => { active = true; }),
    isInitialized: vi.fn(() => active),
    Share: { sendDefault: vi.fn<KakaoGlobal["Share"]["sendDefault"]>() },
  } satisfies KakaoGlobal;
  return sdk;
}

export function makePage() {
  const scripts: KakaoScriptElement[] = [];
  const win: KakaoWindow = {};
  const doc = {
    createElement: vi.fn<KakaoDocument["createElement"]>(() => ({
      src: "", integrity: "", crossOrigin: null, async: false,
      onload: null, onerror: null, remove: vi.fn(),
    })),
    head: { appendChild: vi.fn((script: KakaoScriptElement) => { scripts.push(script); return script; }) },
  } satisfies KakaoDocument;
  return {
    doc, win, scripts,
    loaded(sdk: KakaoGlobal) {
      win.Kakao = sdk;
      scripts[0].onload?.(new Event("load"));
    },
    errored() { scripts[0].onerror?.(new Event("error")); },
  };
}
