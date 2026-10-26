import { z } from "zod";
import { buildReservationShareFeed, isKakaoShareConfigured, type KakaoShareFeed } from "./share";

/** Minimal client-only boundary; no server modules, API calls or automatic sends. */
export type KakaoGlobal = {
  init(appKey: string): void;
  isInitialized(): boolean;
  Share: { sendDefault(feed: KakaoShareFeed): void | Promise<void> };
  cleanup?(): void;
};

export type KakaoScriptElement = {
  src: string;
  integrity: string;
  crossOrigin: string | null;
  async: boolean;
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event | string) => void) | null;
  remove(): void;
};

/** Small structural contracts allow handwritten node-environment test doubles. */
export type KakaoDocument = {
  createElement(tag: "script"): KakaoScriptElement;
  head: { appendChild(script: KakaoScriptElement): unknown };
};
export type KakaoWindow = { Kakao?: KakaoGlobal };

declare global {
  interface Window { Kakao?: KakaoGlobal }
}

/**
 * Official SDK 2.8.4, verified 2026-10-26 against:
 * https://developers.kakao.com/docs/ko/javascript/download
 * https://developers.kakao.com/docs/ko/tutorial/js-share
 * SRI SHA-384 base64: BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w
 * Local verification copy (88,359 bytes, header v2.8.4) matched sha384sum hex:
 * 0465fb59bd7a1a64456a0ae2e1b2c95760e08a9559694d8023cd76199b47b47cf30d02677c76ac0d7379868bb1bf8e70
 * Independently computed base64 with `openssl dgst -sha384 -binary <file> |
 * openssl base64 -A`. The orchestrator directly fetched this official CDN URL
 * (HTTP 200, same size/header/hash); local bytes were compared because sandbox
 * egress blocked a fresh CDN download. The verification copy is not shipped.
 * Manual script-element injection is deliberate: this codebase has no next/script
 * usage, and we set integrity + crossorigin on the element before appending it.
 *
 * The user must perform THREE distinct Kakao Developers console registrations:
 * 1. JavaScript key (public; use NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY).
 * 2. JavaScript SDK domain (Web platform site domain where this page runs).
 * 3. Product Link web domain (domain of links inside shared messages).
 * Console registration has NOT been performed by this implementation.
 */
export const KAKAO_SDK_SRC = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js";
export const KAKAO_SDK_INTEGRITY = "sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w";
// Our own load-time guardrail, not a Kakao SDK timeout guarantee.
export const KAKAO_SDK_TIMEOUT_MS = 10_000;

let sdkPromise: Promise<KakaoGlobal> | undefined;
let initializationPromise: Promise<KakaoInitializationResult> | undefined;

function hasSdk(value: unknown): value is KakaoGlobal {
  if (!value || typeof value !== "object") return false;
  const sdk = value as Partial<KakaoGlobal>;
  return typeof sdk.init === "function" && typeof sdk.isInitialized === "function"
    && typeof sdk.Share?.sendDefault === "function";
}

function browserDocument(): KakaoDocument | undefined {
  if (typeof document === "undefined") return undefined;
  const nativeDocument = document;
  return {
    createElement: (tag) => nativeDocument.createElement(tag),
    head: {
      // This adapter appends only the native script its createElement returned.
      appendChild: (script) => nativeDocument.head.appendChild(script as HTMLScriptElement),
    },
  };
}

/** One promise/script per page, including failures; reload the page to retry loading. */
export function loadKakaoSdk(
  doc: KakaoDocument | undefined = browserDocument(),
  win: KakaoWindow | undefined = typeof window === "undefined" ? undefined : window,
): Promise<KakaoGlobal> {
  if (!doc || !win) return Promise.reject(new Error("Kakao SDK unavailable."));
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<KakaoGlobal>((resolve, reject) => {
    let script: KakaoScriptElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (sdk?: KakaoGlobal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (script) {
        script.onload = null;
        script.onerror = null;
      }
      if (sdk) resolve(sdk);
      else {
        try { script?.remove(); }
        catch { /* A cleanup failure must not mask the fixed load error. */ }
        reject(new Error("Kakao SDK load failed."));
      }
    };
    try {
      if (hasSdk(win.Kakao)) { finish(win.Kakao); return; }
      script = doc.createElement("script");
      script.src = KAKAO_SDK_SRC;
      script.integrity = KAKAO_SDK_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () => {
        try { finish(hasSdk(win.Kakao) ? win.Kakao : undefined); }
        catch { finish(); }
      };
      script.onerror = () => finish();
      timer = setTimeout(() => finish(), KAKAO_SDK_TIMEOUT_MS);
      doc.head.appendChild(script);
    } catch { finish(); }
  });
  return sdkPromise;
}

