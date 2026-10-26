import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReservationShareFeed, isKakaoShareConfigured, type KakaoShareFeed } from "@/lib/kakao/share";

afterEach(() => vi.unstubAllEnvs());

describe("Kakao reservation feed data", () => {
  const input = { title: "synthetic-title", description: "synthetic-description", linkUrl: "https://synthetic-site.example.test/synthetic-public" };

  it("builds the Feed shape with identical desktop/mobile links and no implicit button", () => {
    const feed: KakaoShareFeed = buildReservationShareFeed(input);
    expect(feed).toEqual({ objectType: "feed", content: { title: input.title, description: input.description, link: { mobileWebUrl: input.linkUrl, webUrl: input.linkUrl } } });
    expect(feed).not.toHaveProperty("buttons");
  });

  it("builds exactly one button when requested", () => {
    expect(buildReservationShareFeed({ ...input, buttonTitle: "synthetic-button" }).buttons).toEqual([{ title: "synthetic-button", link: { mobileWebUrl: input.linkUrl, webUrl: input.linkUrl } }]);
  });

  it.each(["", "synthetic-invalid", "/synthetic-relative", "http://synthetic-site.example.test", "javascript:synthetic-invalid", "https://synthetic-user@synthetic-site.example.test"])("rejects non-HTTPS or invalid destination %j", (linkUrl) => {
    expect(() => buildReservationShareFeed({ ...input, linkUrl })).toThrow("Invalid reservation share feed.");
  });

  it("rejects empty copy, empty button labels and unexpected private fields", () => {
    for (const field of ["title", "description", "buttonTitle"]) expect(() => buildReservationShareFeed({ ...input, [field]: " " })).toThrow("Invalid reservation share feed.");
    const unexpected = { ...input, childName: "synthetic-forbidden" };
    expect(() => buildReservationShareFeed(unexpected)).toThrow("Invalid reservation share feed.");
  });

  it("trims text and applies our 100/300-character guardrails without splitting Unicode", () => {
    const text = "synthetic-🌿".repeat(50);
    const feed = buildReservationShareFeed({ ...input, title: ` ${text} `, description: ` ${text} ` });
    expect(feed.content.title).toBe(Array.from(text).slice(0, 100).join(""));
    expect(feed.content.description).toBe(Array.from(text).slice(0, 300).join(""));
    expect(Array.from(feed.content.title)).toHaveLength(100);
    expect(Array.from(feed.content.description)).toHaveLength(300);
  });
});

describe("public Kakao JS key presence", () => {
  it.each([undefined, "", " "])("is unconfigured for %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", value);
    expect(isKakaoShareConfigured()).toBe(false);
  });

  it("returns only a boolean for the explicitly synthetic test key", () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", "test-js-key");
    expect(isKakaoShareConfigured()).toBe(true);
  });
});
