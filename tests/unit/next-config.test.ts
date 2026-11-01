import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("capability route configuration", () => {
  it("preserves invitation headers and applies the same protection to ops acceptance", async () => {
    const headers = await nextConfig.headers!();
    const expected = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ];
    expect(headers).toEqual([
      { source: "/invite/:path*", headers: expected },
      { source: "/first-super-admin-ops/:path*", headers: expected },
    ]);
  });

  it("disables incoming request logging without token path patterns", () => {
    const logging = nextConfig.logging;
    if (!logging) throw new Error("Expected logging configuration");
    expect(logging.incomingRequests).toBe(false);
    const serializedLogging = JSON.stringify(logging, (_key, value: unknown) =>
      value instanceof RegExp ? value.source : value,
    );
    expect(serializedLogging).not.toContain("first-super-admin-ops");
  });
});
