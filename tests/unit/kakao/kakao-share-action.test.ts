import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdminShareFeed, buildReservationShareFeed, type KakaoShareFeed } from "@/lib/kakao/share";
import { adminSubmissionPath, applyUrl } from "@/lib/kakao/links";
import { makePage, makeSdk, syntheticJsKey } from "./sdk-fixture";

const input = { title: "synthetic-title", description: "synthetic-description", linkUrl: "https://synthetic.example.test/synthetic-public" };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", syntheticJsKey);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Kakao user-initiated share orchestration", () => {
  it("returns unconfigured for a missing key without loading or invoking the SDK", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", undefined);
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    page.win.Kakao = sdk;
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "unconfigured" });
    expect(page.doc.createElement).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("returns unconfigured for a whitespace key without touching document", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", " ");
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "unconfigured" });
    expect(page.doc.createElement).not.toHaveBeenCalled();
  });

  it("lazy-loads on the first invocation and sends the existing builder's exact object once", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    expect(page.doc.createElement).not.toHaveBeenCalled();
    const pending = requestKakaoShare(input, page);
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    page.loaded(sdk);
    await expect(pending).resolves.toEqual({ status: "opened" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith(buildReservationShareFeed(input));
  });

  it("passes an admin wrapper feed through the same existing builder unchanged", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const feed = buildAdminShareFeed("https://synthetic.example.test/reservation-applications/submissions/synthetic-id");
    await expect(requestKakaoShare(feed, page)).resolves.toEqual({ status: "opened" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith(feed);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith(buildReservationShareFeed({
      title: feed.content.title, description: feed.content.description, linkUrl: feed.content.link.webUrl,
    }));
  });

  it("returns failed on script onerror without sending and keeps link utilities intact", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    const pending = requestKakaoShare(input, page);
    page.errored();
    await expect(pending).resolves.toEqual({ status: "failed", reason: "sdk" });
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(applyUrl("https://synthetic.example.test", "synthetic-public-id")).toBe("https://synthetic.example.test/apply/synthetic-public-id");
    expect(adminSubmissionPath("synthetic-id")).toBe("/reservation-applications/submissions/synthetic-id");
    // CopyControl coexisting with SDK failures still requires Preview/device rendering.
  });

  it("returns failed on init exceptions without sending or exposing the key", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    sdk.init.mockImplementation(() => { throw new Error(`synthetic-private ${syntheticJsKey}`); });
    page.win.Kakao = sdk;
    const result = await requestKakaoShare(input, page);
    expect(result).toEqual({ status: "failed", reason: "sdk" });
    expect(JSON.stringify(result)).not.toContain(syntheticJsKey);
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(applyUrl("https://synthetic.example.test", "synthetic-public-id")).toBe("https://synthetic.example.test/apply/synthetic-public-id");
    expect(adminSubmissionPath("synthetic-id")).toBe("/reservation-applications/submissions/synthetic-id");
  });

  it("returns failed when init leaves the SDK uninitialized and never sends", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    sdk.init.mockImplementation(() => undefined);
    page.win.Kakao = sdk;
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "failed", reason: "sdk" });
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("ignores a second click within 1000ms without sending a second time", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "opened" });
    await vi.advanceTimersByTimeAsync(999);
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "ignored" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores concurrent clicks and clicks during a slow SDK load beyond 1000ms", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk();
    const first = requestKakaoShare(input, page);
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "ignored" });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "ignored" });
    page.loaded(sdk);
    await expect(first).resolves.toEqual({ status: "opened" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(page.scripts).toHaveLength(1);
  });

  it("uses changed builder inputs for a later share at the exact guard boundary", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const secondInput = { ...input, title: "synthetic-second-title", description: "synthetic-second-description", linkUrl: "https://synthetic.example.test/second-public", buttonTitle: "synthetic-button" };
    await requestKakaoShare(input, page);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(requestKakaoShare(secondInput, page)).resolves.toEqual({ status: "opened" });
    expect(sdk.Share.sendDefault).toHaveBeenNthCalledWith(1, buildReservationShareFeed(input));
    expect(sdk.Share.sendDefault).toHaveBeenNthCalledWith(2, buildReservationShareFeed(secondInput));
    expect(sdk.Share.sendDefault.mock.calls[0][0]).not.toEqual(sdk.Share.sendDefault.mock.calls[1][0]);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it("returns only opened after SDK invocation, never a sent success or private data", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const result = await requestKakaoShare(input, page);
    expect(result).toEqual({ status: "opened" });
    expect(JSON.stringify(result)).not.toContain("sent");
    expect(JSON.stringify(result)).not.toContain(syntheticJsKey);
    expect(JSON.stringify(result)).not.toContain(input.linkUrl);
  });

  it("catches synchronous sendDefault failures without returning SDK error details", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    sdk.Share.sendDefault.mockImplementation(() => { throw new Error(syntheticJsKey); });
    page.win.Kakao = sdk;
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "failed", reason: "share" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
  });

  it("catches rejected share promises without false success or unhandled rejection", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    sdk.Share.sendDefault.mockRejectedValue(new Error(syntheticJsKey));
    page.win.Kakao = sdk;
    await expect(requestKakaoShare(input, page)).resolves.toEqual({ status: "failed", reason: "share" });
  });

  it("returns a safe unavailable failure on the server without globals", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    await expect(requestKakaoShare(input)).resolves.toEqual({ status: "failed", reason: "unavailable" });
  });

  it("returns failed for malformed builder input instead of throwing or sending", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    await expect(requestKakaoShare({ ...input, linkUrl: "synthetic-invalid" }, page)).resolves.toEqual({ status: "failed", reason: "share" });
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("rejects a malformed prebuilt feed with mismatched destinations", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const feed = buildReservationShareFeed(input);
    feed.content.link.mobileWebUrl = "https://synthetic.example.test/other-public";
    await expect(requestKakaoShare(feed, page)).resolves.toEqual({ status: "failed", reason: "share" });
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("rejects unsupported fields on a prebuilt feed without sending private values", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const feed: KakaoShareFeed = { ...buildReservationShareFeed(input), ...{ guardianName: "synthetic-forbidden-name" } };
    await expect(requestKakaoShare(feed, page)).resolves.toEqual({ status: "failed", reason: "share" });
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("preserves the optional button when a builder feed is supplied", async () => {
    const { requestKakaoShare } = await import("@/lib/kakao/sdk");
    const page = makePage();
    const sdk = makeSdk(true);
    page.win.Kakao = sdk;
    const feed = buildReservationShareFeed({ ...input, buttonTitle: "synthetic-button" });
    await expect(requestKakaoShare(feed, page)).resolves.toEqual({ status: "opened" });
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith(feed);
  });
});