export type KakaoInitializationResult =
  | { status: "ready"; sdk: KakaoGlobal }
  | { status: "unavailable" | "failed" };

/** Never return/log raw SDK errors: they may include the JavaScript key. */
export async function ensureKakaoInitialized(
  appKey: string,
  doc: KakaoDocument | undefined = browserDocument(),
  win: KakaoWindow | undefined = typeof window === "undefined" ? undefined : window,
): Promise<KakaoInitializationResult> {
  if (!doc || !win) return { status: "unavailable" };
  try {
    if (!appKey.trim()) return { status: "failed" };
    const sdk = await loadKakaoSdk(doc, win);
    if (sdk.isInitialized()) return { status: "ready", sdk };
    initializationPromise ??= Promise.resolve().then((): KakaoInitializationResult => {
      if (!sdk.isInitialized()) sdk.init(appKey);
      return sdk.isInitialized() ? { status: "ready", sdk } : { status: "failed" };
    }).catch((): KakaoInitializationResult => ({ status: "failed" }));
    return await initializationPromise;
  } catch { return { status: "failed" }; }
}

type FeedInput = Parameters<typeof buildReservationShareFeed>[0];
const linkSchema = z.object({ mobileWebUrl: z.string(), webUrl: z.string() }).strict();
const builtFeedSchema = z.object({
  objectType: z.literal("feed"),
  content: z.object({ title: z.string(), description: z.string(), link: linkSchema }).strict(),
  buttons: z.array(z.object({ title: z.string(), link: linkSchema }).strict()).length(1).optional(),
}).strict().refine(({ content, buttons }) => content.link.mobileWebUrl === content.link.webUrl
  && (!buttons || (buttons[0].link.mobileWebUrl === content.link.webUrl
    && buttons[0].link.webUrl === content.link.webUrl)));

/** Accept our wrapper feeds as well as the existing builder's input, with one builder. */
function buildShareFeed(input: FeedInput | KakaoShareFeed): KakaoShareFeed {
  if ("objectType" in input) {
    const feed = builtFeedSchema.parse(input);
    return buildReservationShareFeed({
      title: feed.content.title,
      description: feed.content.description,
      linkUrl: feed.content.link.webUrl,
      ...(feed.buttons ? { buttonTitle: feed.buttons[0].title } : {}),
    });
  }
  return buildReservationShareFeed(input);
}

export type KakaoShareResult =
  | { status: "opened" }
  | { status: "unconfigured" | "ignored" }
  | { status: "failed"; reason: "unavailable" | "sdk" | "share" };
export type KakaoShareDependencies = { doc?: KakaoDocument; win?: KakaoWindow };

let lastShareInvocationAt: number | undefined;
let shareInFlight = false;
// Our duplicate-click guardrail: 1000ms plus any in-flight SDK load/share attempt.
const DUPLICATE_SHARE_GUARD_MS = 1_000;

/** Lazy browser-only work starts at the user's click; opening is never delivery proof. */
export async function requestKakaoShare(
  input: FeedInput | KakaoShareFeed,
  deps: KakaoShareDependencies = {},
): Promise<KakaoShareResult> {
  try {
    if (!isKakaoShareConfigured()) return { status: "unconfigured" };
    const now = Date.now();
    if (shareInFlight || (lastShareInvocationAt !== undefined
      && now - lastShareInvocationAt < DUPLICATE_SHARE_GUARD_MS)) return { status: "ignored" };
    lastShareInvocationAt = now;
    shareInFlight = true;
    try {
      const result = await ensureKakaoInitialized(
        process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY!.trim(), deps.doc, deps.win,
      );
      if (result.status !== "ready") return { status: "failed", reason: result.status === "unavailable" ? "unavailable" : "sdk" };
      const feed = buildShareFeed(input);
      await result.sdk.Share.sendDefault(feed);
      return { status: "opened" };
    } finally { shareInFlight = false; }
  } catch { return { status: "failed", reason: "share" }; }
}
